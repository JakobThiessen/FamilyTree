import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadGraph, collectPlaces, lifePaths, placeKey } from "../../src/core";

const g = loadGraph(readFileSync("example/json/migration.json", "utf8"));

describe("placeKey", () => {
  it("ignoriert Groß-/Kleinschreibung und doppelte Leerzeichen", () => {
    expect(placeKey("  Muster  Dorf ")).toBe("muster dorf");
  });
});

describe("collectPlaces", () => {
  const places = collectPlaces(g);
  const by = (name: string) => places.find((p) => p.name === name)!;

  it("fasst gleiche Orte zusammen und zählt Personen", () => {
    expect(by("Musterdorf").persons).toBe(3); // p_1 (Geburt, Tod, Heirat), p_2 (Tod), p_3 (Geburt)
    expect(by("Musterdorf").events.length).toBeGreaterThanOrEqual(5);
    // nach Personenzahl absteigend sortiert
    const counts = places.map((p) => p.persons);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("übernimmt Koordinaten aus den Daten, auch wenn ein Ereignis nur den Namen trägt", () => {
    expect(by("Musterdorf").coords).toEqual({ lat: 48.2, lon: 11.5 });
    expect(by("Musterdorf").coordsFrom).toBe("data");
    expect(by("Ort ohne Koordinaten").coords).toBeUndefined();
  });

  it("ergänzt fehlende Koordinaten aus bekannten Orten und kennzeichnet sie", () => {
    const known = new Map([[placeKey("Ort ohne Koordinaten"), { lat: 1, lon: 2 }]]);
    const p = collectPlaces(g, undefined, known).find((x) => x.name === "Ort ohne Koordinaten")!;
    expect(p.coords).toEqual({ lat: 1, lon: 2 });
    expect(p.coordsFrom).toBe("lookup");
  });

  it("beschränkt auf eine Personenauswahl", () => {
    expect(collectPlaces(g, ["p_7"]).map((p) => p.name)).toEqual(["Westfeld"]);
  });
});

describe("lifePaths", () => {
  it("ordnet Geburt, Heirat, Tod und fasst gleiche Nachbarorte zusammen", () => {
    const paths = lifePaths(g, ["p_3", "p_1"]);
    expect(paths.map((p) => p.personId)).toEqual(["p_1", "p_3"]); // nach Geburtsjahr
    const friedrich = paths[1]!;
    expect(friedrich.stops.map((s) => [s.name, s.kind])).toEqual([
      ["Musterdorf", "birth"],
      ["Beispielhafen", "union"],
      ["Neustadt-Beispiel", "death"],
    ]);
    // Heinrich: Geburt, Heirat und Tod am selben Ort → eine Station
    expect(paths[0]!.stops).toHaveLength(1);
  });

  it("lässt Personen ohne Ortsangabe weg", () => {
    expect(lifePaths(g, ["nope"])).toEqual([]);
  });
});
