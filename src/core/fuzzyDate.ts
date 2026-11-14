/**
 * Unscharfe Daten: Parsen, Formatieren (Deutsch) und Vergleichen.
 * Reines TypeScript, keine Abhängigkeiten.
 *
 * Unterstützte Eingaben (Groß-/Kleinschreibung egal):
 *   "1800", "1800-03", "1800-03-12", "12.03.1800", "03.1800", "12. März 1800", "März 1800"
 *   "um 1750" / "ca. 1750" / "circa 1750"   -> about
 *   "vor 1850" / "bis 1850"                  -> before
 *   "nach 1700" / "ab 1700"                  -> after
 *   "zwischen 1700 und 1710" / "1700-1710"   -> between
 */

import type { FuzzyDate } from "./types";

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Schreibweisen -> Monatsnummer (1–12). */
const MONTH_LOOKUP: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2,
  märz: 3, maerz: 3, mär: 3, mrz: 3,
  april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

interface DateParts {
  year: number;
  month?: number;
  day?: number;
}

/** Parst einen einfachen (nicht unscharfen) Datumsteil. */
function parseParts(raw: string): DateParts | null {
  const s = raw.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  let parts: DateParts | null = null;

  if ((m = s.match(/^(\d{1,4})$/))) {
    parts = { year: Number(m[1]) };
  } else if ((m = s.match(/^(\d{1,4})-(\d{1,2})$/))) {
    parts = { year: Number(m[1]), month: Number(m[2]) };
  } else if ((m = s.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/))) {
    parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  } else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/))) {
    parts = { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) };
  } else if ((m = s.match(/^(\d{1,2})\.(\d{1,4})$/))) {
    parts = { year: Number(m[2]), month: Number(m[1]) };
  } else if ((m = s.match(/^(\d{1,2})\.?\s+([a-zäöü]+)\.?\s+(\d{1,4})$/))) {
    const month = MONTH_LOOKUP[m[2] ?? ""];
    if (month) parts = { year: Number(m[3]), month, day: Number(m[1]) };
  } else if ((m = s.match(/^([a-zäöü]+)\.?\s+(\d{1,4})$/))) {
    const month = MONTH_LOOKUP[m[1] ?? ""];
    if (month) parts = { year: Number(m[2]), month };
  }

  if (!parts || parts.year < 1) return null;
  if (parts.month !== undefined && (parts.month < 1 || parts.month > 12)) return null;
  if (parts.day !== undefined) {
    if (parts.month === undefined) return null;
    if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) return null;
  }
  return parts;
}

/** Baut ein FuzzyDate und lässt nicht gesetzte Felder weg (wichtig für exactOptionalPropertyTypes und JSON). */
function make(kind: FuzzyDate["kind"], p: DateParts, text: string, yearTo?: number): FuzzyDate {
  const d: FuzzyDate = { kind, year: p.year, text };
  if (p.month !== undefined) d.month = p.month;
  if (p.day !== undefined) d.day = p.day;
  if (yearTo !== undefined) d.yearTo = yearTo;
  return d;
}

/**
 * Parst deutschen Datumstext. Gibt `null` zurück, wenn der Text nicht verstanden wird.
 * Der Originaltext wird in `text` aufbewahrt.
 */
export function parseFuzzyDate(input: string): FuzzyDate | null {
  const text = input.trim();
  const s = text.toLowerCase();
  if (!s) return null;
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^zwischen\s+(.+?)\s+und\s+(.+)$/))) {
    const from = parseParts(m[1] ?? "");
    const to = parseParts(m[2] ?? "");
    if (!from || !to || to.year < from.year) return null;
    return make("between", from, text, to.year);
  }
  // Kurzform "1700-1710" (nur Jahre; "1700-03" bleibt ein Monatsdatum)
  if ((m = s.match(/^(\d{3,4})\s*[-–]\s*(\d{3,4})$/))) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (to < from) return null;
    return make("between", { year: from }, text, to);
  }
  if ((m = s.match(/^(?:um|ca\.?|circa|etwa|ungefähr|~)\s*(.+)$/))) {
    const p = parseParts(m[1] ?? "");
    return p ? make("about", p, text) : null;
  }
  if ((m = s.match(/^(?:vor|bis)\s+(.+)$/))) {
    const p = parseParts(m[1] ?? "");
    return p ? make("before", p, text) : null;
  }
  if ((m = s.match(/^(?:nach|ab)\s+(.+)$/))) {
    const p = parseParts(m[1] ?? "");
    return p ? make("after", p, text) : null;
  }
  const p = parseParts(s);
  return p ? make("exact", p, text) : null;
}

/** Anzeigesprache der Formatierer im Kern (D34). Texte der Oberfläche liegen in `src/ui/locales`. */
export type DisplayLang = "de" | "en";

const MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatParts(year: number, month?: number, day?: number, lang: DisplayLang = "de"): string {
  const monthName = month !== undefined ? (lang === "en" ? MONTH_NAMES_EN : MONTH_NAMES)[month - 1] : undefined;
  if (lang === "en") {
    if (monthName && day !== undefined) return `${day} ${monthName} ${year}`;
    if (monthName) return `${monthName} ${year}`;
    return String(year);
  }
  if (monthName && day !== undefined) return `${day}. ${monthName} ${year}`;
  if (monthName) return `${monthName} ${year}`;
  return String(year);
}

/**
 * Formatiert für die Anzeige auf Deutsch, immer aus den Feldern (nicht aus `text`),
 * damit die Anzeige einheitlich ist. Fehlt das Jahr, kommt `text` oder "unbekannt".
 */
export function formatFuzzyDate(d: FuzzyDate | undefined, lang: DisplayLang = "de"): string {
  const en = lang === "en";
  const unknown = en ? "unknown" : "unbekannt";
  if (!d) return unknown;
  if (d.year === undefined) return d.text ?? unknown;
  const base = formatParts(d.year, d.month, d.day, lang);
  switch (d.kind) {
    case "exact":
      return base;
    case "about":
      return `${en ? "about" : "um"} ${base}`;
    case "before":
      return `${en ? "before" : "vor"} ${base}`;
    case "after":
      return `${en ? "after" : "nach"} ${base}`;
    case "between":
      if (d.yearTo === undefined) return `${en ? "about" : "um"} ${base}`;
      return en ? `between ${base} and ${d.yearTo}` : `zwischen ${base} und ${d.yearTo}`;
  }
}

/** Mögliche Jahresspanne. Offene Enden sind ±Infinity (z. B. "vor 1850" = bis 1850). */
export function yearRange(d: FuzzyDate): { from: number; to: number } | null {
  if (d.year === undefined) return null;
  switch (d.kind) {
    case "exact":
    case "about":
      return { from: d.year, to: d.year };
    case "before":
      return { from: -Infinity, to: d.year };
    case "after":
      return { from: d.year, to: Infinity };
    case "between":
      return { from: d.year, to: d.yearTo ?? d.year };
  }
}

/**
 * Sortierwert (Jahr mit Monats-/Tagesanteil), zum Ordnen von Ereignissen.
 * Bei "vor"/"nach" gilt das genannte Jahr als Näherung. `null` ohne Jahr.
 */
export function dateSortKey(d: FuzzyDate | undefined): number | null {
  if (!d || d.year === undefined) return null;
  return d.year + ((d.month ?? 1) - 1) / 12 + ((d.day ?? 1) - 1) / 372;
}

/** Vergleich für Array.sort; Daten ohne Jahr kommen ans Ende. */
export function compareFuzzyDate(a: FuzzyDate | undefined, b: FuzzyDate | undefined): number {
  const ka = dateSortKey(a);
  const kb = dateSortKey(b);
  if (ka === null && kb === null) return 0;
  if (ka === null) return 1;
  if (kb === null) return -1;
  return ka - kb;
}
