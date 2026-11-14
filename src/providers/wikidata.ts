/**
 * Wikidata über den offenen SPARQL-Dienst (https://query.wikidata.org).
 * Der Dienst erlaubt Abfragen direkt aus dem Browser (CORS: `*`). Wikidata kennt vor allem
 * historisch bedeutsame Personen, Adel und bekannte Familien, keine Durchschnittsfamilien.
 * Es werden nur Name, Geschlecht, Geburt, Tod und die nächsten Verwandten (P22, P25, P26, P40) gelesen.
 */
import type { FuzzyDate, Sex } from "../core/types";
import { requestJson, withParams } from "./http";
import { ProviderError } from "./types";
import type {
  ExternalEvent,
  ExternalPerson,
  ExternalUnion,
  ImportBatch,
  PersonQuery,
  Provider,
  ProviderContext,
} from "./types";
import type { ExternalRef } from "../core/types";

export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const SYSTEM = "wikidata";
const ENTITY = "http://www.wikidata.org/entity/";

/** Eine Zeile des SPARQL-Ergebnisses: Variable → { value }. */
type Row = Record<string, { value: string } | undefined>;

const val = (r: Row, k: string): string | undefined => r[k]?.value;

/** Q-Nummer aus einer Entitäts-URL; alles andere ist kein gültiger Verweis. */
export function qid(uri: string | undefined): string | undefined {
  if (!uri?.startsWith(ENTITY)) return undefined;
  const id = uri.slice(ENTITY.length);
  return /^Q\d+$/.test(id) ? id : undefined;
}

const sexOf = (uri: string | undefined): Sex =>
  qid(uri) === "Q6581097" ? "M" : qid(uri) === "Q6581072" ? "F" : "U";

/** Wikidata-Zeitwert + Genauigkeit (9 Jahr, 10 Monat, 11 Tag; darunter Jahrzehnt/Jahrhundert) → `FuzzyDate`. */
export function wikidataDate(time: string | undefined, precision: string | undefined): FuzzyDate | undefined {
  const m = time && /^([+-]?\d{1,6})-(\d\d)-(\d\d)/.exec(time);
  if (!m) return undefined;
  const year = Number(m[1]);
  const prec = Number(precision);
  if (!Number.isFinite(year) || year <= 0) return undefined; // v. Chr. nicht abbildbar
  if (prec >= 11) return { kind: "exact", year, month: Number(m[2]), day: Number(m[3]) };
  if (prec === 10) return { kind: "exact", year, month: Number(m[2]) };
  if (prec === 9) return { kind: "exact", year };
  return { kind: "about", year };
}

/** Teilt „Johann Wolfgang von Muster“ mit Hilfe des Familiennamens (P734), sonst am letzten Wort. */
export function splitName(label: string, family?: string): { givenNames?: string; surname?: string } {
  const l = label.trim();
  if (family && l.endsWith(family)) {
    const given = l.slice(0, l.length - family.length).trim();
    return { givenNames: given || undefined, surname: family };
  }
  const i = l.lastIndexOf(" ");
  return i < 0 ? { surname: l } : { givenNames: l.slice(0, i), surname: l.slice(i + 1) };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Gemeinsamer Teil: Geschlecht, Geburt/Tod mit Genauigkeit, Geburtsort, Familienname, Beschriftungen. */
const DETAILS = `
  OPTIONAL { ?item wdt:P21 ?sex. }
  OPTIONAL { ?item p:P569/psv:P569 ?bv. ?bv wikibase:timeValue ?b; wikibase:timePrecision ?bp. }
  OPTIONAL { ?item p:P570/psv:P570 ?dv. ?dv wikibase:timeValue ?d; wikibase:timePrecision ?dp. }
  OPTIONAL { ?item wdt:P19 ?bplace. }
  OPTIONAL { ?item wdt:P734 ?fam. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en,mul". }`;

const FIELDS = "?item ?itemLabel ?itemDescription ?sex ?b ?bp ?d ?dp ?bplaceLabel ?famLabel";

export function searchQuery(q: PersonQuery, limit = 20): string {
  // Volltextsuche (CirrusSearch) statt Etikett-Präfix: findet auch „Johann Goethe“ für „Johann Wolfgang von Goethe“.
  // `haswbstatement:P31=Q5` beschränkt auf Menschen.
  const text = [q.givenNames, q.surname].filter(Boolean).join(" ");
  return `SELECT ${FIELDS} WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "Generator"; wikibase:endpoint "www.wikidata.org";
      mwapi:generator "search"; mwapi:gsrsearch "${esc(text)} haswbstatement:P31=Q5";
      mwapi:gsrnamespace "0"; mwapi:gsrlimit "${limit}".
    ?item wikibase:apiOutputItem mwapi:title.
  }${DETAILS}
} LIMIT ${limit * 4}`;
}

export function relativesQuery(id: string): string {
  if (!/^Q\d+$/.test(id)) throw new ProviderError("config", `Ungültige Wikidata-Kennung: ${id}`);
  return `SELECT ?kind ?relFather ?relMother ${FIELDS} WHERE {
  { wd:${id} wdt:P22 ?item. BIND("father" AS ?kind) }
  UNION { wd:${id} wdt:P25 ?item. BIND("mother" AS ?kind) }
  UNION { wd:${id} wdt:P26 ?item. BIND("spouse" AS ?kind) }
  UNION { wd:${id} wdt:P40 ?item. BIND("child" AS ?kind) }
  OPTIONAL { ?item wdt:P22 ?relFather. }
  OPTIONAL { ?item wdt:P25 ?relMother. }${DETAILS}
} LIMIT 200`;
}

function toPerson(r: Row): ExternalPerson | null {
  const id = qid(val(r, "item"));
  const label = val(r, "itemLabel");
  // Ohne Beschriftung liefert der Dienst die Q-Nummer selbst: kein brauchbarer Name.
  if (!id || !label || label === id) return null;
  const place = val(r, "bplaceLabel");
  const birth: ExternalEvent = { date: wikidataDate(val(r, "b"), val(r, "bp")), place: place && !/^Q\d+$/.test(place) ? place : undefined };
  const death: ExternalEvent = { date: wikidataDate(val(r, "d"), val(r, "dp")) };
  const desc = val(r, "itemDescription");
  const fam = val(r, "famLabel");
  return {
    ref: { system: SYSTEM, id },
    url: `https://www.wikidata.org/wiki/${id}`,
    ...splitName(label, fam && !/^Q\d+$/.test(fam) ? fam : undefined),
    sex: sexOf(val(r, "sex")),
    birth: birth.date || birth.place ? birth : undefined,
    death: death.date ? death : undefined,
    summary: desc,
  };
}

/** Pro Person kann es mehrere Zeilen geben (mehrere Geburtsorte/Daten): die erste zählt. */
function uniquePeople(rows: Row[]): ExternalPerson[] {
  const seen = new Map<string, ExternalPerson>();
  for (const r of rows) {
    const p = toPerson(r);
    if (p && !seen.has(p.ref.id)) seen.set(p.ref.id, p);
  }
  return [...seen.values()];
}

async function sparql(query: string, ctx?: ProviderContext, endpoint = WIKIDATA_ENDPOINT): Promise<Row[]> {
  const json = (await requestJson(
    withParams(endpoint, { format: "json", query }),
    ctx,
    { headers: { Accept: "application/sparql-results+json" } },
    "Wikidata",
  )) as { results?: { bindings?: Row[] } };
  const rows = json?.results?.bindings;
  if (!Array.isArray(rows)) throw new ProviderError("format", "Wikidata hat keine lesbare Antwort geliefert.");
  return rows;
}

export interface WikidataOptions {
  endpoint?: string;
}

export function createWikidataProvider(opts: WikidataOptions = {}): Provider {
  const endpoint = opts.endpoint ?? WIKIDATA_ENDPOINT;
  return {
    id: SYSTEM,
    label: "Wikidata",
    needsKey: false,
    disclosure: "Gesendet werden Vor- und Nachname an query.wikidata.org (Wikimedia).",
    async search(query, ctx) {
      if (!query.surname?.trim() && !query.givenNames?.trim()) return [];
      const people = uniquePeople(await sparql(searchQuery(query), ctx, endpoint));
      // Passende Geburtsjahre zuerst; die Reihenfolge der Quelle bleibt sonst erhalten (stabile Sortierung).
      const dist = (p: ExternalPerson) =>
        query.birthYear !== undefined && p.birth?.date?.year !== undefined
          ? Math.abs(p.birth.date.year - query.birthYear)
          : 1000;
      return people.sort((a, b) => dist(a) - dist(b));
    },
    async fetchRelatives(ref, ctx): Promise<ImportBatch> {
      if (ref.system !== SYSTEM) throw new ProviderError("config", "Verweis gehört nicht zu Wikidata.");
      const [self, rows] = await Promise.all([
        sparql(selfQuery(ref.id), ctx, endpoint),
        sparql(relativesQuery(ref.id), ctx, endpoint),
      ]);
      const root = uniquePeople(self)[0];
      if (!root) throw new ProviderError("format", `Wikidata kennt keine Person ${ref.id}.`);
      return buildBatch(root, rows);
    },
  };
}

function selfQuery(id: string): string {
  if (!/^Q\d+$/.test(id)) throw new ProviderError("config", `Ungültige Wikidata-Kennung: ${id}`);
  return `SELECT ${FIELDS} WHERE { BIND(wd:${id} AS ?item) ${DETAILS} } LIMIT 4`;
}

/** Fügt Eltern, Partner und Kinder zu Personen und Unions zusammen. */
export function buildBatch(root: ExternalPerson, rows: Row[]): ImportBatch {
  const people = new Map<string, ExternalPerson>([[root.ref.id, root]]);
  const kinds = new Map<string, Set<string>>(); // Q → Rollen
  const parentsOfChild = new Map<string, { father?: string; mother?: string }>();
  for (const r of rows) {
    const p = toPerson(r);
    const kind = val(r, "kind");
    if (!p || !kind) continue;
    if (!people.has(p.ref.id)) people.set(p.ref.id, p);
    const set = kinds.get(p.ref.id) ?? new Set();
    set.add(kind);
    kinds.set(p.ref.id, set);
    if (kind === "child") {
      parentsOfChild.set(p.ref.id, { father: qid(val(r, "relFather")), mother: qid(val(r, "relMother")) });
    }
  }
  const ref = (id: string): ExternalRef => ({ system: SYSTEM, id });
  const has = (id: string, k: string) => kinds.get(id)?.has(k) ?? false;
  const ids = [...people.keys()].filter((i) => i !== root.ref.id);

  const unions: ExternalUnion[] = [];
  // Eltern: ein Paar, soweit bekannt.
  const father = ids.find((i) => has(i, "father"));
  const mother = ids.find((i) => has(i, "mother"));
  if (father || mother) {
    unions.push({ partners: [father, mother].filter((x): x is string => !!x).map(ref), children: [root.ref] });
  }
  // Partner: ein Paar je Partner; Kinder gehören dazu, wenn der Partner als anderer Elternteil eingetragen ist.
  const spouses = ids.filter((i) => has(i, "spouse"));
  const children = ids.filter((i) => has(i, "child"));
  const placed = new Set<string>();
  for (const s of spouses) {
    const mine = children.filter((c) => {
      const par = parentsOfChild.get(c);
      return par?.father === s || par?.mother === s;
    });
    mine.forEach((c) => placed.add(c));
    unions.push({ partners: [ref(root.ref.id), ref(s)], children: mine.map(ref), marriage: undefined });
  }
  const rest = children.filter((c) => !placed.has(c));
  if (rest.length) {
    // Kinder ohne bekannten zweiten Elternteil in der Partnerliste: Union nur mit der Wurzelperson.
    unions.push({ partners: [ref(root.ref.id)], children: rest.map(ref) });
  }
  return { provider: SYSTEM, root: root.ref, people: [...people.values()], unions };
}
