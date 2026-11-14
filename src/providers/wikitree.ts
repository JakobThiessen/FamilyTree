/**
 * WikiTree über die offene API (https://api.wikitree.com/api.php, nur öffentliche Profile).
 *
 * Wichtig (D25): WikiTree sendet keine CORS-Header. Ein Browser darf die API deshalb nicht direkt
 * abrufen. Die Basisadresse ist daher einstellbar: im Dev-Server leitet Vite `/wikitree` weiter
 * (vite.config.ts), sonst kann der Nutzer die Adresse eines eigenen Durchleiters eintragen.
 * Ohne Durchleiter meldet `requestJson` einen klaren Fehler.
 */
import type { ExternalRef, FuzzyDate, Sex } from "../core/types";
import { requestJson, withParams } from "./http";
import { ProviderError } from "./types";
import type { ExternalEvent, ExternalPerson, ExternalUnion, ImportBatch, Provider, ProviderContext } from "./types";

export const WIKITREE_ENDPOINT = "https://api.wikitree.com/api.php";
const SYSTEM = "wikitree";
/** Kennung dieser Anwendung gegenüber WikiTree (die API bittet um eine appId). */
const APP_ID = "FamilyTree-local";

const FIELDS = "Name,Id,FirstName,MiddleName,LastNameAtBirth,Gender,BirthDate,DeathDate,BirthLocation,DeathLocation,Father,Mother,DataStatus,IsLiving";

/** Teil der Antwort (nur genutzte Felder). */
interface WtPerson {
  Name?: string;
  Id?: number;
  FirstName?: string;
  MiddleName?: string;
  LastNameAtBirth?: string;
  Gender?: string;
  BirthDate?: string;
  DeathDate?: string;
  BirthLocation?: string;
  DeathLocation?: string;
  Father?: number;
  Mother?: number;
  DataStatus?: { BirthDate?: string | null; DeathDate?: string | null };
  /** nur bei Ehepartnern */
  marriage_date?: string;
  marriage_location?: string;
  marriage_end_date?: string;
}

/**
 * WikiTree-Datum „1755-00-00“ (0 = unbekannt) → `FuzzyDate`. `status` ist die Sicherheit aus `DataStatus`:
 * „guess“ = ungefähr, „before“/„after“ = vor/nach, sonst genau.
 */
export function wikitreeDate(s: string | undefined, status?: string | null): FuzzyDate | undefined {
  const m = s && /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (!year) return undefined;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const kind: FuzzyDate["kind"] =
    status === "guess" ? "about" : status === "before" ? "before" : status === "after" ? "after" : "exact";
  const d: FuzzyDate = { kind, year };
  if (month) d.month = month;
  if (month && day) d.day = day;
  return d;
}

const sexOf = (g: string | undefined): Sex => (g === "Male" ? "M" : g === "Female" ? "F" : "U");

function event(date: FuzzyDate | undefined, place: string | undefined): ExternalEvent | undefined {
  const pl = place?.trim() || undefined;
  return date || pl ? { date, place: pl } : undefined;
}

/** Person aus der Antwort; ohne Name (Kennung wie „Muster-12“) ist sie unbrauchbar. */
export function toExternalPerson(w: WtPerson): ExternalPerson | null {
  if (!w.Name) return null;
  const given = [w.FirstName, w.MiddleName].filter((x) => x && x.trim()).join(" ").trim();
  const ref: ExternalRef = { system: SYSTEM, id: w.Name };
  return {
    ref,
    url: `https://www.wikitree.com/wiki/${encodeURIComponent(w.Name)}`,
    givenNames: given || undefined,
    surname: w.LastNameAtBirth?.trim() || undefined,
    sex: sexOf(w.Gender),
    birth: event(wikitreeDate(w.BirthDate, w.DataStatus?.BirthDate), w.BirthLocation),
    death: event(wikitreeDate(w.DeathDate, w.DataStatus?.DeathDate), w.DeathLocation),
  };
}

export interface WikiTreeOptions {
  /** Adresse der API; Standard `WIKITREE_ENDPOINT` (im Browser nur mit Durchleiter nutzbar) */
  baseUrl?: string;
}

export function createWikiTreeProvider(opts: WikiTreeOptions = {}): Provider {
  const base = opts.baseUrl ?? WIKITREE_ENDPOINT;
  return {
    id: SYSTEM,
    label: "WikiTree",
    needsKey: false,
    disclosure: "Gesendet werden Vor-/Nachname und ggf. Jahre an api.wikitree.com (über die eingestellte Adresse).",
    async search(query, ctx) {
      if (!query.surname?.trim() && !query.givenNames?.trim()) return [];
      const json = (await requestJson(
        withParams(base, {
          action: "searchPerson",
          FirstName: query.givenNames?.trim(),
          LastName: query.surname?.trim(),
          BirthDate: query.birthYear,
          DeathDate: query.deathYear,
          fields: FIELDS,
          limit: 20,
          appId: APP_ID,
        }),
        ctx,
        {},
        "WikiTree",
      )) as { status?: number | string; matches?: WtPerson[] }[];
      const first = Array.isArray(json) ? json[0] : undefined;
      if (!first || !Array.isArray(first.matches)) {
        throw new ProviderError("format", "WikiTree hat keine lesbare Antwort geliefert.");
      }
      return first.matches.map(toExternalPerson).filter((p): p is ExternalPerson => p !== null);
    },
    async fetchRelatives(ref, ctx) {
      if (ref.system !== SYSTEM) throw new ProviderError("config", "Verweis gehört nicht zu WikiTree.");
      const json = (await requestJson(
        withParams(base, {
          action: "getRelatives",
          keys: ref.id,
          getParents: 1,
          getSpouses: 1,
          getChildren: 1,
          fields: FIELDS,
          appId: APP_ID,
        }),
        ctx,
        {},
        "WikiTree",
      )) as { items?: { person?: WtRelatives }[] }[];
      const person = Array.isArray(json) ? json[0]?.items?.[0]?.person : undefined;
      if (!person) throw new ProviderError("format", `WikiTree kennt kein offenes Profil ${ref.id}.`);
      return buildBatch(person);
    },
  };
}

type WtRelatives = WtPerson & {
  Parents?: Record<string, WtPerson>;
  Spouses?: Record<string, WtPerson>;
  Children?: Record<string, WtPerson>;
};

/** Eltern-, Partner- und Kinderlisten zu Personen und Unions zusammenführen. */
export function buildBatch(w: WtRelatives): ImportBatch {
  const root = toExternalPerson(w);
  if (!root) throw new ProviderError("format", "WikiTree-Profil ohne Namen.");
  const people = new Map<string, ExternalPerson>([[root.ref.id, root]]);
  const nameById = new Map<number, string>();
  if (w.Id !== undefined && w.Name) nameById.set(w.Id, w.Name);

  const add = (m: Record<string, WtPerson> | undefined): WtPerson[] => {
    const list = m && !Array.isArray(m) ? Object.values(m) : [];
    for (const x of list) {
      const p = toExternalPerson(x);
      if (!p) continue;
      people.set(p.ref.id, p);
      if (x.Id !== undefined && x.Name) nameById.set(x.Id, x.Name);
    }
    return list;
  };
  const parents = add(w.Parents);
  const spouses = add(w.Spouses);
  const children = add(w.Children);
  const ref = (id: string): ExternalRef => ({ system: SYSTEM, id });
  const named = (id: number | undefined) => (id ? nameById.get(id) : undefined);

  const unions: ExternalUnion[] = [];
  if (parents.length) {
    const partners = [named(w.Father), named(w.Mother)].filter((x): x is string => !!x).map(ref);
    if (partners.length) unions.push({ partners, children: [root.ref] });
  }
  const placed = new Set<string>();
  for (const s of spouses) {
    if (!s.Name) continue;
    const mine = children.filter((c) => c.Name && (c.Father === s.Id || c.Mother === s.Id));
    mine.forEach((c) => placed.add(c.Name!));
    unions.push({
      partners: [root.ref, ref(s.Name)],
      children: mine.map((c) => ref(c.Name!)),
      marriage: event(wikitreeDate(s.marriage_date), s.marriage_location),
      end: event(wikitreeDate(s.marriage_end_date), undefined),
    });
  }
  const rest = children.filter((c) => c.Name && !placed.has(c.Name));
  if (rest.length) unions.push({ partners: [root.ref], children: rest.map((c) => ref(c.Name!)) });
  return { provider: SYSTEM, root: root.ref, people: [...people.values()], unions };
}
