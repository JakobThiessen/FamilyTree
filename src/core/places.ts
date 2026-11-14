/**
 * Orte und Lebenswege. Reines TypeScript (kein DOM), siehe docs/DECISIONS.md D31.
 *
 * `collectPlaces` fasst alle Ortsangaben (Geburt, Tod, Beginn/Ende einer Union) nach Ortsname zusammen;
 * `lifePaths` ordnet die Orte jeder Person zeitlich zu einem Lebensweg. Koordinaten kommen aus dem Ort
 * selbst (z. B. GEDCOM `MAP`) oder aus einem Zusatz (`known`), den der Nutzer per Wikidata-Abfrage füllt.
 */

import type { FamilyGraph } from "./graph";
import type { LifeEvent, Person, PersonId } from "./types";

export type PlaceEventKind = "birth" | "death" | "union";

export interface Coordinates {
  lat: number;
  lon: number;
}

/** Zusatzwissen über Orte: Schlüssel = `placeKey(name)`. */
export type KnownPlaces = ReadonlyMap<string, Coordinates>;

export interface PlaceEvent {
  personId: PersonId;
  kind: PlaceEventKind;
  year?: number;
}

export interface PlaceStat {
  /** normalisierter Name, siehe `placeKey` */
  key: string;
  /** Anzeigename (erste Schreibweise) */
  name: string;
  coords?: Coordinates;
  /** woher die Koordinaten stammen: aus den Daten oder per Abfrage (nur vermutet) */
  coordsFrom?: "data" | "lookup";
  events: PlaceEvent[];
  /** Zahl verschiedener Personen */
  persons: number;
}

export interface PathStop {
  key: string;
  name: string;
  kind: PlaceEventKind;
  year?: number;
  coords?: Coordinates;
}

export interface LifePath {
  personId: PersonId;
  name: string;
  surname: string | undefined;
  /** Jahr der Geburt/des Todes, soweit bekannt (für die Liste) */
  birthYear?: number;
  deathYear?: number;
  /** Stationen in zeitlicher Folge, aufeinanderfolgende gleiche Orte zusammengefasst */
  stops: PathStop[];
}

/** Vergleichsschlüssel eines Ortsnamens: Kleinschreibung, einfache Leerzeichen. */
export function placeKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const validCoords = (lat: number | undefined, lon: number | undefined): Coordinates | undefined =>
  lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;

const yearOf = (ev: LifeEvent | undefined): number | undefined => ev?.date?.year;
const nameOf = (p: Person | undefined): string =>
  [p?.givenNames, p?.surname].filter(Boolean).join(" ").trim() || "Unbekannt";

interface RawEvent {
  personId: PersonId;
  kind: PlaceEventKind;
  year: number | undefined;
  name: string;
  coords: Coordinates | undefined;
}

/** Alle Ereignisse mit Ortsangabe der Personen, je Person in zeitlicher Folge. */
function eventsOf(g: FamilyGraph, id: PersonId): RawEvent[] {
  const p = g.getPerson(id);
  if (!p) return [];
  const out: RawEvent[] = [];
  const add = (kind: PlaceEventKind, ev: LifeEvent | undefined) => {
    const name = ev?.place?.name?.trim();
    if (!name) return;
    out.push({ personId: id, kind, year: yearOf(ev), name, coords: validCoords(ev?.place?.lat, ev?.place?.lon) });
  };
  add("birth", p.birth);
  for (const u of g.unionsOf(id)) {
    add("union", u.start);
    add("union", u.end);
  }
  add("death", p.death);
  // Geburt zuerst, Tod zuletzt; dazwischen nach Jahr (ohne Jahr bleibt die Reihenfolge der Daten)
  const rank = (e: RawEvent) => (e.kind === "birth" ? 0 : e.kind === "death" ? 2 : 1);
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || (a.e.year ?? Infinity) - (b.e.year ?? Infinity) || a.i - b.i)
    .map((x) => x.e);
}

/** Orte aller genannten Personen (Standard: alle), nach Zahl der Personen absteigend, dann Name. */
export function collectPlaces(g: FamilyGraph, ids?: Iterable<PersonId>, known?: KnownPlaces): PlaceStat[] {
  const byKey = new Map<string, PlaceStat & { people: Set<PersonId> }>();
  for (const id of ids ?? [...g.persons()].map((p) => p.id)) {
    for (const e of eventsOf(g, id)) {
      const key = placeKey(e.name);
      let stat = byKey.get(key);
      if (!stat) {
        stat = { key, name: e.name, events: [], persons: 0, people: new Set() };
        byKey.set(key, stat);
      }
      const ev: PlaceEvent = { personId: e.personId, kind: e.kind };
      if (e.year !== undefined) ev.year = e.year;
      stat.events.push(ev);
      stat.people.add(e.personId);
      if (e.coords && stat.coordsFrom !== "data") {
        stat.coords = e.coords;
        stat.coordsFrom = "data";
      }
    }
  }
  const result: PlaceStat[] = [];
  for (const { people, ...stat } of byKey.values()) {
    const s: PlaceStat = { ...stat, persons: people.size };
    if (!s.coords) {
      const k = known?.get(s.key);
      if (k) {
        s.coords = k;
        s.coordsFrom = "lookup";
      }
    }
    result.push(s);
  }
  return result.sort((a, b) => b.persons - a.persons || a.name.localeCompare(b.name, "de"));
}

/** Lebenswege der genannten Personen; Personen ohne Ortsangabe fehlen. Sortiert nach Geburtsjahr, dann Name. */
export function lifePaths(g: FamilyGraph, ids: Iterable<PersonId>, known?: KnownPlaces): LifePath[] {
  const coordsFor = (key: string, own: Coordinates | undefined) => own ?? known?.get(key);
  const paths: LifePath[] = [];
  for (const id of ids) {
    const p = g.getPerson(id);
    const stops: PathStop[] = [];
    for (const e of eventsOf(g, id)) {
      const key = placeKey(e.name);
      const prev = stops[stops.length - 1];
      if (prev && prev.key === key) continue; // gleicher Ort wie davor
      const stop: PathStop = { key, name: e.name, kind: e.kind };
      if (e.year !== undefined) stop.year = e.year;
      const c = coordsFor(key, e.coords);
      if (c) stop.coords = c;
      stops.push(stop);
    }
    if (!stops.length || !p) continue;
    const path: LifePath = { personId: id, name: nameOf(p), surname: p.surname, stops };
    const b = yearOf(p.birth);
    const d = yearOf(p.death);
    if (b !== undefined) path.birthYear = b;
    if (d !== undefined) path.deathYear = d;
    paths.push(path);
  }
  return paths.sort(
    (a, b) => (a.birthYear ?? Infinity) - (b.birthYear ?? Infinity) || a.name.localeCompare(b.name, "de"),
  );
}
