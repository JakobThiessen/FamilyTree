// Ortssuche mit nachgebauten Wikidata-Antworten (erfundene Orte, kein Netz).
import { describe, expect, it } from "vitest";
import { lookupPlace, lookupPlaces } from "../../src/providers";

function route(responses: { match: string; body: unknown }[]) {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(String(url));
    const r = responses.find((x) => String(url).includes(x.match));
    return new Response(JSON.stringify(r?.body ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, urls };
}

const search = { search: [{ id: "Q1", label: "Beispielhafen", description: "Stadt" }, { id: "Q2", label: "Beispielhafen (Fluss)" }] };
const entities = {
  entities: {
    Q1: { claims: {} }, // erster Treffer ohne Koordinaten
    Q2: { claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 53.5, longitude: 8.6 } } } }] } },
  },
};

describe("lookupPlace", () => {
  it("nimmt den ersten Treffer mit Koordinaten und sucht nur den Teil vor dem Komma", async () => {
    const { f, urls } = route([{ match: "wbsearchentities", body: search }, { match: "wbgetentities", body: entities }]);
    const m = await lookupPlace("Beispielhafen, Küste", { fetch: f });
    expect(m).toMatchObject({ qid: "Q2", lat: 53.5, lon: 8.6 });
    expect(urls[0]).toContain("search=Beispielhafen&");
    expect(urls[0]).not.toContain("K%C3%BCste");
    expect(urls[1]).toContain("ids=Q1%7CQ2");
  });

  it("liefert null ohne Treffer oder ohne Koordinaten", async () => {
    const none = route([{ match: "wbsearchentities", body: { search: [] } }]);
    expect(await lookupPlace("Nirgendwo", { fetch: none.f })).toBeNull();
    const noCoords = route([
      { match: "wbsearchentities", body: search },
      { match: "wbgetentities", body: { entities: { Q1: { claims: {} }, Q2: { claims: {} } } } },
    ]);
    expect(await lookupPlace("Beispielhafen", { fetch: noCoords.f })).toBeNull();
  });

  it("verwirft ungültige Kennungen und leere Namen", async () => {
    const bad = route([{ match: "wbsearchentities", body: { search: [{ id: "evil", label: "x" }] } }]);
    expect(await lookupPlace("X", { fetch: bad.f })).toBeNull();
    expect(bad.urls).toHaveLength(1);
    expect(await lookupPlace("  ,x", { fetch: bad.f })).toBeNull();
  });

  it("lookupPlaces arbeitet nacheinander und meldet den Fortschritt", async () => {
    const { f } = route([{ match: "wbsearchentities", body: search }, { match: "wbgetentities", body: entities }]);
    const seen: string[] = [];
    const res = await lookupPlaces(["A", "B"], { fetch: f }, (n) => seen.push(n));
    expect(seen).toEqual(["A", "B"]);
    expect(res.size).toBe(2);
  });
});
