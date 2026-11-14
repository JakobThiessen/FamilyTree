/**
 * Zeitleiste: Lebensbalken mit unscharfen Daten. Reines TypeScript (kein DOM), siehe docs/DECISIONS.md D30.
 *
 * Jede Person wird zu einem Balken von „Beginn“ bis „Ende“. Fehlt ein Datum, wird es aus der Umgebung
 * geschätzt (Kinder, Eltern, Lebensdauer) und als `startDerived` / `endDerived` markiert, damit die Darstellung
 * es blass zeichnen kann. Unscharfe Daten („um“, „vor“, „nach“, „zwischen“) liefern einen Rand (`Range`).
 */

import type { FamilyGraph } from "./graph";
import { ancestorLevels, descendantLevels } from "./ancestry";
import type { FuzzyDate, Person, PersonId } from "./types";

/** Jahresspanne, in der ein Datum liegen kann. */
export interface Range {
  from: number;
  to: number;
}

export type MarkerKind = "union" | "child";

export interface TimelineMarker {
  year: number;
  kind: MarkerKind;
  /** z. B. „Heirat mit Anna Muster“ oder „Geburt von Karl“ */
  label: string;
}

export interface TimelineRow {
  personId: PersonId;
  name: string;
  surname: string | undefined;
  /** bester Schätzwert des Beginns (Geburt) und des Endes (Tod) in Jahren */
  start: number;
  end: number;
  /** Spanne aus dem unscharfen Datum; `null`, wenn es kein Datum gibt */
  birth: Range | null;
  death: Range | null;
  /** Beginn bzw. Ende ist geschätzt (kein Datum vorhanden) */
  startDerived: boolean;
  endDerived: boolean;
  /** Kein Todesdatum und nach Schätzung noch am Leben */
  maybeLiving: boolean;
  markers: TimelineMarker[];
}

export interface TimelineOptions {
  /** Annahme für die Lebensdauer, wenn nur ein Datum bekannt ist (Standard 70) */
  lifespan?: number;
  /** Annahme für das Elternalter bei der Geburt (Standard 30) */
  parentAge?: number;
  /** Jahr „heute“ (Standard: aktuelles Jahr); begrenzt Schätzungen für Lebende */
  currentYear?: number;
  /** höchstens so viele Zeilen; mehr werden um `aroundYear` herum ausgewählt (Standard 600) */
  maxRows?: number;
  /** Jahr, um das herum bei Überlänge ausgewählt wird (Standard: Median der Beginne) */
  aroundYear?: number;
}

export interface Timeline {
  rows: TimelineRow[];
  /** Zahl der Personen der Auswahl, für die sich gar kein Zeitpunkt schätzen ließ */
  undated: number;
  /** Zahl der datierbaren Personen vor dem Kürzen */
  total: number;
  truncated: boolean;
  minYear: number;
  maxYear: number;
}

/** Spanne eines unscharfen Datums, mit begrenzten Rändern bei „vor“ und „nach“ (±10 Jahre) und „um“ (±3). */
export function dateRange(d: FuzzyDate | undefined): Range | null {
  if (!d || d.year === undefined) return null;
  switch (d.kind) {
    case "exact":
      return { from: d.year, to: d.year };
    case "about":
      return { from: d.year - 3, to: d.year + 3 };
    case "before":
      return { from: d.year - 10, to: d.year };
    case "after":
      return { from: d.year, to: d.year + 10 };
    case "between":
      return { from: d.year, to: d.yearTo ?? d.year };
  }
}

/** Ein Jahr als Schätzwert: Mitte der Spanne. */
const point = (r: Range | null): number | null => (r ? (r.from + r.to) / 2 : null);

export type TimelineScope = "lineage" | "all";

/**
 * Auswahl der Personen: `lineage` = Fokusperson, Vorfahren und Nachfahren bis `depth` Generationen,
 * `all` = alle Personen des Baums.
 */
export function timelinePersonIds(
  g: FamilyGraph,
  focusId: PersonId,
  scope: TimelineScope,
  depth = 5,
): PersonId[] {
  if (scope === "all") return [...g.persons()].map((p) => p.id);
  if (!g.hasPerson(focusId)) return [];
  const ids = new Set<PersonId>();
  for (const level of ancestorLevels(g, focusId, { maxDepth: depth })) for (const id of level) ids.add(id);
  for (const level of descendantLevels(g, focusId, { maxDepth: depth })) for (const id of level) ids.add(id);
  return [...ids];
}

const personName = (p: Person | undefined): string =>
  [p?.givenNames, p?.surname].filter(Boolean).join(" ").trim() || "Unbekannt";

/** Baut Lebensbalken für die genannten Personen (Reihenfolge: Beginn, dann ID). */
export function buildTimeline(g: FamilyGraph, ids: Iterable<PersonId>, opts: TimelineOptions = {}): Timeline {
  const lifespan = opts.lifespan ?? 70;
  const parentAge = opts.parentAge ?? 30;
  const now = opts.currentYear ?? new Date().getFullYear();
  const maxRows = opts.maxRows ?? 600;

  const birthOf = (id: PersonId): number | null => point(dateRange(g.getPerson(id)?.birth?.date));

  /** Beginn aus Kindern (frühestes Kind − Elternalter) oder Eltern (spätester Elternteil + Elternalter). */
  const guessBirth = (id: PersonId): number | null => {
    const kids = g.children(id).map(birthOf).filter((x): x is number => x !== null);
    if (kids.length) return Math.min(...kids) - parentAge;
    const parents = g.parents(id).map(birthOf).filter((x): x is number => x !== null);
    if (parents.length) return Math.max(...parents) + parentAge;
    return null;
  };

  const rows: TimelineRow[] = [];
  let undated = 0;

  for (const id of ids) {
    const p = g.getPerson(id);
    if (!p) continue;
    const birth = dateRange(p.birth?.date);
    const death = dateRange(p.death?.date);
    let start = point(birth);
    let end = point(death);
    let startDerived = false;
    let endDerived = false;

    if (start === null) {
      const guess = guessBirth(id) ?? (end !== null ? end - lifespan : null);
      if (guess === null) {
        undated++;
        continue;
      }
      start = guess;
      startDerived = true;
    }
    let maybeLiving = false;
    if (end === null) {
      endDerived = true;
      end = start + lifespan;
      if (end >= now) {
        end = Math.max(now, start + 1);
        maybeLiving = start > now - 110;
      }
    }
    if (end <= start) end = start + 1; // widersprüchliche Daten: Balken nicht verschwinden lassen

    const markers: TimelineMarker[] = [];
    for (const u of g.unionsOf(id)) {
      const year = point(dateRange(u.start?.date));
      if (year !== null) {
        const partner = u.partnerIds.find((x) => x !== id);
        markers.push({ year, kind: "union", label: `Heirat${partner ? " mit " + personName(g.getPerson(partner)) : ""}` });
      }
      for (const c of u.children) {
        const cy = birthOf(c.personId);
        if (cy !== null) markers.push({ year: cy, kind: "child", label: `Geburt von ${personName(g.getPerson(c.personId))}` });
      }
    }
    markers.sort((a, b) => a.year - b.year);

    rows.push({
      personId: id,
      name: personName(p),
      surname: p.surname,
      start,
      end,
      birth,
      death,
      startDerived,
      endDerived,
      maybeLiving,
      markers,
    });
  }

  const total = rows.length;
  let selected = rows;
  const truncated = total > maxRows;
  if (truncated) {
    let around = opts.aroundYear;
    if (around === undefined) {
      const sorted = rows.map((r) => r.start).sort((a, b) => a - b);
      around = sorted[Math.floor(sorted.length / 2)] as number;
    }
    selected = [...rows]
      .sort((a, b) => Math.abs(a.start - around) - Math.abs(b.start - around) || (a.personId < b.personId ? -1 : 1))
      .slice(0, maxRows);
  }
  selected.sort((a, b) => a.start - b.start || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));

  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const r of selected) {
    minYear = Math.min(minYear, r.birth?.from ?? r.start);
    maxYear = Math.max(maxYear, r.death?.to ?? r.end);
  }
  if (!selected.length) {
    minYear = 0;
    maxYear = 0;
  }
  return { rows: selected, undated, total, truncated, minYear, maxYear };
}
