/**
 * Übernahme externer Treffer in einen Baum (reines TypeScript, keine Netzzugriffe, D26).
 *
 * Nur auf ausdrücklichen Wunsch des Nutzers aufgerufen. Neue Personen, Unions und Verknüpfungen
 * bekommen `status: "assumed"` (vermutet), dazu eine Quelle mit Link. Es wird **nie** eine
 * vorhandene Person überschrieben oder mit einer anderen verschmolzen: Mit `linkTo` wird an eine
 * vorhandene Person nur ein Verweis (`externalRefs`) und eine Notiz mit Link angehängt.
 * Die Eingabedaten werden nicht verändert; zurück kommt ein neuer `TreeData`.
 */
import { DuplicateFinder } from "../core/duplicates";
import { formatFuzzyDate } from "../core/fuzzyDate";
import type {
  ChildLink,
  Citation,
  ExternalRef,
  LifeEvent,
  Person,
  PersonId,
  Source,
  TreeData,
  Union,
} from "../core/types";
import { refKey } from "./types";
import type { ExternalEvent, ExternalPerson, ImportBatch } from "./types";

export interface AdoptOptions {
  /** Wurzelperson des Treffers einer vorhandenen Person zuordnen (statt neu anzulegen) */
  linkTo?: PersonId;
  /** Eltern, Partner und Kinder aus dem Treffer mitnehmen (Standard: ja) */
  includeRelatives?: boolean;
}

export interface AdoptResult {
  data: TreeData;
  /** Person im Baum, die zur Wurzelperson des Treffers gehört */
  rootId: PersonId;
  addedPersons: number;
  addedUnions: number;
  /** Personen des Treffers, die schon über ihren Verweis im Baum standen */
  reusedPersons: number;
  /** Neue Personen, die vorhandenen ähneln: nur zur Prüfung durch den Nutzer */
  possibleDuplicates: { newId: PersonId; existingId: PersonId }[];
  /** Hinweise, z. B. übersprungene Kinder-Verknüpfungen */
  notes: string[];
}

const SYSTEM_LABEL: Record<string, string> = { wikitree: "WikiTree", wikidata: "Wikidata", familysearch: "FamilySearch" };
const label = (system: string) => SYSTEM_LABEL[system] ?? system;

/** Zähler für fortlaufende IDs wie `p_12`: nächste freie Nummer nach der größten vorhandenen. */
class IdSource {
  private next: number;
  constructor(
    private readonly prefix: string,
    existing: Iterable<string>,
  ) {
    let max = 0;
    const re = new RegExp(`^${prefix}_(\\d+)$`);
    for (const id of existing) {
      const m = re.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    this.next = max + 1;
  }
  take(): string {
    return `${this.prefix}_${this.next++}`;
  }
}

const hasRef = (refs: ExternalRef[] | undefined, r: ExternalRef) =>
  refs?.some((x) => x.system === r.system && x.id === r.id) ?? false;

export function adoptBatch(base: TreeData, batch: ImportBatch, opts: AdoptOptions = {}): AdoptResult {
  const includeRelatives = opts.includeRelatives ?? true;
  const persons = new Map<PersonId, Person>(base.persons.map((p) => [p.id, p]));
  const unions = new Map<string, Union>(base.unions.map((u) => [u.id, u]));
  const sources = new Map<string, Source>(base.sources.map((s) => [s.id, s]));
  const pid = new IdSource("p", persons.keys());
  const uid = new IdSource("u", unions.keys());
  const sid = new IdSource("s", sources.keys());
  const preexisting = new Set(persons.keys());
  const notes: string[] = [];

  const byRef = new Map<string, PersonId>();
  for (const p of base.persons) for (const r of p.externalRefs ?? []) byRef.set(refKey(r), p.id);
  const sourceByRef = new Map<string, string>();
  for (const s of base.sources) for (const r of s.externalRefs ?? []) sourceByRef.set(refKey(r), s.id);

  if (opts.linkTo && !persons.has(opts.linkTo)) throw new Error(`Person ${opts.linkTo} nicht im Baum.`);

  /** Quelle zur externen Person (einmal je Verweis, Wiederverwendung bei erneuter Übernahme). */
  const sourceFor = (ext: ExternalPerson): string => {
    const key = refKey(ext.ref);
    const known = sourceByRef.get(key);
    if (known) return known;
    const name = [ext.givenNames, ext.surname].filter(Boolean).join(" ") || ext.ref.id;
    const id = sid.take();
    sources.set(id, { id, title: `${label(ext.ref.system)}: ${name}`, url: ext.url, externalRefs: [ext.ref] });
    sourceByRef.set(key, id);
    return id;
  };

  const lifeEvent = (e: ExternalEvent | undefined, cite: Citation): LifeEvent | undefined =>
    e && (e.date || e.place)
      ? {
          date: e.date,
          place: e.place ? { name: e.place } : undefined,
          status: "assumed",
          citations: [cite],
        }
      : undefined;

  const note = (ext: ExternalPerson) =>
    `Übernommen aus ${label(ext.ref.system)} (vermutet, nicht geprüft): ${ext.url}` +
    (ext.summary ? ` – ${ext.summary}` : "");

  let addedPersons = 0;
  let reusedPersons = 0;
  const idOf = new Map<string, PersonId>(); // refKey → Person im Baum
  const created: PersonId[] = [];

  const resolve = (ext: ExternalPerson, isRoot: boolean): PersonId => {
    const key = refKey(ext.ref);
    const done = idOf.get(key);
    if (done) return done;
    const existing = byRef.get(key);
    if (existing) {
      reusedPersons++;
      idOf.set(key, existing);
      return existing;
    }
    if (isRoot && opts.linkTo) {
      // Verweis und Notiz (mit Link) an die vorhandene Person hängen; ihre Daten bleiben unverändert.
      // Keine Quelle: sie würde an keiner Aussage hängen.
      const p = persons.get(opts.linkTo)!;
      persons.set(p.id, {
        ...p,
        externalRefs: [...(p.externalRefs ?? []), ext.ref],
        notes: [...(p.notes ?? []), note(ext)],
      });
      byRef.set(key, p.id);
      idOf.set(key, p.id);
      return p.id;
    }
    const cite: Citation = { sourceId: sourceFor(ext) };
    const id = pid.take();
    persons.set(id, {
      id,
      givenNames: ext.givenNames,
      surname: ext.surname,
      sex: ext.sex,
      birth: lifeEvent(ext.birth, cite),
      death: lifeEvent(ext.death, cite),
      notes: [note(ext)],
      externalRefs: [ext.ref],
      status: "assumed",
    });
    byRef.set(key, id);
    idOf.set(key, id);
    created.push(id);
    addedPersons++;
    return id;
  };

  const extByKey = new Map(batch.people.map((p) => [refKey(p.ref), p]));
  const root = extByKey.get(refKey(batch.root));
  if (!root) throw new Error("Der Treffer enthält seine Wurzelperson nicht.");
  const rootId = resolve(root, true);
  if (includeRelatives) for (const p of batch.people) resolve(p, false);

  let addedUnions = 0;
  const keyOf = (ids: PersonId[]) => [...ids].sort().join("|");
  if (includeRelatives) {
    // Die Kinder-Verknüpfung (biologisch) darf pro Kind nur in einer Union stehen (Invariante).
    const bioParent = new Map<PersonId, string>();
    for (const u of unions.values()) for (const c of u.children) if (c.kind === "biological") bioParent.set(c.personId, u.id);

    for (const eu of batch.unions) {
      const partnerIds = eu.partners.map((r) => idOf.get(refKey(r)));
      const childIds = eu.children.map((r) => idOf.get(refKey(r)));
      if (partnerIds.some((x) => !x) || childIds.some((x) => !x)) {
        notes.push("Eine Partnerschaft wurde übersprungen, weil die Quelle beteiligte Personen nicht lieferte.");
        continue;
      }
      const partners = partnerIds as PersonId[];
      const kids = childIds as PersonId[];
      const wanted = keyOf(partners);
      let target = [...unions.values()].find((u) => u.partnerIds.length > 0 && keyOf(u.partnerIds) === wanted);
      const fresh = !target;
      if (!target) {
        if (partners.length === 0 && kids.length === 0) continue;
        target = {
          id: uid.take(),
          partnerIds: partners,
          kind: eu.marriage ? "marriage" : "unknown",
          start: eu.marriage && (eu.marriage.date || eu.marriage.place)
            ? { date: eu.marriage.date, place: eu.marriage.place ? { name: eu.marriage.place } : undefined, status: "assumed" }
            : undefined,
          end: eu.end?.date ? { date: eu.end.date, status: "assumed" } : undefined,
          children: [],
          status: "assumed",
        };
      } else {
        target = { ...target, children: [...target.children] };
      }
      let added = 0;
      for (const kid of kids) {
        if (target.children.some((c) => c.personId === kid)) continue;
        const other = bioParent.get(kid);
        if (other && other !== target.id) {
          notes.push(`Kind ${kid} hat schon andere Eltern im Baum; die Verknüpfung wurde nicht ergänzt.`);
          continue;
        }
        const link: ChildLink = { personId: kid, kind: "biological", status: "assumed" };
        target.children.push(link);
        bioParent.set(kid, target.id);
        added++;
      }
      if (fresh) {
        // Keine leere Union ohne Kinder, wenn nur ein Partner bekannt ist
        if (partners.length < 2 && target.children.length === 0) continue;
        unions.set(target.id, target);
        addedUnions++;
      } else if (added > 0) {
        unions.set(target.id, target);
      }
    }
  }

  // Ähnlichkeitshinweise: nur zur Prüfung, nichts wird verändert.
  const finder = new DuplicateFinder(base.persons);
  const possibleDuplicates: AdoptResult["possibleDuplicates"] = [];
  for (const id of created) {
    const p = persons.get(id)!;
    for (const c of finder.find(
      { givenNames: p.givenNames, surname: p.surname, sex: p.sex, birthYear: p.birth?.date?.year, deathYear: p.death?.date?.year },
      { limit: 1, minScore: 0.65 },
    )) {
      if (preexisting.has(c.personId) && c.personId !== id) possibleDuplicates.push({ newId: id, existingId: c.personId });
    }
  }

  return {
    data: { version: 1, persons: [...persons.values()], unions: [...unions.values()], sources: [...sources.values()] },
    rootId,
    addedPersons,
    addedUnions,
    reusedPersons,
    possibleDuplicates,
    notes,
  };
}

/** Kurztext für Listen: „* 1850, † 1920“ aus einem externen Treffer. */
export function describeLifespan(p: ExternalPerson): string {
  const b = p.birth?.date ? formatFuzzyDate(p.birth.date) : "";
  const d = p.death?.date ? formatFuzzyDate(p.death.date) : "";
  return [b && `* ${b}`, d && `† ${d}`].filter(Boolean).join(", ");
}
