/**
 * Meldungen des Kerns in der gewählten Sprache anzeigen (D37). Reines TypeScript, in Node testbar.
 * Der Kern liefert neben dem deutschen Text einen Code mit Parametern (`code`, `params`);
 * die Wörterbücher in `locales/` enthalten dazu die Schlüssel `warn.*`, `issue.*`, `error.*`,
 * `provider.error.*`, `dup.*`. Kennt das Wörterbuch einen Code nicht, bleibt der deutsche Text stehen.
 */
import { de } from "./locales/de";
import { translate } from "./i18n";
import type { Lang, MessageKey, Vars } from "./i18n";
import { errorCode } from "../workers/workerError";
import { ProviderError } from "../providers/types";

const has = (key: string): key is MessageKey => key in de;

function byCode(lang: Lang, prefix: string, code: string | undefined, params: Vars | undefined, fallback: string): string {
  const key = `${prefix}.${code ?? ""}`;
  return code && has(key) ? translate(lang, key, params) : fallback;
}

/** Hinweis des GEDCOM-Imports. */
export function warningText(w: { message: string; code?: string; params?: Vars }, lang: Lang): string {
  return byCode(lang, "warn", w.code, w.params, w.message);
}

/** Prüfmeldung aus `FamilyGraph.validate()`. */
export function issueText(i: { code: string; message: string; params?: Vars }, lang: Lang): string {
  return byCode(lang, "issue", i.code, i.params, i.message);
}

/** Grund eines Dublettenvorschlags („Nachname gleich“ …). */
export function reasonText(r: { code: string; n?: number }, lang: Lang, fallback: string): string {
  return byCode(lang, "dup", r.code, r.n === undefined ? undefined : { n: r.n }, fallback);
}

/** Hinweis, was an die Online-Quelle gesendet wird; Anbieter-Kennung wie `wikidata`. */
export function disclosureText(providerId: string, lang: Lang, fallback: string): string {
  const key = `online.disclosure.${providerId}`;
  return has(key) ? translate(lang, key) : fallback;
}

/** Fehlertext für Anzeige: Anbieter-, Format-, Worker- und Speicherfehler übersetzt, sonst die Meldung selbst. */
export function errorText(e: unknown, lang: Lang): string {
  if (!(e instanceof Error)) return String(e);
  if (e instanceof ProviderError && e.detail) {
    const key = `provider.error.${e.detail.code}`;
    if (has(key)) {
      // Statuscode 429 und andere: Dienstname und Status stehen in params
      return translate(lang, key, e.detail.params);
    }
  }
  const { code, params } = errorCode(e);
  return byCode(lang, "error", code, params, e.message);
}
