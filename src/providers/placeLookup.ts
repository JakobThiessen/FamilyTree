/**
 * Koordinaten für Ortsnamen aus Wikidata (D31). Wird nur ausgelöst, wenn der Nutzer es verlangt;
 * gesendet werden ausschließlich Ortsnamen (keine Personen, keine Daten). Das Ergebnis ist eine
 * Vermutung: der erste Wikidata-Treffer zum Namen, der Koordinaten (P625) hat.
 * Zwei Abfragen je Ort: `wbsearchentities` (Name → Kandidaten), `wbgetentities` (Kandidaten → P625).
 */
import { requestJson, withParams } from "./http";
import type { ProviderContext } from "./types";

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

export interface PlaceMatch {
  /** Wikidata-Nummer, z. B. `Q64` */
  qid: string;
  label: string;
  description?: string;
  lat: number;
  lon: number;
}

const COMMON = { format: "json", origin: "*" } as const;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** Sucht Koordinaten zu einem Ortsnamen. `null`, wenn Wikidata nichts Passendes mit Koordinaten kennt. */
export async function lookupPlace(
  name: string,
  ctx?: ProviderContext,
  language = "de",
): Promise<PlaceMatch | null> {
  // „Musterdorf, Bayern“: gesucht wird nur der Teil vor dem ersten Komma
  const term = name.split(",")[0]?.trim();
  if (!term) return null;
  const search = await requestJson(
    withParams(WIKIDATA_API, { ...COMMON, action: "wbsearchentities", search: term, language, uselang: language, type: "item", limit: 5 }),
    ctx,
    {},
    "Wikidata",
  );
  const hits = isRecord(search) && Array.isArray(search["search"]) ? search["search"] : [];
  const candidates = hits
    .filter(isRecord)
    .filter((h) => typeof h["id"] === "string" && /^Q\d+$/.test(h["id"]))
    .map((h) => ({
      id: h["id"] as string,
      label: typeof h["label"] === "string" ? h["label"] : term,
      description: typeof h["description"] === "string" ? h["description"] : undefined,
    }));
  if (!candidates.length) return null;

  const ents = await requestJson(
    withParams(WIKIDATA_API, { ...COMMON, action: "wbgetentities", ids: candidates.map((c) => c.id).join("|"), props: "claims" }),
    ctx,
    {},
    "Wikidata",
  );
  const entities = isRecord(ents) && isRecord(ents["entities"]) ? ents["entities"] : {};
  for (const c of candidates) {
    // in der Reihenfolge der Suche; der erste mit Koordinaten gewinnt
    const e = entities[c.id];
    const claims = isRecord(e) && isRecord(e["claims"]) ? e["claims"] : {};
    const p625 = Array.isArray(claims["P625"]) ? claims["P625"][0] : undefined;
    const value =
      isRecord(p625) && isRecord(p625["mainsnak"]) && isRecord(p625["mainsnak"]["datavalue"])
        ? p625["mainsnak"]["datavalue"]["value"]
        : undefined;
    if (isRecord(value) && typeof value["latitude"] === "number" && typeof value["longitude"] === "number") {
      const match: PlaceMatch = { qid: c.id, label: c.label, lat: value["latitude"], lon: value["longitude"] };
      if (c.description) match.description = c.description;
      return match;
    }
  }
  return null;
}

/** Mehrere Orte nacheinander (höflich: nicht parallel). `onProgress` nach jedem Ort; Fehler brechen ab. */
export async function lookupPlaces(
  names: string[],
  ctx?: ProviderContext,
  onProgress?: (name: string, match: PlaceMatch | null) => void,
): Promise<Map<string, PlaceMatch | null>> {
  const result = new Map<string, PlaceMatch | null>();
  for (const name of names) {
    if (ctx?.signal?.aborted) break;
    const m = await lookupPlace(name, ctx);
    result.set(name, m);
    onProgress?.(name, m);
  }
  return result;
}
