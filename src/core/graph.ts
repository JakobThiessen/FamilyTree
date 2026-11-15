/**
 * FamilyGraph: Personen und Unions mit Indizes für schnelle Abfragen.
 * Reines TypeScript. Siehe docs/DATA-MODEL.md und docs/ARCHITECTURE.md.
 *
 * Idee: Eine Person kommt genau einmal vor. Eltern-Kind-Beziehungen laufen über Unions.
 * Bei Heirat unter Cousins gibt es zwei Wege zum selben Ahn, aber nur eine Person-Instanz.
 */

import { compareFuzzyDate } from "./fuzzyDate";
import type { ChildLink, Person, PersonId, TreeData, Union, UnionId } from "./types";

export type IssueCode =
  | "duplicate-person"
  | "duplicate-union"
  | "dangling-partner"
  | "dangling-child"
  | "too-many-partners"
  | "duplicate-partner"
  | "duplicate-child-link"
  | "multiple-biological-unions"
  | "parent-cycle";

/** Ein Verstoß gegen eine Invariante. `ids` nennt die beteiligten Personen/Unions. */
export interface ValidationIssue {
  code: IssueCode;
  message: string;
  /** Werte für die Übersetzung der Meldung (UI: `issue.<code>`) */
  params?: Record<string, string | number>;
  ids: string[];
}

/** Eine Eltern-Union einer Person samt Art der Verknüpfung. */
export interface ParentLink {
  union: Union;
  link: ChildLink;
}

export interface Siblings {
  /** gleiche Union (gleiche Eltern) */
  full: PersonId[];
  /** mindestens ein gemeinsamer Elternteil, aber andere Union */
  half: PersonId[];
}

export interface ParentOptions {
  /** nur leibliche Eltern (Standard: alle Verknüpfungsarten) */
  biologicalOnly?: boolean;
}

/** Sortierung der Unions einer Person: Ehe-Reihenfolge, dann Beginn, dann ID. */
function compareUnions(a: Union, b: Union): number {
  const oa = a.order ?? Infinity;
  const ob = b.order ?? Infinity;
  if (oa !== ob) return oa < ob ? -1 : 1;
  const byDate = compareFuzzyDate(a.start?.date, b.start?.date);
  if (byDate !== 0) return byDate;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class FamilyGraph {
  private readonly personById = new Map<PersonId, Person>();
  private readonly unionById = new Map<UnionId, Union>();
  /** Person -> Unions, in denen sie Partner ist (sortiert nach Ehe-Reihenfolge) */
  private readonly asPartner = new Map<PersonId, Union[]>();
  /** Person -> Unions, in denen sie Kind ist */
  private readonly asChild = new Map<PersonId, ParentLink[]>();
  /** Probleme, die schon beim Aufbau auffielen (Dubletten, hängende Verweise) */
  private readonly buildIssues: ValidationIssue[] = [];

  /**
   * Baut den Graphen. Fehlerhafte Daten werfen nicht, sondern werden übersprungen
   * und in `validate()` gemeldet. So lässt sich auch ein kaputter Import untersuchen.
   */
  constructor(data: Pick<TreeData, "persons" | "unions">) {
    for (const p of data.persons) {
      if (this.personById.has(p.id)) {
        this.buildIssues.push({
          code: "duplicate-person",
          message: `Person-ID ${p.id} kommt mehrfach vor (die erste gilt).`,
params: { id: p.id },
          ids: [p.id],
        });
        continue;
      }
      this.personById.set(p.id, p);
    }

    for (const u of data.unions) {
      if (this.unionById.has(u.id)) {
        this.buildIssues.push({
          code: "duplicate-union",
          message: `Union-ID ${u.id} kommt mehrfach vor (die erste gilt).`,
params: { id: u.id },
          ids: [u.id],
        });
        continue;
      }
      this.unionById.set(u.id, u);
      this.indexUnion(u);
    }

    for (const list of this.asPartner.values()) list.sort(compareUnions);
  }

  private indexUnion(u: Union): void {
    if (u.partnerIds.length > 2) {
      this.buildIssues.push({
        code: "too-many-partners",
        message: `Union ${u.id} hat ${u.partnerIds.length} Partner (erlaubt: höchstens 2).`,
params: { id: u.id, n: u.partnerIds.length },
        ids: [u.id],
      });
    }

    const seenPartners = new Set<PersonId>();
    for (const pid of u.partnerIds) {
      if (!this.personById.has(pid)) {
        this.buildIssues.push({
          code: "dangling-partner",
          message: `Union ${u.id} verweist auf unbekannte Person ${pid}.`,
params: { id: u.id, person: pid },
          ids: [u.id, pid],
        });
        continue;
      }
      if (seenPartners.has(pid)) {
        this.buildIssues.push({
          code: "duplicate-partner",
          message: `Union ${u.id} enthält ${pid} doppelt.`,
params: { id: u.id, person: pid },
          ids: [u.id, pid],
        });
        continue;
      }
      seenPartners.add(pid);
      pushTo(this.asPartner, pid, u);
    }

    const seenChildren = new Set<PersonId>();
    for (const link of u.children) {
      if (!this.personById.has(link.personId)) {
        this.buildIssues.push({
          code: "dangling-child",
          message: `Union ${u.id} verweist auf unbekanntes Kind ${link.personId}.`,
params: { id: u.id, person: link.personId },
          ids: [u.id, link.personId],
        });
        continue;
      }
      if (seenChildren.has(link.personId)) {
        this.buildIssues.push({
          code: "duplicate-child-link",
          message: `Kind ${link.personId} steht in Union ${u.id} doppelt.`,
params: { id: u.id, person: link.personId },
          ids: [u.id, link.personId],
        });
        continue;
      }
      seenChildren.add(link.personId);
      pushTo(this.asChild, link.personId, { union: u, link });
    }
  }

  // ---------------------------------------------------------------- Zugriff

  get personCount(): number {
    return this.personById.size;
  }

  get unionCount(): number {
    return this.unionById.size;
  }

  hasPerson(id: PersonId): boolean {
    return this.personById.has(id);
  }

  getPerson(id: PersonId): Person | undefined {
    return this.personById.get(id);
  }

  getUnion(id: UnionId): Union | undefined {
    return this.unionById.get(id);
  }

  persons(): IterableIterator<Person> {
    return this.personById.values();
  }

  unions(): IterableIterator<Union> {
    return this.unionById.values();
  }

  // ---------------------------------------------------------------- Abfragen

  /** Unions, in denen die Person Partner ist, in Ehe-Reihenfolge. */
  unionsOf(id: PersonId): Union[] {
    return [...(this.asPartner.get(id) ?? [])];
  }

  /** Unions, in denen die Person als Kind steht (mit Verknüpfungsart). */
  parentLinks(id: PersonId): ParentLink[] {
    return [...(this.asChild.get(id) ?? [])];
  }

  /** Eltern (ohne Dubletten). */
  parents(id: PersonId, opts: ParentOptions = {}): PersonId[] {
    const result = new Set<PersonId>();
    for (const { union, link } of this.asChild.get(id) ?? []) {
      if (opts.biologicalOnly && link.kind !== "biological") continue;
      for (const pid of union.partnerIds) if (this.personById.has(pid)) result.add(pid);
    }
    return [...result];
  }

  /** Kinder aller Unions, in Ehe-Reihenfolge der Unions (ohne Dubletten). */
  children(id: PersonId, opts: ParentOptions = {}): PersonId[] {
    const result = new Set<PersonId>();
    for (const union of this.asPartner.get(id) ?? []) {
      for (const link of union.children) {
        if (opts.biologicalOnly && link.kind !== "biological") continue;
        if (this.personById.has(link.personId)) result.add(link.personId);
      }
    }
    return [...result];
  }

  /** Partner in Ehe-Reihenfolge (ohne Dubletten). */
  partners(id: PersonId): PersonId[] {
    const result = new Set<PersonId>();
    for (const union of this.asPartner.get(id) ?? []) {
      for (const pid of union.partnerIds) {
        if (pid !== id && this.personById.has(pid)) result.add(pid);
      }
    }
    return [...result];
  }

  /**
   * Geschwister. Voll = gleiche Union, halb = gemeinsamer Elternteil in anderer Union.
   * Wer beides erfüllt (z. B. wegen Adoption in zwei Unions), zählt als voll.
   */
  siblings(id: PersonId): Siblings {
    const full = new Set<PersonId>();
    const half = new Set<PersonId>();
    const myUnions = this.asChild.get(id) ?? [];
    const myUnionIds = new Set(myUnions.map((l) => l.union.id));

    for (const { union } of myUnions) {
      for (const link of union.children) {
        if (link.personId !== id && this.personById.has(link.personId)) full.add(link.personId);
      }
    }
    for (const { union } of myUnions) {
      for (const parentId of union.partnerIds) {
        for (const other of this.asPartner.get(parentId) ?? []) {
          if (myUnionIds.has(other.id)) continue;
          for (const link of other.children) {
            if (link.personId === id || full.has(link.personId)) continue;
            if (this.personById.has(link.personId)) half.add(link.personId);
          }
        }
      }
    }
    return { full: [...full], half: [...half] };
  }

  /**
   * Stiefeltern: Partner der Eltern in Unions, in denen die Person nicht Kind ist,
   * und die selbst nicht Elternteil der Person sind.
   */
  stepParents(id: PersonId): PersonId[] {
    const realParents = new Set(this.parents(id));
    const myUnionIds = new Set((this.asChild.get(id) ?? []).map((l) => l.union.id));
    const result = new Set<PersonId>();
    for (const parentId of realParents) {
      for (const union of this.asPartner.get(parentId) ?? []) {
        if (myUnionIds.has(union.id)) continue;
        for (const pid of union.partnerIds) {
          if (pid !== parentId && !realParents.has(pid) && this.personById.has(pid)) result.add(pid);
        }
      }
    }
    return [...result];
  }

  /**
   * Stiefkinder: Kinder der Partner aus deren anderen Unions,
   * die nicht (auch) Kinder dieser Person sind.
   */
  stepChildren(id: PersonId): PersonId[] {
    const ownChildren = new Set(this.children(id));
    const myUnionIds = new Set((this.asPartner.get(id) ?? []).map((u) => u.id));
    const result = new Set<PersonId>();
    for (const partnerId of this.partners(id)) {
      for (const union of this.asPartner.get(partnerId) ?? []) {
        if (myUnionIds.has(union.id)) continue;
        for (const link of union.children) {
          if (ownChildren.has(link.personId) || link.personId === id) continue;
          if (this.personById.has(link.personId)) result.add(link.personId);
        }
      }
    }
    return [...result];
  }

  // -------------------------------------------------------------- Validierung

  /** Prüft alle Invarianten aus docs/DATA-MODEL.md. Leere Liste = in Ordnung. */
  validate(): ValidationIssue[] {
    const issues = [...this.buildIssues];

    for (const [childId, links] of this.asChild) {
      const bio = links.filter((l) => l.link.kind === "biological");
      if (bio.length > 1) {
        issues.push({
          code: "multiple-biological-unions",
          message: `Kind ${childId} steht in ${bio.length} biologischen Unions.`,
params: { person: childId, n: bio.length },
          ids: [childId, ...bio.map((l) => l.union.id)],
        });
      }
    }

    issues.push(...this.findParentCycles());
    return issues;
  }

  /**
   * Sucht Zyklen in den Eltern→Kind-Kanten (jemand wäre sein eigener Vorfahr).
   * Iterative Tiefensuche, damit auch sehr tiefe Bäume keinen Stack sprengen.
   */
  private findParentCycles(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<PersonId, number>();
    const next = (id: PersonId): PersonId[] => this.children(id);

    for (const startId of this.personById.keys()) {
      if ((color.get(startId) ?? WHITE) !== WHITE) continue;
      const path: PersonId[] = [startId];
      const iters: PersonId[][] = [next(startId)];
      const pos: number[] = [0];
      color.set(startId, GRAY);

      while (path.length > 0) {
        const top = path.length - 1;
        const list = iters[top] ?? [];
        const i = pos[top] ?? 0;
        if (i >= list.length) {
          color.set(path[top] as PersonId, BLACK);
          path.pop();
          iters.pop();
          pos.pop();
          continue;
        }
        pos[top] = i + 1;
        const child = list[i] as PersonId;
        const c = color.get(child) ?? WHITE;
        if (c === GRAY) {
          const cycle = [...path.slice(path.indexOf(child)), child];
          issues.push({
            code: "parent-cycle",
            message: `Zyklus in Eltern-Kind-Beziehungen: ${cycle.join(" → ")}.`,
params: { cycle: cycle.join(" → ") },
            ids: cycle,
          });
        } else if (c === WHITE) {
          color.set(child, GRAY);
          path.push(child);
          iters.push(next(child));
          pos.push(0);
        }
      }
    }
    return issues;
  }
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
