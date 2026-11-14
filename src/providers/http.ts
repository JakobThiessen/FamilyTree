/**
 * Kleine Abruf-Hilfen für alle Anbieter: ein Ort für Fehlermeldungen.
 * `fetch` kommt aus dem Kontext (Tests geben eine Attrappe mit), sonst aus dem Browser.
 */
import { ProviderError } from "./types";
import type { ProviderContext } from "./types";

export async function requestJson(
  url: string,
  ctx: ProviderContext | undefined,
  init: RequestInit = {},
  serviceName = "Quelle",
): Promise<unknown> {
  const f = ctx?.fetch ?? globalThis.fetch;
  if (!f) throw new ProviderError("network", "Kein fetch verfügbar.");
  let res: Response;
  try {
    res = await f(url, { ...init, signal: ctx?.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    // Der Browser meldet bei CORS, Offline und Blockern denselben Fehler (TypeError); mehr ist nicht erkennbar.
    throw new ProviderError(
      "network",
      `${serviceName} ist nicht erreichbar. Mögliche Gründe: keine Internetverbindung, ein Blocker, oder die Quelle erlaubt keine Abfragen direkt aus dem Browser (CORS).`,
    );
  }
  if (!res.ok) {
    const hint = res.status === 429 ? " (zu viele Anfragen, bitte später erneut versuchen)" : "";
    throw new ProviderError("http", `${serviceName} antwortet mit Fehler ${res.status}${hint}.`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new ProviderError("format", `${serviceName} hat keine lesbare Antwort geliefert.`);
  }
}

/** Baut `base?a=1&b=2` (nur definierte Werte); `base` darf relativ sein (Dev-Proxy). */
export function withParams(base: string, params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  return `${base}${base.includes("?") ? "&" : "?"}${sp}`;
}
