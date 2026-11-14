/**
 * Schritt 1: Welche Personen gehören zur Ansicht? (Ansicht = Fokus + Tiefe nach oben/unten + Modus)
 * Reines TypeScript. Siehe docs/DECISIONS.md D17.
 *
 * - `direct`: nur die Linie, also Fokus, seine Vorfahren (bis `up`) und Nachfahren (bis `down`).
 * - `family`: zusätzlich Partner aller Linienpersonen und Geschwister (auch Halbgeschwister) von Linienpersonen,
 *   deren Eltern in der Ansicht stehen. Diese Zusatzpersonen sind Blätter (ohne eigene Kinder/Eltern).
 * - `all`: alles, was über Eltern, Kinder und Partner erreichbar ist, solange die Schicht zwischen −up und +down liegt.
 *
 * Die Tiefe zählt wie in M4 über den **kürzesten** Weg (`ancestorLevels`). Wer über einen längeren Weg
 * tiefer liegt, steht trotzdem in seiner tiefsten Schicht (siehe layers.ts).
 */
import { ancestorLevels, descendantLevels } from "../ancestry";
import type { FamilyGraph } from "../graph";
import type { PersonId, ViewRequest } from "../types";

export interface ViewSelection {
  focusId: PersonId;
  /** alle Personen der Ansicht (Einfügereihenfolge ist deterministisch) */
  persons: Set<PersonId>;
  /** Fokus, Vorfahren und Nachfahren (die „Linie“); alles andere sind Zusatzpersonen */
  line: Set<PersonId>;
}

function clampDepth(n: number): number {
  if (!Number.isFinite(n)) return n > 0 ? Number.MAX_SAFE_INTEGER : 0;
  return Math.max(0, Math.floor(n));
}

export function selectView(g: FamilyGraph, req: ViewRequest): ViewSelection {
  const focusId = req.focusId;
  const persons = new Set<PersonId>();
  const line = new Set<PersonId>();
  if (!g.hasPerson(focusId)) return { focusId, persons, line };

  const up = clampDepth(req.up);
  const down = clampDepth(req.down);

  /** vorläufige Schicht je Linienperson (nur für das Fenster im Modus `all`) */
  const natural = new Map<PersonId, number>();
  ancestorLevels(g, focusId, { maxDepth: up }).forEach((level, depth) => {
    for (const id of level) {
      line.add(id);
      natural.set(id, -depth);
    }
  });
  descendantLevels(g, focusId, { maxDepth: down }).forEach((level, depth) => {
    for (const id of level) {
      line.add(id);
      if (!natural.has(id)) natural.set(id, depth);
    }
  });

  for (const id of line) persons.add(id);

  if (req.mode === "family") {
    for (const id of line) {
      for (const partner of g.partners(id)) persons.add(partner);
      // Geschwister nur, wenn mindestens ein Elternteil in der Linie steht (sonst fehlt das Elternband).
      for (const link of g.parentLinks(id)) {
        for (const parentId of link.union.partnerIds) {
          if (!line.has(parentId)) continue;
          for (const union of g.unionsOf(parentId)) {
            for (const child of union.children) if (g.hasPerson(child.personId)) persons.add(child.personId);
          }
        }
      }
    }
  } else if (req.mode === "all") {
    const queue: PersonId[] = [...line];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i] as PersonId;
      const layer = natural.get(id) as number;
      const visit = (other: PersonId, otherLayer: number): void => {
        if (natural.has(other) || otherLayer < -up || otherLayer > down) return;
        natural.set(other, otherLayer);
        persons.add(other);
        queue.push(other);
      };
      for (const p of g.parents(id)) visit(p, layer - 1);
      for (const c of g.children(id)) visit(c, layer + 1);
      for (const p of g.partners(id)) visit(p, layer);
    }
  }

  return { focusId, persons, line };
}
