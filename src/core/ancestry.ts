/**
 * Vorfahren und Nachfahren je Tiefe sowie Ahnenschwund (Implex).
 * Reines TypeScript. Siehe docs/ARCHITECTURE.md (Prinzip 3 und 5) und docs/DECISIONS.md D14.
 *
 * Tiefe 0 = die Person selbst, Tiefe 1 = Eltern bzw. Kinder usw.
 */

import type { FamilyGraph, ParentOptions } from "./graph";
import type { PersonId } from "./types";

export interface DepthOptions extends ParentOptions {
  /** größte Tiefe (Standard: unbegrenzt, höchstens so viele Schichten wie Personen) */
  maxDepth?: number;
}

/** Obergrenze, damit auch kaputte Daten mit Zyklen terminieren (ein DAG hat < personCount Schichten). */
function depthLimit(g: FamilyGraph, opts: DepthOptions): number {
  return Math.min(opts.maxDepth ?? Infinity, g.personCount);
}

/**
 * Breitensuche in Schichten. Jede Person steht nur in der Schicht ihrer **kürzesten** Entfernung
 * (bei Ahnenschwund taucht ein Ahn nicht doppelt auf).
 */
function levelsBy(start: PersonId, next: (id: PersonId) => PersonId[], maxDepth: number): PersonId[][] {
  const seen = new Set<PersonId>([start]);
  const result: PersonId[][] = [[start]];
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: PersonId[] = [];
    for (const id of frontier) {
      for (const other of next(id)) {
        if (seen.has(other)) continue;
        seen.add(other);
        nextFrontier.push(other);
      }
    }
    if (nextFrontier.length === 0) break;
    result.push(nextFrontier);
    frontier = nextFrontier;
  }
  return result;
}

/** Vorfahren je Tiefe: `[[ich], [Eltern], [Großeltern], …]`. Unbekannte Person: leere Liste. */
export function ancestorLevels(g: FamilyGraph, id: PersonId, opts: DepthOptions = {}): PersonId[][] {
  if (!g.hasPerson(id)) return [];
  return levelsBy(id, (p) => g.parents(p, opts), depthLimit(g, opts));
}

/** Nachfahren je Tiefe: `[[ich], [Kinder], [Enkel], …]`. Unbekannte Person: leere Liste. */
export function descendantLevels(g: FamilyGraph, id: PersonId, opts: DepthOptions = {}): PersonId[][] {
  if (!g.hasPerson(id)) return [];
  return levelsBy(id, (p) => g.children(p, opts), depthLimit(g, opts));
}

/**
 * Zu jedem Vorfahren (und der Person selbst bei Tiefe 0): auf wie vielen Wegen er in welcher Tiefe
 * erreichbar ist (`Tiefe → Anzahl Wege`). Grundlage für Verwandtschaft und Ahnenschwund.
 * Rechnet schichtweise, kostet also höchstens (Tiefe × Vorfahren) und nicht die Zahl der Wege.
 */
export function ancestorProfile(
  g: FamilyGraph,
  id: PersonId,
  opts: DepthOptions = {},
): Map<PersonId, Map<number, number>> {
  const profile = new Map<PersonId, Map<number, number>>();
  if (!g.hasPerson(id)) return profile;
  const limit = depthLimit(g, opts);
  let frontier = new Map<PersonId, number>([[id, 1]]);
  profile.set(id, new Map([[0, 1]]));
  for (let depth = 1; depth <= limit && frontier.size > 0; depth++) {
    const next = new Map<PersonId, number>();
    for (const [pid, paths] of frontier) {
      for (const parent of g.parents(pid, opts)) next.set(parent, (next.get(parent) ?? 0) + paths);
    }
    for (const [pid, paths] of next) {
      const perDepth = profile.get(pid);
      if (perDepth) perDepth.set(depth, paths);
      else profile.set(pid, new Map([[depth, paths]]));
    }
    frontier = next;
  }
  return profile;
}

/** Ein Ahn, der auf mehr als einem Weg erreichbar ist. */
export interface RepeatedAncestor {
  id: PersonId;
  /** Gesamtzahl der Wege von der Person zu diesem Ahn */
  pathCount: number;
  /** Tiefen, in denen er vorkommt (aufsteigend, ohne Wiederholung) */
  depths: number[];
}

export interface GenerationStats {
  depth: number;
  /** Anzahl der Wege dieser Tiefe (= bekannte Ahnenplätze, Doppelte mitgezählt) */
  paths: number;
  /** Anzahl verschiedener Personen in dieser Tiefe */
  distinct: number;
}

export interface PedigreeCollapse {
  /** Ahnen mit mehr als einem Weg, sortiert nach kleinster Tiefe, dann ID */
  repeated: RepeatedAncestor[];
  /** Statistik je Tiefe (ab Tiefe 1) */
  generations: GenerationStats[];
  /**
   * Ahnenverlust (Implex): Anteil der Ahnenplätze, die durch einen schon gezählten Ahn belegt sind.
   * 0 = jeder Platz eine andere Person, nahe 1 = fast nur Wiederholungen.
   */
  implex: number;
}

/**
 * Erkennt Ahnenschwund (Ahnenverlust): dieselbe Person als Vorfahr auf mehreren Wegen,
 * z. B. nach einer Heirat unter Cousins. Die Person steckt nur einmal im Graphen (D1);
 * hier wird nur gezählt, wo sie mehrfach erreichbar ist.
 */
export function pedigreeCollapse(g: FamilyGraph, id: PersonId, opts: DepthOptions = {}): PedigreeCollapse {
  const profile = ancestorProfile(g, id, opts);
  const repeated: RepeatedAncestor[] = [];
  const perDepth = new Map<number, { paths: number; distinct: number }>();
  let totalPaths = 0;

  for (const [pid, byDepth] of profile) {
    if (pid === id) continue;
    let pathCount = 0;
    for (const [depth, count] of byDepth) {
      pathCount += count;
      const stat = perDepth.get(depth) ?? { paths: 0, distinct: 0 };
      stat.paths += count;
      stat.distinct += 1;
      perDepth.set(depth, stat);
    }
    totalPaths += pathCount;
    if (pathCount > 1) repeated.push({ id: pid, pathCount, depths: [...byDepth.keys()].sort((x, y) => x - y) });
  }

  repeated.sort((x, y) => (x.depths[0] as number) - (y.depths[0] as number) || (x.id < y.id ? -1 : 1));
  const generations = [...perDepth.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([depth, s]) => ({ depth, paths: s.paths, distinct: s.distinct }));
  const distinctTotal = Math.max(profile.size - 1, 0);
  const implex = totalPaths === 0 ? 0 : 1 - distinctTotal / totalPaths;
  return { repeated, generations, implex };
}

/** Kurzform: hat die Person Ahnenschwund? */
export function hasPedigreeCollapse(g: FamilyGraph, id: PersonId, opts: DepthOptions = {}): boolean {
  return pedigreeCollapse(g, id, opts).repeated.length > 0;
}
