/**
 * FamilySearch (optional, nur Gerüst, D25).
 *
 * Die API braucht einen Entwicklerschlüssel und eine OAuth-Anmeldung; beides liegt bei FamilySearch
 * und ist hier nicht verfügbar. Der Anbieter nimmt deshalb ein **Zugriffstoken** entgegen, das der
 * Nutzer selbst besorgt hat (wird nur im Arbeitsspeicher gehalten, nie gespeichert). Die Suche ist
 * nach der öffentlichen GEDCOM-X-Beschreibung gebaut und nur gegen nachgebaute Antworten getestet,
 * **nicht gegen den echten Dienst**. `fetchRelatives` ist noch nicht umgesetzt.
 * Nutzungsbedingungen von FamilySearch beachten (nur eigene Zwecke, keine Massenabfragen).
 */
import type { FuzzyDate, Sex } from "../core/types";
import { requestJson, withParams } from "./http";
import { ProviderError } from "./types";
import type { ExternalEvent, ExternalPerson, Provider } from "./types";

export const FAMILYSEARCH_BASE = "https://api.familysearch.org";
const SYSTEM = "familysearch";
const GX = "http://gedcomx.org/";

interface GxFact {
  type?: string;
  date?: { original?: string; formal?: string };
  place?: { original?: string };
}
interface GxPerson {
  id?: string;
  gender?: { type?: string };
  names?: { nameForms?: { parts?: { type?: string; value?: string }[] }[] }[];
  facts?: GxFact[];
}

/** GEDCOM-X-Datum `+1850-05-03` oder `+1850` → `FuzzyDate`; `A+1850` (ungefähr) wird „about“. */
export function gedcomxDate(formal: string | undefined): FuzzyDate | undefined {
  const m = formal && /^(A?)\+?(\d{4})(?:-(\d\d))?(?:-(\d\d))?/.exec(formal);
  if (!m) return undefined;
  const year = Number(m[2]);
  if (!year) return undefined;
  const d: FuzzyDate = { kind: m[1] ? "about" : "exact", year };
  if (m[3]) d.month = Number(m[3]);
  if (m[3] && m[4]) d.day = Number(m[4]);
  return d;
}

function fact(p: GxPerson, type: string): ExternalEvent | undefined {
  const f = p.facts?.find((x) => x.type === GX + type);
  if (!f) return undefined;
  const date = gedcomxDate(f.date?.formal);
  const place = f.place?.original?.trim() || undefined;
  return date || place ? { date, place } : undefined;
}

export function toExternalPerson(p: GxPerson): ExternalPerson | null {
  if (!p.id) return null;
  const parts = p.names?.[0]?.nameForms?.[0]?.parts ?? [];
  const part = (t: string) => parts.find((x) => x.type === GX + t)?.value?.trim() || undefined;
  const sex: Sex = p.gender?.type === GX + "Male" ? "M" : p.gender?.type === GX + "Female" ? "F" : "U";
  return {
    ref: { system: SYSTEM, id: p.id },
    url: `https://www.familysearch.org/tree/person/details/${encodeURIComponent(p.id)}`,
    givenNames: part("Given"),
    surname: part("Surname"),
    sex,
    birth: fact(p, "Birth"),
    death: fact(p, "Death"),
  };
}

export interface FamilySearchOptions {
  /** Zugriffstoken (OAuth), vom Nutzer eingegeben */
  accessToken?: string;
  baseUrl?: string;
}

export function createFamilySearchProvider(opts: FamilySearchOptions = {}): Provider {
  const base = opts.baseUrl ?? FAMILYSEARCH_BASE;
  return {
    id: SYSTEM,
    label: "FamilySearch (Gerüst, ungeprüft)",
    needsKey: true,
    disclosure: "Gesendet werden Name und Jahre sowie Ihr Zugriffstoken an api.familysearch.org.",
    async search(query, ctx) {
      if (!opts.accessToken) throw new ProviderError("config", "FamilySearch braucht ein Zugriffstoken.");
      if (!query.surname?.trim() && !query.givenNames?.trim()) return [];
      const json = (await requestJson(
        withParams(`${base}/platform/tree/search`, {
          "q.givenName": query.givenNames?.trim(),
          "q.surname": query.surname?.trim(),
          "q.birthLikeDate": query.birthYear,
          "q.deathLikeDate": query.deathYear,
          count: 20,
        }),
        ctx,
        { headers: { Accept: "application/x-gedcomx-atom+json", Authorization: `Bearer ${opts.accessToken}` } },
        "FamilySearch",
      )) as { entries?: { content?: { gedcomx?: { persons?: GxPerson[] } } }[] };
      if (!json || typeof json !== "object") throw new ProviderError("format", "FamilySearch-Antwort nicht lesbar.");
      const out: ExternalPerson[] = [];
      for (const e of json.entries ?? []) {
        const p = e.content?.gedcomx?.persons?.[0];
        const x = p && toExternalPerson(p);
        if (x) out.push(x);
      }
      return out;
    },
    async fetchRelatives() {
      throw new ProviderError("unsupported", "Verwandte von FamilySearch abzurufen ist noch nicht umgesetzt.");
    },
  };
}
