/**
 * Übersetzung (M9, D34): reines TypeScript ohne Svelte, in Node testbar.
 * Die Wörterbücher liegen in `locales/de.ts` (Quelle der Schlüssel) und `locales/en.ts` (muss dieselben
 * Schlüssel haben, sonst meldet der Typcheck einen Fehler). Platzhalter stehen in {geschweiften Klammern}.
 * Mehrzahl: zwei Schlüssel `name.one` und `name.other`, gewählt über `translateN`.
 */
import { de } from "./locales/de";
import type { MessageKey } from "./locales/de";
import { en } from "./locales/en";
import type { DisplayLang } from "../core/fuzzyDate";

export type Lang = DisplayLang;
export const LANGS: readonly Lang[] = ["de", "en"];
export type { MessageKey };

const DICTS: Record<Lang, Record<MessageKey, string>> = { de, en };

export type Vars = Record<string, string | number>;

/** Ersetzt {name} durch Werte; fehlende Platzhalter bleiben sichtbar stehen (leichter zu finden). */
function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  return fill(DICTS[lang][key] ?? DICTS.de[key] ?? key, vars);
}

/** Wählt `<key>.one` bei n = 1, sonst `<key>.other`; `{n}` ist automatisch belegt. */
export function translateN(lang: Lang, base: string, n: number, vars?: Vars): string {
  return translate(lang, `${base}.${n === 1 ? "one" : "other"}` as MessageKey, { n, ...vars });
}

/** Zahl nach Landesschreibweise (Tausenderpunkt/-komma, Dezimalkomma/-punkt). */
export function formatNumber(lang: Lang, n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(lang === "de" ? "de-DE" : "en-GB", opts);
}

/** Startsprache: gespeicherte Wahl, sonst Browsersprache, sonst Deutsch. */
export function detectLang(saved: string | null | undefined, browser: string | undefined): Lang {
  if (saved === "de" || saved === "en") return saved;
  return browser?.toLowerCase().startsWith("en") ? "en" : "de";
}
