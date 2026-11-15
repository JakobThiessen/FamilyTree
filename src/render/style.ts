/**
 * Farben und Beschriftungen der Karten (reines TypeScript, ohne DOM).
 * Dunkles Design; die Farbe einer Karte kommt von der Familienlinie (Nachname).
 */
import type { Person } from "../core/types";

/** Feste Farbpalette, gut unterscheidbar auf dunklem Grund. */
export const LINE_COLORS = [
  "#5fb0ff", "#ff8a65", "#7bd88f", "#d6a3ff", "#ffd166", "#4dd0c8", "#ff7aa8", "#b5c76a",
];

export const COLORS = {
  background: "#0b0e1a",
  backgroundTop: "#111833",
  backgroundBottom: "#080b14",
  card: "#161b2e",
  cardGhost: "#10142344",
  text: "#e6e8f0",
  textDim: "#9aa3bf",
  edgeNeutral: "#6c7596",
  /** hervorgehobene Linien: zu den Eltern / zu den Kindern der Fokus- bzw. überfahrenen Karte */
  edgeUp: "#ffd166",
  edgeDown: "#4dd0c8",
  focus: "#ffffff",
  focusGlow: "#4dd0c8",
  badge: "#2a3354",
  badgeText: "#e6e8f0",
};

/** Einfacher, stabiler Hash (FNV-1a) eines Textes. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Farbe der Familienlinie: gleicher Nachname = gleiche Farbe. Ohne Nachnamen ein neutrales Grau. */
export function lineColor(surname: string | undefined): string {
  const s = surname?.trim().toLowerCase();
  if (!s) return "#7d86a3";
  return LINE_COLORS[hash(s) % LINE_COLORS.length] as string;
}

/** Text für Personen ganz ohne Namen; die Oberfläche setzt ihn je nach Sprache (D34). */
let unknownName = "Unbekannt";
export function setUnknownName(label: string): void {
  unknownName = label;
}

export function displayName(p: Person | undefined): string {
  if (!p) return "?";
  const name = [p.givenNames, p.surname].filter(Boolean).join(" ").trim();
  return name || unknownName;
}

/** Person ohne jeden Namen oder ausdrücklich als „unbekannt“ markiert (Filter „Unbekannte Personen“). */
export function isUnknownPerson(p: Person | undefined): boolean {
  if (!p) return true;
  return p.status === "unknown" || (!p.givenNames?.trim() && !p.surname?.trim());
}

/** Anfangsbuchstaben für den Avatar: Vorname + Nachname, sonst „?“. */
export function initials(p: Person | undefined): string {
  const first = p?.givenNames?.trim().charAt(0) ?? "";
  const last = p?.surname?.trim().charAt(0) ?? "";
  return ((first + last) || "?").toUpperCase();
}

/** Kurze Lebensspanne, z. B. „* 1800 – † 1875“, „um 1750 –“ oder leer. Nur Jahre. */
export function lifeSpan(p: Person | undefined): string {
  if (!p) return "";
  const year = (d: { kind: string; year?: number } | undefined): string => {
    if (!d || d.year === undefined) return "";
    const prefix = d.kind === "about" ? "~" : d.kind === "before" ? "<" : d.kind === "after" ? ">" : "";
    return prefix + d.year;
  };
  const b = year(p.birth?.date);
  const d = year(p.death?.date);
  if (!b && !d) return "";
  if (b && !d) return `* ${b}`;
  if (!b && d) return `† ${d}`;
  return `* ${b} – † ${d}`;
}
