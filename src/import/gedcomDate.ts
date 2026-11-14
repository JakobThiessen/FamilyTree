/**
 * GEDCOM-Datumsformat <-> `FuzzyDate`.
 *   ABT / CAL / EST  -> about      BEF -> before      AFT -> after
 *   BET x AND y      -> between    FROM x TO y -> between    FROM x -> after    TO x -> before
 *   INT x (phrase)   -> exact (Datum aus x)
 * Nicht lesbare Daten (Freitext, Hebräisch ...) liefern `null`.
 */

import { daysInMonth } from "../core/fuzzyDate";
import type { FuzzyDate } from "../core/types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

interface Parts {
  year: number;
  month?: number;
  day?: number;
}

function parseParts(raw: string): Parts | null {
  // Kalenderangabe "@#DJULIAN@" wird ignoriert; nur der Zahlenwert zählt.
  const s = raw.replace(/^@#D(?:GREGORIAN|JULIAN)@\s*/i, "").trim().toUpperCase();
  let m: RegExpMatchArray | null;
  let p: Parts | null = null;
  if ((m = s.match(/^(\d{1,4})(?:\/\d{1,4})?$/))) p = { year: Number(m[1]) };
  else if ((m = s.match(/^([A-Z]{3}) (\d{1,4})(?:\/\d{1,4})?$/))) {
    const month = MONTHS.indexOf(m[1]!) + 1;
    if (month > 0) p = { year: Number(m[2]), month };
  } else if ((m = s.match(/^(\d{1,2}) ([A-Z]{3}) (\d{1,4})(?:\/\d{1,4})?$/))) {
    const month = MONTHS.indexOf(m[2]!) + 1;
    if (month > 0) p = { year: Number(m[3]), month, day: Number(m[1]) };
  }
  if (!p || p.year < 1) return null;
  if (p.day !== undefined && (p.day < 1 || p.day > daysInMonth(p.year, p.month!))) return null;
  return p;
}

function make(kind: FuzzyDate["kind"], p: Parts, text: string, yearTo?: number): FuzzyDate {
  const d: FuzzyDate = { kind, year: p.year, text };
  if (p.month !== undefined) d.month = p.month;
  if (p.day !== undefined) d.day = p.day;
  if (yearTo !== undefined) d.yearTo = yearTo;
  return d;
}

/** Parst einen GEDCOM-Datumswert; `null` bei nicht lesbarem Text. Der Originaltext bleibt in `text`. */
export function parseGedcomDate(input: string): FuzzyDate | null {
  const text = input.trim();
  const s = text.toUpperCase();
  let m: RegExpMatchArray | null;

  const range = (a: string, b: string): FuzzyDate | null => {
    const from = parseParts(a);
    const to = parseParts(b);
    if (!from || !to || to.year < from.year) return null;
    return make("between", from, text, to.year);
  };
  const single = (kind: FuzzyDate["kind"], raw: string): FuzzyDate | null => {
    const p = parseParts(raw);
    return p ? make(kind, p, text) : null;
  };

  if ((m = s.match(/^BET\s+(.+?)\s+AND\s+(.+)$/))) return range(m[1]!, m[2]!);
  if ((m = s.match(/^FROM\s+(.+?)\s+TO\s+(.+)$/))) return range(m[1]!, m[2]!);
  if ((m = s.match(/^FROM\s+(.+)$/))) return single("after", m[1]!);
  if ((m = s.match(/^TO\s+(.+)$/))) return single("before", m[1]!);
  if ((m = s.match(/^(?:ABT|CAL|EST)\s+(.+)$/))) return single("about", m[1]!);
  if ((m = s.match(/^BEF\s+(.+)$/))) return single("before", m[1]!);
  if ((m = s.match(/^AFT\s+(.+)$/))) return single("after", m[1]!);
  if ((m = s.match(/^INT\s+(.+?)\s*(?:\(.*\))?$/))) return single("exact", m[1]!);
  return single("exact", s);
}

function formatParts(year: number, month?: number, day?: number): string {
  const mon = month !== undefined ? MONTHS[month - 1] : undefined;
  if (mon && day !== undefined) return `${day} ${mon} ${year}`;
  if (mon) return `${mon} ${year}`;
  return String(year);
}

function sameFields(a: FuzzyDate, b: FuzzyDate): boolean {
  return a.kind === b.kind && a.year === b.year && a.month === b.month && a.day === b.day && a.yearTo === b.yearTo;
}

/**
 * `FuzzyDate` -> GEDCOM-Datumswert. Ist der Originaltext ein gültiger GEDCOM-Wert mit gleichen Feldern,
 * wird er unverändert übernommen (bewahrt z. B. "CAL" oder volle Bereichsgrenzen). Datumsangaben ohne Jahr
 * werden als Freitext in Klammern geschrieben.
 */
export function formatGedcomDate(d: FuzzyDate): string {
  if (d.text) {
    const reparsed = parseGedcomDate(d.text);
    if (reparsed && sameFields(reparsed, d)) return d.text.trim();
  }
  if (d.year === undefined) {
    const t = (d.text ?? "").trim();
    return t.startsWith("(") ? t : `(${t})`;
  }
  const base = formatParts(d.year, d.month, d.day);
  switch (d.kind) {
    case "exact":
      return base;
    case "about":
      return `ABT ${base}`;
    case "before":
      return `BEF ${base}`;
    case "after":
      return `AFT ${base}`;
    case "between":
      return d.yearTo !== undefined ? `BET ${base} AND ${d.yearTo}` : `ABT ${base}`;
  }
}
