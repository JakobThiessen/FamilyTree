/**
 * Änderungs-Kern (M10, D38): reines TypeScript, kein DOM, keine Seiteneffekte.
 *
 * `applyEdit(data, op)` wendet EINE Operation auf einen Baum an und liefert den neuen Baum,
 * die Umkehr-Operation (`inverse`) und die berührten IDs (`touched`). Die Eingabe wird nicht verändert.
 *
 * Aufbau: Jede Operation wird zuerst in eine Änderungsliste (`TreeChanges`: Schreiben/Löschen von
 * Personen, Unions, Quellen) übersetzt. Eine einzige Stelle (`commit`) wendet sie an und merkt sich
 * dabei die alten Datensätze. Daraus entsteht `inverse` als Operation `patch`; sie stellt jeden
 * berührten Datensatz exakt wieder her (auch gelöschte Unions samt Kinderreihenfolge). Ihre eigene
 * Umkehr ist wieder ein `patch`, Redo funktioniert also ohne Sonderfall. Dieselbe Änderungsliste
 * schreibt `TreeStore.applyChanges` gezielt in die Datenbank.
 *
 * Abgelehnt wird, was eine Invariante aus docs/DATA-MODEL.md verletzen würde. Ablehnungen und
 * Hinweise sind Code + Parameter (`MessageRef`, D37), keine Texte; die Oberfläche übersetzt sie.
 * Die Reihenfolge der Einträge in `persons`/`unions`/`sources` ist nicht Teil des Zustands
 * (neue und wiederhergestellte Datensätze stehen am Ende).
 */
import { IdSource } from "./ids";
import type {
  ChildLink,
  ChildLinkKind,
  Citation,
  MessageRef,
  Person,
  PersonId,
  Source,
  SourceId,
  Status,
  TreeData,
  Union,
  UnionId,
} from "./types";

/** Datensätze, die geschrieben bzw. gelöscht werden. Alle Felder sind optional. */
export interface TreeChanges {
  putPersons?: Person[];
  deletePersons?: PersonId[];
  putUnions?: Union[];
  deleteUnions?: UnionId[];
  putSources?: Source[];
  deleteSources?: SourceId[];
}

/** Berührte (geänderte, neue oder gelöschte) IDs. */
export interface Touched {
  persons: PersonId[];
  unions: UnionId[];
  sources: SourceId[];
}

export type EditOp =
  | { type: "addPerson"; person: Omit<Person, "id"> }
  | { type: "updatePerson"; person: Person }
  | { type: "deletePerson"; id: PersonId }
  | { type: "addUnion"; union: Omit<Union, "id"> }
  | { type: "updateUnion"; union: Union }
  | { type: "deleteUnion"; id: UnionId }
  | { type: "linkChild"; unionId: UnionId; personId: PersonId; kind?: ChildLinkKind; status?: Status }
  | { type: "unlinkChild"; unionId: UnionId; personId: PersonId }
  | { type: "addSource"; source: Omit<Source, "id"> }
  | { type: "updateSource"; source: Source }
  /** Stellt Datensätze her bzw. entfernt sie; wird als Umkehr (Undo/Redo) erzeugt. */
  | { type: "patch"; changes: TreeChanges };

export interface EditCreated {
  persons: PersonId[];
  unions: UnionId[];
  sources: SourceId[];
}

export type EditResult =
  | {
      ok: true;
      data: TreeData;
      /** Operation, die den Zustand vor dem Aufruf exakt wiederherstellt */
      inverse: EditOp;
      touched: Touched;
      /** neu vergebene IDs (bei add*) */
      created: EditCreated;
      /** Hinweise auf Folgen (Code + Parameter), z. B. entfernte leere Unions */
      notes: MessageRef[];
    }
  | { ok: false; reject: MessageRef };

/*
 * Codes der Ablehnungen (`reject.code`), Parameter in Klammern:
 *  edit.reject.person-not-found (id) · union-not-found (id) · source-not-found (id)
 *  edit.reject.unknown-partner (union, id) · unknown-child (union, id) · unknown-source (id)
 *  edit.reject.too-many-partners (union, count) · duplicate-partner (union, id) · duplicate-child (union, id)
 *  edit.reject.child-is-partner (union, id) · child-already-linked (union, id) · child-not-linked (union, id)
 *  edit.reject.cycle (parent, child) · second-biological (child, union, other)
 *  edit.reject.id-changed (id) · id-exists (id)
 * Codes der Hinweise (`notes[].code`):
 *  edit.note.person-removed-from-unions (id, unions) · unions-removed-empty (count)
 *  edit.note.union-without-partners (count) · union-children-unlinked (id, children)
 */

const note = (code: string, params?: Record<string, string | number>): MessageRef => ({
  code: `edit.note.${code}`,
  params,
});

class Rejected extends Error {
  constructor(readonly ref: MessageRef) {
    super(ref.code);
  }
}
const fail = (code: string, params?: Record<string, string | number>): never => {
  throw new Rejected({ code: `edit.reject.${code}`, params });
};

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Wendet eine Operation an. Wirft nie wegen ungültiger Eingaben, sondern liefert `ok: false`. */
export function applyEdit(data: TreeData, op: EditOp): EditResult {
  try {
    const notes: MessageRef[] = [];
    const created: EditCreated = { persons: [], unions: [], sources: [] };
    const changes = planChanges(data, op, notes, created);
    return commit(data, changes, notes, created);
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, reject: e.ref };
    throw e;
  }
}

/**
 * Übersetzt die berührten IDs in Datensätze des neuen Standes (für `TreeStore.applyChanges`):
 * berührte IDs, die im Baum stehen, werden geschrieben, die übrigen gelöscht.
 */
export function changesFromTouched(data: TreeData, touched: Touched): Required<TreeChanges> {
  const split = <T extends { id: string }>(items: T[], ids: string[]) => {
    const want = new Set(ids);
    const put = items.filter((x) => want.delete(x.id));
    // `want` enthält nun nur noch IDs ohne Datensatz = gelöschte
    return { put, del: [...want] };
  };
  const p = split(data.persons, touched.persons);
  const u = split(data.unions, touched.unions);
  const s = split(data.sources, touched.sources);
  return {
    putPersons: p.put,
    deletePersons: p.del,
    putUnions: u.put,
    deleteUnions: u.del,
    putSources: s.put,
    deleteSources: s.del,
  };
}

// ---------- Planen: Operation -> Änderungsliste ----------

function planChanges(data: TreeData, op: EditOp, notes: MessageRef[], created: EditCreated): TreeChanges {
  switch (op.type) {
    case "addPerson": {
      checkCitations(data, personCitations(op.person));
      const id = new IdSource("p", data.persons.map((p) => p.id)).take();
      created.persons.push(id);
      return { putPersons: [{ ...op.person, id }] };
    }
    case "updatePerson": {
      if (!data.persons.some((p) => p.id === op.person.id)) fail("person-not-found", { id: op.person.id });
      checkCitations(data, personCitations(op.person));
      return { putPersons: [op.person] };
    }
    case "deletePerson":
      return planDeletePerson(data, op.id, notes);
    case "addUnion": {
      const id = new IdSource("u", data.unions.map((u) => u.id)).take();
      created.unions.push(id);
      return { putUnions: [{ ...op.union, id }] };
    }
    case "updateUnion": {
      if (!data.unions.some((u) => u.id === op.union.id)) fail("union-not-found", { id: op.union.id });
      return { putUnions: [op.union] };
    }
    case "deleteUnion": {
      const u = findUnion(data, op.id);
      if (u.children.length) notes.push(note("union-children-unlinked", { id: u.id, children: u.children.length }));
      return { deleteUnions: [u.id] };
    }
    case "linkChild": {
      const u = findUnion(data, op.unionId);
      if (!data.persons.some((p) => p.id === op.personId)) fail("unknown-child", { union: u.id, id: op.personId });
      if (u.children.some((c) => c.personId === op.personId)) fail("child-already-linked", { union: u.id, id: op.personId });
      const link: ChildLink = { personId: op.personId, kind: op.kind ?? "biological" };
      if (op.status) link.status = op.status;
      return { putUnions: [{ ...u, children: [...u.children, link] }] };
    }
    case "unlinkChild": {
      const u = findUnion(data, op.unionId);
      if (!u.children.some((c) => c.personId === op.personId)) fail("child-not-linked", { union: u.id, id: op.personId });
      const next = { ...u, children: u.children.filter((c) => c.personId !== op.personId) };
      if (!next.partnerIds.length && !next.children.length) {
        notes.push(note("unions-removed-empty", { count: 1 }));
        return { deleteUnions: [u.id] };
      }
      return { putUnions: [next] };
    }
    case "addSource": {
      const id = new IdSource("s", data.sources.map((s) => s.id)).take();
      created.sources.push(id);
      return { putSources: [{ ...op.source, id }] };
    }
    case "updateSource": {
      if (!data.sources.some((s) => s.id === op.source.id)) fail("source-not-found", { id: op.source.id });
      return { putSources: [op.source] };
    }
    case "patch":
      return op.changes;
  }
}

function findUnion(data: TreeData, id: UnionId): Union {
  return data.unions.find((u) => u.id === id) ?? fail("union-not-found", { id });
}

/**
 * Person löschen: raus aus den Unions (Partner) und aus allen Kinderlisten. Kinder bleiben in der Union;
 * eine Union ohne Partner UND ohne Kinder verschwindet. Quellen bleiben (sie können andere Aussagen belegen).
 */
function planDeletePerson(data: TreeData, id: PersonId, notes: MessageRef[]): TreeChanges {
  if (!data.persons.some((p) => p.id === id)) fail("person-not-found", { id });
  const putUnions: Union[] = [];
  const deleteUnions: UnionId[] = [];
  let withoutPartners = 0;
  for (const u of data.unions) {
    const isPartner = u.partnerIds.includes(id);
    const isChild = u.children.some((c) => c.personId === id);
    if (!isPartner && !isChild) continue;
    const next: Union = {
      ...u,
      partnerIds: u.partnerIds.filter((p) => p !== id),
      children: u.children.filter((c) => c.personId !== id),
    };
    if (!next.partnerIds.length && !next.children.length) deleteUnions.push(u.id);
    else {
      putUnions.push(next);
      if (!next.partnerIds.length) withoutPartners++;
    }
  }
  const touchedUnions = putUnions.length + deleteUnions.length;
  if (touchedUnions) notes.push(note("person-removed-from-unions", { id, unions: touchedUnions }));
  if (deleteUnions.length) notes.push(note("unions-removed-empty", { count: deleteUnions.length }));
  if (withoutPartners) notes.push(note("union-without-partners", { count: withoutPartners }));
  return { deletePersons: [id], putUnions, deleteUnions };
}

const personCitations = (p: Omit<Person, "id">): Citation[] => [
  ...(p.birth?.citations ?? []),
  ...(p.death?.citations ?? []),
];

function checkCitations(data: TreeData, cites: Citation[]): void {
  if (!cites.length) return;
  const known = new Set(data.sources.map((s) => s.id));
  for (const c of cites) if (!known.has(c.sourceId)) fail("unknown-source", { id: c.sourceId });
}

// ---------- Anwenden und Umkehr bilden ----------

/** Ersetzt/entfernt/ergänzt Datensätze in einer Liste; liefert die vorherigen Datensätze der berührten IDs. */
function applyList<T extends { id: string }>(
  items: T[],
  put: T[] | undefined,
  del: string[] | undefined,
): { items: T[]; before: Map<string, T | undefined> } {
  const putMap = new Map((put ?? []).map((x) => [x.id, x]));
  const delSet = new Set(del ?? []);
  for (const id of delSet) putMap.delete(id); // Löschen gewinnt, falls beides angegeben
  const before = new Map<string, T | undefined>();
  for (const id of [...putMap.keys(), ...delSet]) before.set(id, undefined);
  const out: T[] = [];
  for (const x of items) {
    if (before.has(x.id)) before.set(x.id, x);
    if (delSet.has(x.id)) continue;
    const repl = putMap.get(x.id);
    if (repl) {
      out.push(repl);
      putMap.delete(x.id);
    } else out.push(x);
  }
  for (const x of putMap.values()) out.push(x);
  return { items: out, before };
}

/** Kehrt eine Liste von Vorher-Zuständen in eine Änderungsliste (put/delete) um. */
function invertList<T>(before: Map<string, T | undefined>, changedIds: string[]): { put: T[]; del: string[] } {
  const put: T[] = [];
  const del: string[] = [];
  for (const id of changedIds) {
    const old = before.get(id);
    if (old) put.push(old);
    else del.push(id);
  }
  return { put, del };
}

function commit(data: TreeData, changes: TreeChanges, notes: MessageRef[], created: EditCreated): EditResult {
  const persons = applyList(data.persons, changes.putPersons, changes.deletePersons);
  const unions = applyList(data.unions, changes.putUnions, changes.deleteUnions);
  const sources = applyList(data.sources, changes.putSources, changes.deleteSources);
  const next: TreeData = { ...data, persons: persons.items, unions: unions.items, sources: sources.items };

  // Invarianten nur für Unions prüfen, die geschrieben wurden (Altlasten anderer Unions bleiben unberührt).
  const written = uniq((changes.putUnions ?? []).map((u) => u.id)).filter((id) => !(changes.deleteUnions ?? []).includes(id));
  if (written.length) validateUnions(next, written);
  // Gelöschte Personen dürfen nirgends mehr stehen (Patch von außen könnte das verletzen).
  if (changes.deletePersons?.length) {
    const gone = new Set(changes.deletePersons);
    for (const u of next.unions) {
      for (const id of u.partnerIds) if (gone.has(id)) fail("unknown-partner", { union: u.id, id });
      for (const c of u.children) if (gone.has(c.personId)) fail("unknown-child", { union: u.id, id: c.personId });
    }
  }

  const touched: Touched = {
    persons: [...persons.before.keys()],
    unions: [...unions.before.keys()],
    sources: [...sources.before.keys()],
  };
  const ip = invertList(persons.before, touched.persons);
  const iu = invertList(unions.before, touched.unions);
  const is = invertList(sources.before, touched.sources);
  const inverse: EditOp = {
    type: "patch",
    changes: {
      putPersons: ip.put,
      deletePersons: ip.del,
      putUnions: iu.put,
      deleteUnions: iu.del,
      putSources: is.put,
      deleteSources: is.del,
    },
  };
  return { ok: true, data: next, inverse, touched, created, notes };
}

// ---------- Invarianten ----------

/**
 * Prüft die geschriebenen Unions gegen den neuen Stand:
 * Partner/Kinder existieren, höchstens 2 verschiedene Partner, kein Kind doppelt oder zugleich Partner,
 * kein Zyklus (ein Kind darf nicht Vorfahr seiner Eltern sein), ein Kind höchstens in einer biologischen Union.
 */
function validateUnions(data: TreeData, ids: UnionId[]): void {
  const personIds = new Set(data.persons.map((p) => p.id));
  const sourceIds = new Set(data.sources.map((s) => s.id));
  const byId = new Map(data.unions.map((u) => [u.id, u]));

  // Kind -> Unions, in denen es Kind ist (für Ahnensuche und Biologie-Prüfung), einmal aufgebaut.
  const asChild = new Map<PersonId, Union[]>();
  for (const u of data.unions) {
    for (const c of u.children) {
      const list = asChild.get(c.personId);
      if (list) list.push(u);
      else asChild.set(c.personId, [u]);
    }
  }

  /** Ist `target` ein Vorfahr von `start` (oder `start` selbst)? Besucht jede Person einmal. */
  const isAncestorOrSelf = (target: PersonId, start: PersonId): boolean => {
    const seen = new Set<PersonId>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop() as PersonId;
      if (cur === target) return true;
      for (const u of asChild.get(cur) ?? [])
        for (const p of u.partnerIds)
          if (!seen.has(p)) {
            seen.add(p);
            stack.push(p);
          }
    }
    return false;
  };

  for (const id of ids) {
    const u = byId.get(id) as Union;
    if (u.partnerIds.length > 2) fail("too-many-partners", { union: u.id, count: u.partnerIds.length });
    const partners = new Set<PersonId>();
    for (const p of u.partnerIds) {
      if (!personIds.has(p)) fail("unknown-partner", { union: u.id, id: p });
      if (partners.has(p)) fail("duplicate-partner", { union: u.id, id: p });
      partners.add(p);
    }
    const children = new Set<PersonId>();
    for (const c of u.children) {
      if (!personIds.has(c.personId)) fail("unknown-child", { union: u.id, id: c.personId });
      if (children.has(c.personId)) fail("duplicate-child", { union: u.id, id: c.personId });
      children.add(c.personId);
      if (partners.has(c.personId)) fail("child-is-partner", { union: u.id, id: c.personId });
      if (c.kind === "biological") {
        const other = (asChild.get(c.personId) ?? []).find(
          (x) => x.id !== u.id && x.children.some((l) => l.personId === c.personId && l.kind === "biological"),
        );
        if (other) fail("second-biological", { child: c.personId, union: u.id, other: other.id });
      }
      for (const p of partners)
        if (isAncestorOrSelf(c.personId, p)) fail("cycle", { parent: p, child: c.personId });
    }
    for (const cite of [...(u.start?.citations ?? []), ...(u.end?.citations ?? [])])
      if (!sourceIds.has(cite.sourceId)) fail("unknown-source", { id: cite.sourceId });
  }
}
