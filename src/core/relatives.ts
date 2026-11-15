/**
 * Verwandte hinzufügen (M10 Schritt 5, D41): reines TypeScript, kein DOM.
 *
 * `planRelative(data, spec)` übersetzt „Elternteil / Partner / Kind / Geschwister der Person X hinzufügen“
 * in EINE Operation (`patch`: neue Person + geänderte/neue Unions). Ein Knopfdruck ist so genau ein
 * Undo-Schritt, und die Invarianten (Zyklus, zweite biologische Union, höchstens 2 Partner …) prüft
 * weiterhin `applyEdit` beim Anwenden. Unions entstehen automatisch:
 *  - Elternteil: freier Platz in der leiblichen Elternunion der Person, sonst neue Union.
 *  - Partner: eine Union der Person mit freiem Platz (z. B. Kinder mit unbekanntem Partner) oder neue Union.
 *  - Kind: in einer gewählten Union der Person (Auswahl = Partner) oder neue Union ohne Partner.
 *  - Geschwister: Kind in der Elternunion der Person; gibt es keine, entsteht eine Union ohne Partner (`note`).
 * Die neue Person kann auch eine vorhandene sein (verknüpfen statt neu anlegen).
 */
import { IdSource } from "./ids";
import type { EditOp } from "./edit";
import type { ChildLink, MessageRef, Person, PersonId, TreeData, Union, UnionId } from "./types";

export type RelativeKind = "parent" | "partner" | "child" | "sibling";

export type RelativeTarget =
  | { person: Omit<Person, "id"> }
  /** vorhandene Person verknüpfen */
  | { existingId: PersonId };

export interface RelativeSpec {
  kind: RelativeKind;
  /** die Person, zu der der Verwandte hinzukommt (Fokusperson) */
  focusId: PersonId;
  target: RelativeTarget;
  /**
   * Welche Union: bei Partner/Kind eine Union der Person, bei Geschwister eine Elternunion der Person;
   * `"new"` = neue Union. Fehlt die Angabe, wählt `defaultUnion`.
   */
  unionId?: UnionId | "new";
}

export type RelativePlan =
  | {
      ok: true;
      op: EditOp;
      /** Kennung der Person, die hinzukommt bzw. verknüpft wird */
      personId: PersonId;
      /** Kennung der neuen oder geänderten Union */
      unionId: UnionId;
      /** Hinweise (Code + Parameter), z. B. `edit.note.sibling-without-parents` */
      notes: MessageRef[];
    }
  | { ok: false; reject: MessageRef };

/*
 * Codes der Ablehnungen: edit.reject.person-not-found (id) · parents-full (id) · same-person (id)
 *   union-not-found (id) · union-not-of-person (union, id)
 * Codes der Hinweise: edit.note.sibling-without-parents (id)
 */
const reject = (code: string, params?: Record<string, string | number>): RelativePlan => ({
  ok: false,
  reject: { code: `edit.reject.${code}`, params },
});

/** Unions, in denen die Person Kind ist; die mit leiblicher Verknüpfung zuerst. */
export function parentUnionsOf(data: TreeData, id: PersonId): Union[] {
  const mine = data.unions.filter((u) => u.children.some((c) => c.personId === id));
  const bio = (u: Union) => u.children.some((c) => c.personId === id && c.kind === "biological");
  return [...mine.filter(bio), ...mine.filter((u) => !bio(u))];
}

/** Unions, in denen die Person Partner ist (Reihenfolge der Daten). */
export const unionsOfPartner = (data: TreeData, id: PersonId): Union[] => data.unions.filter((u) => u.partnerIds.includes(id));

/**
 * Vorgabe, wenn die Oberfläche keine Union wählt: Elternteil, Geschwister = erste Elternunion (leiblich zuerst)
 * bzw. nichts, Partner = erste Union mit freiem Platz bzw. neu, Kind = einzige Union bzw. neu.
 */
export function defaultUnion(data: TreeData, kind: RelativeKind, focusId: PersonId): UnionId | "new" {
  if (kind === "parent") return parentUnionsOf(data, focusId).find((u) => u.partnerIds.length < 2)?.id ?? "new";
  if (kind === "sibling") return parentUnionsOf(data, focusId)[0]?.id ?? "new";
  const mine = unionsOfPartner(data, focusId);
  if (kind === "partner") return mine.find((u) => u.partnerIds.length < 2)?.id ?? "new";
  return mine.length === 1 ? mine[0]!.id : "new";
}

export function planRelative(data: TreeData, spec: RelativeSpec): RelativePlan {
  const { kind, focusId, target } = spec;
  if (!data.persons.some((p) => p.id === focusId)) return reject("person-not-found", { id: focusId });

  // Person bestimmen: neu (ID vergeben) oder vorhanden
  let person: Person;
  let isNew = false;
  if ("existingId" in target) {
    const found = data.persons.find((p) => p.id === target.existingId);
    if (!found) return reject("person-not-found", { id: target.existingId });
    if (found.id === focusId) return reject("same-person", { id: focusId });
    person = found;
  } else {
    person = { ...target.person, id: new IdSource("p", data.persons.map((p) => p.id)).take() };
    isNew = true;
  }
  const newUnionId = () => new IdSource("u", data.unions.map((u) => u.id)).take();
  const notes: MessageRef[] = [];
  const unionChoice = spec.unionId ?? defaultUnion(data, kind, focusId);

  const find = (): Union | RelativePlan => {
    const u = data.unions.find((x) => x.id === unionChoice);
    return u ?? reject("union-not-found", { id: unionChoice });
  };
  const done = (u: Union): RelativePlan => ({
    ok: true,
    op: { type: "patch", changes: { ...(isNew ? { putPersons: [person] } : {}), putUnions: [u] } },
    personId: person.id,
    unionId: u.id,
    notes,
  });
  const isPlan = (x: Union | RelativePlan): x is RelativePlan => "ok" in x;

  switch (kind) {
    case "parent": {
      if (unionChoice === "new") {
        // Wer schon Eltern hat, bekommt keine zweite Elternunion (sie wäre zweite biologische Union).
        if (parentUnionsOf(data, focusId).length) return reject("parents-full", { id: focusId });
        return done({
          id: newUnionId(),
          partnerIds: [person.id],
          kind: "unknown",
          children: [{ personId: focusId, kind: "biological" }],
        });
      }
      const u = find();
      if (isPlan(u)) return u;
      if (!u.children.some((c) => c.personId === focusId)) return reject("union-not-of-person", { union: u.id, id: focusId });
      if (u.partnerIds.length >= 2) return reject("parents-full", { id: focusId });
      return done({ ...u, partnerIds: [...u.partnerIds, person.id] });
    }
    case "partner": {
      if (unionChoice === "new") {
        return done({ id: newUnionId(), partnerIds: [focusId, person.id], kind: "partnership", children: [] });
      }
      const u = find();
      if (isPlan(u)) return u;
      if (!u.partnerIds.includes(focusId)) return reject("union-not-of-person", { union: u.id, id: focusId });
      return done({ ...u, partnerIds: [...u.partnerIds, person.id] }); // bei mehr als 2 lehnt applyEdit ab
    }
    case "child": {
      const link: ChildLink = { personId: person.id, kind: "biological" };
      if (unionChoice === "new") {
        return done({ id: newUnionId(), partnerIds: [focusId], kind: "unknown", children: [link] });
      }
      const u = find();
      if (isPlan(u)) return u;
      if (!u.partnerIds.includes(focusId)) return reject("union-not-of-person", { union: u.id, id: focusId });
      return done({ ...u, children: [...u.children, link] });
    }
    case "sibling": {
      if (unionChoice === "new") {
        notes.push({ code: "edit.note.sibling-without-parents", params: { id: focusId } });
        return done({
          id: newUnionId(),
          partnerIds: [],
          kind: "unknown",
          children: [
            { personId: focusId, kind: "biological" },
            { personId: person.id, kind: "biological" },
          ],
        });
      }
      const u = find();
      if (isPlan(u)) return u;
      const mine = u.children.find((c) => c.personId === focusId);
      if (!mine) return reject("union-not-of-person", { union: u.id, id: focusId });
      // gleiche Art der Verknüpfung wie bei der Fokusperson (leiblich, adoptiert …)
      const link: ChildLink = { personId: person.id, kind: mine.kind };
      return done({ ...u, children: [...u.children, link] });
    }
  }
}
