// Tests der Anbieter mit nachgebauten Antworten (erfundene Personen, keine Netzzugriffe).
import { describe, expect, it } from "vitest";
import { createFamilySearchProvider } from "../../src/providers/familysearch";
import { createWikidataProvider, qid, relativesQuery, searchQuery, splitName, wikidataDate } from "../../src/providers/wikidata";
import { createWikiTreeProvider, wikitreeDate } from "../../src/providers/wikitree";
import { ProviderError } from "../../src/providers";

/** `fetch`-Attrappe: merkt sich die Adressen und liefert `body` (oder einen Fehler). */
function mockFetch(body: unknown, init: { status?: number; throws?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, i?: RequestInit) => {
    calls.push({ url: String(url), init: i });
    if (init.throws) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(body), { status: init.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

// ---------- WikiTree ----------

const wtSearch = [
  {
    status: 0,
    matches: [
      {
        Name: "Beispiel-1", Id: 101, FirstName: "Johann", MiddleName: "Georg", LastNameAtBirth: "Beispiel", Gender: "Male",
        BirthDate: "1800-03-12", DeathDate: "1875-00-00", BirthLocation: "Musterdorf", DeathLocation: "",
        DataStatus: { BirthDate: "", DeathDate: "guess" },
      },
      { Name: "Beispiel-9", Id: 109, FirstName: "Anna", LastNameAtBirth: "Beispiel", Gender: "Female", BirthDate: "0000-00-00", DeathDate: "0000-00-00" },
      { Id: 5 }, // ohne Name: wird übersprungen
    ],
  },
];

const wtRelatives = [
  {
    status: 0,
    items: [
      {
        person: {
          Name: "Beispiel-1", Id: 101, FirstName: "Johann", LastNameAtBirth: "Beispiel", Gender: "Male", BirthDate: "1800-03-12",
          Father: 104, Mother: 105,
          Parents: {
            "104": { Name: "Probe-4", Id: 104, FirstName: "Peter", LastNameAtBirth: "Probe", Gender: "Male", BirthDate: "1770-00-00" },
            "105": { Name: "Vorlage-5", Id: 105, FirstName: "Maria", LastNameAtBirth: "Vorlage", Gender: "Female" },
          },
          Spouses: {
            "102": {
              Name: "Muster-2", Id: 102, FirstName: "Anna", LastNameAtBirth: "Muster", Gender: "Female", BirthDate: "1802-00-00",
              marriage_date: "1825-05-01", marriage_location: "Musterdorf", marriage_end_date: "1832-00-00",
            },
          },
          Children: {
            "103": { Name: "Beispiel-3", Id: 103, FirstName: "Heinrich", LastNameAtBirth: "Beispiel", Gender: "Male", Father: 101, Mother: 102 },
            "106": { Name: "Beispiel-6", Id: 106, FirstName: "Luise", LastNameAtBirth: "Beispiel", Gender: "Female", Father: 101, Mother: 0 },
          },
        },
      },
    ],
  },
];

describe("WikiTree", () => {
  it("rechnet Daten mit Sicherheit um", () => {
    expect(wikitreeDate("1755-00-00")).toEqual({ kind: "exact", year: 1755 });
    expect(wikitreeDate("1755-04-00")).toEqual({ kind: "exact", year: 1755, month: 4 });
    expect(wikitreeDate("1755-04-09", "guess")).toEqual({ kind: "about", year: 1755, month: 4, day: 9 });
    expect(wikitreeDate("1755-00-00", "before")?.kind).toBe("before");
    expect(wikitreeDate("0000-00-00")).toBeUndefined();
    expect(wikitreeDate(undefined)).toBeUndefined();
  });

  it("sucht und wandelt Treffer um", async () => {
    const { f, calls } = mockFetch(wtSearch);
    const wt = createWikiTreeProvider({ baseUrl: "/wikitree/api.php" });
    const res = await wt.search({ givenNames: "Johann", surname: "Beispiel", birthYear: 1800 }, { fetch: f });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/^\/wikitree\/api\.php\?action=searchPerson&/);
    expect(calls[0]!.url).toContain("FirstName=Johann");
    expect(calls[0]!.url).toContain("BirthDate=1800");
    expect(res.map((p) => p.ref.id)).toEqual(["Beispiel-1", "Beispiel-9"]);
    expect(res[0]).toMatchObject({
      givenNames: "Johann Georg", surname: "Beispiel", sex: "M",
      url: "https://www.wikitree.com/wiki/Beispiel-1",
      birth: { date: { kind: "exact", year: 1800, month: 3, day: 12 }, place: "Musterdorf" },
      death: { date: { kind: "about", year: 1875 } },
    });
    expect(res[1]!.birth).toBeUndefined();
  });

  it("sendet ohne Namen keine Anfrage", async () => {
    const { f, calls } = mockFetch(wtSearch);
    expect(await createWikiTreeProvider().search({ birthYear: 1800 }, { fetch: f })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("baut Eltern-, Partner- und Kinder-Unions", async () => {
    const { f, calls } = mockFetch(wtRelatives);
    const batch = await createWikiTreeProvider().fetchRelatives({ system: "wikitree", id: "Beispiel-1" }, { fetch: f });
    expect(calls[0]!.url).toContain("action=getRelatives");
    expect(batch.people.map((p) => p.ref.id).sort()).toEqual(
      ["Beispiel-1", "Beispiel-3", "Beispiel-6", "Muster-2", "Probe-4", "Vorlage-5"],
    );
    const ids = (u: { partners: { id: string }[]; children: { id: string }[] }) => [u.partners.map((r) => r.id), u.children.map((r) => r.id)];
    expect(batch.unions.map(ids)).toEqual([
      [["Probe-4", "Vorlage-5"], ["Beispiel-1"]],
      [["Beispiel-1", "Muster-2"], ["Beispiel-3"]],
      [["Beispiel-1"], ["Beispiel-6"]], // Kind ohne bekannte Mutter
    ]);
    expect(batch.unions[1]!.marriage).toEqual({ date: { kind: "exact", year: 1825, month: 5, day: 1 }, place: "Musterdorf" });
    expect(batch.unions[1]!.end?.date?.year).toBe(1832);
  });

  it("meldet Fehler verständlich", async () => {
    const wt = createWikiTreeProvider();
    const q = { surname: "Beispiel" };
    await expect(wt.search(q, { fetch: mockFetch(null, { throws: true }).f })).rejects.toMatchObject({ kind: "network" });
    await expect(wt.search(q, { fetch: mockFetch({}, { status: 429 }).f })).rejects.toMatchObject({ kind: "http", status: 429 });
    await expect(wt.search(q, { fetch: mockFetch({ unerwartet: 1 }).f })).rejects.toMatchObject({ kind: "format" });
    await expect(wt.fetchRelatives({ system: "wikidata", id: "Q1" })).rejects.toBeInstanceOf(ProviderError);
  });
});

// ---------- Wikidata ----------

const lit = (value: string) => ({ type: "literal", value });
const uri = (q: string) => ({ type: "uri", value: `http://www.wikidata.org/entity/${q}` });

const wdSearchRows = [
  { item: uri("Q9001"), itemLabel: lit("Johann Georg Beispiel"), itemDescription: lit("erfundener Kaufmann"), sex: uri("Q6581097"),
    b: lit("1800-03-12T00:00:00Z"), bp: lit("11"), d: lit("1875-01-01T00:00:00Z"), dp: lit("9"), bplaceLabel: lit("Musterdorf"), famLabel: lit("Beispiel") },
  // zweite Zeile derselben Person (zweiter Geburtsort): wird verworfen
  { item: uri("Q9001"), itemLabel: lit("Johann Georg Beispiel"), bplaceLabel: lit("Anderswo") },
  // Person ohne Beschriftung (Dienst liefert die Q-Nummer): übersprungen
  { item: uri("Q9002"), itemLabel: lit("Q9002") },
  { item: uri("Q9003"), itemLabel: lit("Anna Muster"), sex: uri("Q6581072"), b: lit("1802-01-01T00:00:00Z"), bp: lit("8") },
];

describe("Wikidata", () => {
  it("rechnet Zeitwerte nach Genauigkeit um", () => {
    expect(wikidataDate("1800-03-12T00:00:00Z", "11")).toEqual({ kind: "exact", year: 1800, month: 3, day: 12 });
    expect(wikidataDate("1800-03-01T00:00:00Z", "10")).toEqual({ kind: "exact", year: 1800, month: 3 });
    expect(wikidataDate("1800-01-01T00:00:00Z", "9")).toEqual({ kind: "exact", year: 1800 });
    expect(wikidataDate("1800-01-01T00:00:00Z", "8")).toEqual({ kind: "about", year: 1800 });
    expect(wikidataDate("-0100-01-01T00:00:00Z", "9")).toBeUndefined();
    expect(wikidataDate(undefined, undefined)).toBeUndefined();
  });

  it("teilt Namen und liest Q-Nummern nur aus Entitäts-Adressen", () => {
    expect(splitName("Johann Georg Beispiel", "Beispiel")).toEqual({ givenNames: "Johann Georg", surname: "Beispiel" });
    expect(splitName("Anna von Muster")).toEqual({ givenNames: "Anna von", surname: "Muster" });
    expect(splitName("Einzelname")).toEqual({ surname: "Einzelname" });
    expect(qid("http://www.wikidata.org/entity/Q42")).toBe("Q42");
    expect(qid("http://evil.example/entity/Q42")).toBeUndefined();
    expect(qid("http://www.wikidata.org/entity/Q42; DROP")).toBeUndefined();
  });

  it("maskiert Suchtext und prüft die Kennung in der Abfrage", () => {
    expect(searchQuery({ surname: 'Be"ispiel\\' })).toContain('Be\\"ispiel\\\\ haswbstatement:P31=Q5');
    expect(() => relativesQuery("Q1} DELETE")).toThrow(ProviderError);
  });

  it("sucht und sortiert nach Geburtsjahr", async () => {
    const { f, calls } = mockFetch({ results: { bindings: wdSearchRows } });
    const wd = createWikidataProvider();
    const res = await wd.search({ givenNames: "Johann", surname: "Beispiel", birthYear: 1802 }, { fetch: f });
    expect(calls[0]!.url).toMatch(/^https:\/\/query\.wikidata\.org\/sparql\?format=json&query=/);
    expect(calls[0]!.url).toContain("Johann+Beispiel");
    expect(res.map((p) => p.ref.id)).toEqual(["Q9003", "Q9001"]);
    expect(res[1]).toMatchObject({
      givenNames: "Johann Georg", surname: "Beispiel", sex: "M", summary: "erfundener Kaufmann",
      url: "https://www.wikidata.org/wiki/Q9001",
      birth: { date: { kind: "exact", year: 1800, month: 3, day: 12 }, place: "Musterdorf" },
      death: { date: { kind: "exact", year: 1875 } },
    });
  });

  it("baut Familie aus Eltern, Partner und Kindern", async () => {
    const self = { results: { bindings: [{ item: uri("Q9001"), itemLabel: lit("Johann Beispiel") }] } };
    const rel = {
      results: {
        bindings: [
          { kind: lit("father"), item: uri("Q9010"), itemLabel: lit("Peter Probe") },
          { kind: lit("spouse"), item: uri("Q9003"), itemLabel: lit("Anna Muster") },
          { kind: lit("child"), item: uri("Q9020"), itemLabel: lit("Heinrich Beispiel"), relFather: uri("Q9001"), relMother: uri("Q9003") },
          { kind: lit("child"), item: uri("Q9021"), itemLabel: lit("Luise Beispiel"), relFather: uri("Q9001") },
        ],
      },
    };
    let n = 0;
    const f = (async () => new Response(JSON.stringify(n++ === 0 ? self : rel))) as unknown as typeof fetch;
    const batch = await createWikidataProvider().fetchRelatives({ system: "wikidata", id: "Q9001" }, { fetch: f });
    expect(batch.people.map((p) => p.ref.id).sort()).toEqual(["Q9001", "Q9003", "Q9010", "Q9020", "Q9021"]);
    const ids = (u: { partners: { id: string }[]; children: { id: string }[] }) => [u.partners.map((r) => r.id), u.children.map((r) => r.id)];
    expect(batch.unions.map(ids)).toEqual([
      [["Q9010"], ["Q9001"]],
      [["Q9001", "Q9003"], ["Q9020"]],
      [["Q9001"], ["Q9021"]],
    ]);
  });

  it("meldet CORS-/Netzfehler als network", async () => {
    await expect(createWikidataProvider().search({ surname: "X" }, { fetch: mockFetch(null, { throws: true }).f })).rejects.toMatchObject({
      kind: "network",
    });
  });
});

// ---------- FamilySearch (Gerüst) ----------

describe("FamilySearch (Gerüst)", () => {
  const body = {
    entries: [
      {
        content: {
          gedcomx: {
            persons: [
              {
                id: "ABCD-123",
                gender: { type: "http://gedcomx.org/Male" },
                names: [{ nameForms: [{ parts: [{ type: "http://gedcomx.org/Given", value: "Johann" }, { type: "http://gedcomx.org/Surname", value: "Beispiel" }] }] }],
                facts: [
                  { type: "http://gedcomx.org/Birth", date: { formal: "+1800-03-12" }, place: { original: "Musterdorf" } },
                  { type: "http://gedcomx.org/Death", date: { formal: "A+1875" } },
                ],
              },
            ],
          },
        },
      },
    ],
  };

  it("verlangt ein Token und sendet es nur als Kopfzeile", async () => {
    const { f, calls } = mockFetch(body);
    await expect(createFamilySearchProvider().search({ surname: "Beispiel" }, { fetch: f })).rejects.toMatchObject({ kind: "config" });
    expect(calls).toHaveLength(0);
    const res = await createFamilySearchProvider({ accessToken: "TESTTOKEN" }).search({ givenNames: "Johann", surname: "Beispiel" }, { fetch: f });
    expect(calls[0]!.url).not.toContain("TESTTOKEN");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer TESTTOKEN");
    expect(res[0]).toMatchObject({
      ref: { system: "familysearch", id: "ABCD-123" }, givenNames: "Johann", surname: "Beispiel", sex: "M",
      birth: { date: { kind: "exact", year: 1800, month: 3, day: 12 }, place: "Musterdorf" },
      death: { date: { kind: "about", year: 1875 } },
    });
  });

  it("Verwandte sind noch nicht umgesetzt", async () => {
    await expect(createFamilySearchProvider().fetchRelatives({ system: "familysearch", id: "X" })).rejects.toMatchObject({ kind: "unsupported" });
  });
});
