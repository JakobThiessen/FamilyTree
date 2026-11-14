/**
 * Ahnentafel mit Sosa-Stradonitz-Nummern, Ahnenschwund und Inzucht in einem Aufruf.
 * Reines TypeScript. Siehe docs/DECISIONS.md D29.
 *
 * Sosa-Nummern: Person = 1, Vater = 2n, Mutter = 2n + 1 (n = Nummer des Kindes).
 * Tiefe 0 = die Person selbst, Tiefe 1 = Eltern (Nummern 2–3) usw.
 */

import type { FamilyGraph } from "./graph";
import { pedigreeCollapse } from "./ancestry";
import type { PedigreeCollapse } from "./ancestry";
import { inbreedingCoefficient } from "./inbreeding";
import type { PersonId } from "./types";

export interface AhnentafelOptions {
  /** größte Tiefe (Standard 8, höchstens 30, damit Sosa-Nummern exakte Zahlen bleiben) */
  maxDepth?: number;
  /** höchstens so viele Zeilen (Standard 5000); danach ist `truncated` gesetzt */
  maxRows?: number;
}

export interface AhnentafelRow {
  sosa: number;
  /** Tiefe: 0 = Person selbst */
  generation: number;
  personId: PersonId;
  /** Ist die Person schon unter einer kleineren Sosa-Nummer aufgeführt (Ahnenschwund)? Dann diese Nummer. */
  duplicateOf?: number;
}

export interface AhnentafelGeneration {
  generation: number;
  /** mögliche Plätze (2^Tiefe) */
  slots: number;
  /** bekannte Plätze, Wiederholungen mitgezählt */
  known: number;
  rows: AhnentafelRow[];
}

export interface Ahnentafel {
  generations: AhnentafelGeneration[];
  /** Zeilenzahl insgesamt */
  rowCount: number;
  /** Zeilenlimit erreicht: weitere Ahnen wurden nicht mehr aufgeführt */
  truncated: boolean;
}

export const MAX_SOSA_DEPTH = 30;

/**
 * Vater und Mutter einer Person für die Sosa-Zählung: bevorzugt die leibliche Eltern-Union, sonst die erste.
 * Das Geschlecht entscheidet über die Plätze; ist es unbekannt oder doppelt, füllen die Partner der Reihe nach auf.
 */
export function fatherAndMother(g: FamilyGraph, id: PersonId): [PersonId | undefined, PersonId | undefined] {
  const links = g.parentLinks(id);
  const link = links.find((l) => l.link.kind === "biological") ?? links[0];
  if (!link) return [undefined, undefined];
  const ids = link.union.partnerIds.filter((p) => g.hasPerson(p));
  let father = ids.find((p) => g.getPerson(p)?.sex === "M");
  let mother = ids.find((p) => g.getPerson(p)?.sex === "F" && p !== father);
  for (const p of ids) {
    if (p === father || p === mother) continue;
    if (!father) father = p;
    else if (!mother) mother = p;
  }
  return [father, mother];
}

/**
 * Ahnentafel je Generation. Ein Ahn, der auf mehreren Wegen vorkommt, steht unter jeder Sosa-Nummer,
 * seine Eltern aber nur unter der ersten (`duplicateOf` verweist darauf). So bleibt die Tafel
 * höchstens so lang wie die Zahl der verschiedenen Ahnen, auch bei starkem Ahnenschwund.
 */
export function buildAhnentafel(g: FamilyGraph, id: PersonId, opts: AhnentafelOptions = {}): Ahnentafel {
  if (!g.hasPerson(id)) return { generations: [], rowCount: 0, truncated: false };
  const maxDepth = Math.max(0, Math.min(opts.maxDepth ?? 8, MAX_SOSA_DEPTH));
  const maxRows = opts.maxRows ?? 5000;
  const firstSosa = new Map<PersonId, number>([[id, 1]]);
  const generations: AhnentafelGeneration[] = [
    { generation: 0, slots: 1, known: 1, rows: [{ sosa: 1, generation: 0, personId: id }] },
  ];
  let rowCount = 1;
  let truncated = false;
  let frontier: AhnentafelRow[] = [generations[0]!.rows[0]!];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0 && !truncated; depth++) {
    const gen: AhnentafelGeneration = { generation: depth, slots: 2 ** depth, known: 0, rows: [] };
    const next: AhnentafelRow[] = [];
    for (const child of frontier) {
      if (child.duplicateOf !== undefined) continue; // Eltern stehen schon bei der ersten Nennung
      const [father, mother] = fatherAndMother(g, child.personId);
      for (const [pid, sosa] of [
        [father, child.sosa * 2],
        [mother, child.sosa * 2 + 1],
      ] as const) {
        if (!pid) continue;
        if (rowCount >= maxRows) {
          truncated = true;
          break;
        }
        const dup = firstSosa.get(pid);
        const row: AhnentafelRow = { sosa, generation: depth, personId: pid };
        if (dup !== undefined) row.duplicateOf = dup;
        else firstSosa.set(pid, sosa);
        gen.rows.push(row);
        gen.known++;
        rowCount++;
        next.push(row);
      }
      if (truncated) break;
    }
    if (gen.rows.length > 0) generations.push(gen);
    frontier = next;
  }
  return { generations, rowCount, truncated };
}

export interface PedigreeReport {
  tafel: Ahnentafel;
  collapse: PedigreeCollapse;
  /** Inzuchtkoeffizient der Person (0 bei unbekannten Eltern) */
  inbreeding: number;
}

/** Alles für den Reiter „Ahnen“ aus einer Hand. */
export function pedigreeReport(g: FamilyGraph, id: PersonId, opts: AhnentafelOptions = {}): PedigreeReport {
  const maxDepth = Math.min(opts.maxDepth ?? 8, MAX_SOSA_DEPTH);
  return {
    tafel: buildAhnentafel(g, id, opts),
    collapse: pedigreeCollapse(g, id, { maxDepth }),
    inbreeding: inbreedingCoefficient(g, id),
  };
}
