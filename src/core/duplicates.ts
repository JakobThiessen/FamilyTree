/**
 * Dublettenvorschläge (reines TypeScript, D26).
 *
 * Sucht zu einer (externen) Person ähnliche Personen im Baum. Das Ergebnis ist ein **Vorschlag**:
 * Nichts wird automatisch zusammengeführt, der Nutzer entscheidet.
 *
 * Bewertung (0 bis 1):
 *  - Nachname gleich 0,3 / ein Tippfehler Abstand 0,2
 *  - Vorname: erster Vorname gleich 0,3, ein anderer Vorname gleich 0,2, nur Anfangsbuchstabe 0,1
 *  - Geburtsjahr gleich 0,3 / ±2 Jahre 0,2 / ±5 Jahre 0,1; Sterbejahr gleich 0,1 / ±2 Jahre 0,05
 *  - Abweichungen, die nicht zusammenpassen (Geburtsjahre > 5 Jahre auseinander, Geschlecht verschieden,
 *    Sterbejahre > 5 Jahre auseinander), schließen den Treffer aus.
 * Der Index normalisiert jeden Namen einmal und gruppiert nach Nachnamen, damit ein Baum mit
 * 50.000 Personen pro Anfrage nicht ganz durchsucht wird.
 */
import { normalizeText } from "./search";
import type { Person, PersonId, Sex } from "./types";

export interface DuplicateQuery {
  givenNames?: string;
  surname?: string;
  sex?: Sex;
  birthYear?: number;
  deathYear?: number;
}

export type DuplicateLevel = "high" | "medium" | "low";

export interface DuplicateCandidate {
  personId: PersonId;
  /** 0 bis 1, größer = ähnlicher */
  score: number;
  level: DuplicateLevel;
  /** Kurze Gründe für die Anzeige, z. B. „Nachname gleich“ */
  reasons: string[];
  /** gleiche Gründe als Code (+ Zahl) für die Übersetzung (UI: `dup.<code>`) */
  reasonCodes: { code: string; n?: number }[];
}

export interface DuplicateOptions {
  /** Mindestwert für einen Vorschlag (Standard 0,5) */
  minScore?: number;
  /** Höchstzahl der Vorschläge (Standard 5) */
  limit?: number;
}

interface Entry {
  id: PersonId;
  given: string[];
  sex: Sex;
  birthYear?: number;
  deathYear?: number;
}

const tokens = (s: string | undefined): string[] =>
  normalizeText(s ?? "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Nachnamen als ein Schlüssel (mehrteilige Namen wie „von Muster“ bleiben zusammen). */
const surnameKey = (s: string | undefined): string => tokens(s).join(" ");

/** Editierabstand höchstens 1? (Einfügen, Löschen, Ersetzen; ohne Matrix) */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

export class DuplicateFinder {
  private readonly bySurname = new Map<string, Entry[]>();

  constructor(persons: Iterable<Person>) {
    for (const p of persons) {
      const key = surnameKey(p.surname);
      if (!key) continue; // ohne Nachnamen kein verlässlicher Vorschlag
      const entry: Entry = {
        id: p.id,
        given: tokens(p.givenNames),
        sex: p.sex,
        birthYear: p.birth?.date?.year,
        deathYear: p.death?.date?.year,
      };
      const list = this.bySurname.get(key);
      if (list) list.push(entry);
      else this.bySurname.set(key, [entry]);
    }
  }

  find(q: DuplicateQuery, opts: DuplicateOptions = {}): DuplicateCandidate[] {
    const minScore = opts.minScore ?? 0.5;
    const limit = opts.limit ?? 5;
    const key = surnameKey(q.surname);
    if (!key) return [];
    const given = tokens(q.givenNames);
    const out: DuplicateCandidate[] = [];

    for (const [other, entries] of this.bySurname) {
      const surnameScore = other === key ? 0.3 : withinOneEdit(other, key) && key.length >= 5 ? 0.2 : 0;
      if (!surnameScore) continue;
      for (const e of entries) {
        const hit = score(q, given, e, surnameScore);
        if (hit && hit.score >= minScore) out.push({ personId: e.id, ...hit, level: levelOf(hit.score) });
      }
    }
    out.sort((a, b) => b.score - a.score || (a.personId < b.personId ? -1 : 1));
    return out.slice(0, limit);
  }
}

function levelOf(score: number): DuplicateLevel {
  return score >= 0.85 ? "high" : score >= 0.65 ? "medium" : "low";
}

function score(
  q: DuplicateQuery,
  given: string[],
  e: Entry,
  surnameScore: number,
): { score: number; reasons: string[]; reasonCodes: { code: string; n?: number }[] } | null {
  const reasons: string[] = [];
  const reasonCodes: { code: string; n?: number }[] = [];
  const why = (code: string, text: string, n?: number) => {
    reasons.push(text);
    reasonCodes.push(n === undefined ? { code } : { code, n });
  };
  if (surnameScore === 0.3) why("surname-same", "Nachname gleich");
  else why("surname-similar", "Nachname ähnlich");
  let s = surnameScore;

  // Ausschluss: Geschlecht bekannt und verschieden
  if (q.sex && q.sex !== "U" && e.sex !== "U" && q.sex !== e.sex) return null;

  if (given.length && e.given.length) {
    if (given[0] === e.given[0]) {
      s += 0.3;
      why("given-same", "Vorname gleich");
    } else if (given.some((g) => e.given.includes(g)) || e.given.some((g) => given.includes(g))) {
      s += 0.2;
      why("given-other", "weiterer Vorname gleich");
    } else if (given[0]![0] === e.given[0]![0] && (given[0]!.length === 1 || e.given[0]!.length === 1)) {
      s += 0.1;
      why("given-initial", "Initiale gleich");
    } else {
      return null; // andere Vornamen: andere Person
    }
  }

  if (q.birthYear !== undefined && e.birthYear !== undefined) {
    const d = Math.abs(q.birthYear - e.birthYear);
    if (d > 5) return null;
    s += d === 0 ? 0.3 : d <= 2 ? 0.2 : 0.1;
    if (d === 0) why("birth-same", "Geburtsjahr gleich");
    else why("birth-diff", `Geburtsjahr ±${d}`, d);
  }
  if (q.deathYear !== undefined && e.deathYear !== undefined) {
    const d = Math.abs(q.deathYear - e.deathYear);
    if (d > 5) return null;
    s += d <= 2 ? (d === 0 ? 0.1 : 0.05) : 0;
    if (d === 0) why("death-same", "Sterbejahr gleich");
    else why("death-diff", `Sterbejahr ±${d}`, d);
  }
  return { score: Math.min(1, Math.round(s * 100) / 100), reasons, reasonCodes };
}

/** Bequem für Einzelfälle; für viele Anfragen einmal `new DuplicateFinder(persons)` bauen. */
export function findDuplicates(
  persons: Iterable<Person>,
  q: DuplicateQuery,
  opts?: DuplicateOptions,
): DuplicateCandidate[] {
  return new DuplicateFinder(persons).find(q, opts);
}
