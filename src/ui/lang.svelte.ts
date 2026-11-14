// Reaktive Hülle um i18n.ts: `t(...)` liest `state.lang`, Svelte baut betroffene Stellen bei Wechsel neu.
import { detectLang, formatNumber, translate, translateN } from "./i18n";
import type { Lang, MessageKey, Vars } from "./i18n";
import { setUnknownName } from "../render/style";

const KEY = "familytree.lang.v1";

function initial(): Lang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* Speicher gesperrt: dann Browsersprache */
  }
  return detectLang(saved, typeof navigator === "undefined" ? undefined : navigator.language);
}

const start = initial();
setUnknownName(translate(start, "common.unknownName"));
export const i18n = $state<{ lang: Lang }>({ lang: start });

export function setLang(lang: Lang): void {
  setUnknownName(translate(lang, "common.unknownName")); // vor dem Wechsel, damit abgeleitete Texte ihn schon sehen
  i18n.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignorieren */
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export const t = (key: MessageKey, vars?: Vars): string => translate(i18n.lang, key, vars);
export const tn = (base: string, n: number, vars?: Vars): string => translateN(i18n.lang, base, n, vars);
export const fmt = (n: number, opts?: Intl.NumberFormatOptions): string => formatNumber(i18n.lang, n, opts);
