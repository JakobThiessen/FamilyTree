import { describe, expect, it } from "vitest";
import { de } from "../../src/ui/locales/de";
import { en } from "../../src/ui/locales/en";
import { detectLang, formatNumber, translate, translateN } from "../../src/ui/i18n";
import { bloodRelationLabel, formatFuzzyDate, FamilyGraph, describeRelationship } from "../../src/core";
import type { TreeData } from "../../src/core";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe("Wörterbücher", () => {
  it("haben in beiden Sprachen dieselben Schlüssel", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });

  it("verwenden in beiden Sprachen dieselben Platzhalter", () => {
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(de[key]));
    }
  });

  it("haben keine leeren Texte und zu jedem .one ein .other", () => {
    for (const [k, v] of [...Object.entries(de), ...Object.entries(en)]) expect(v.length, k).toBeGreaterThan(0);
    for (const k of Object.keys(de)) if (k.endsWith(".one")) expect(de, k).toHaveProperty(k.replace(/\.one$/, ".other"));
  });
});

describe("translate", () => {
  it("füllt Platzhalter und lässt unbekannte stehen", () => {
    expect(translate("de", "import.summary", { persons: 3, unions: 2, sources: 1 })).toBe("3 Personen, 2 Partnerschaften, 1 Quellen");
    expect(translate("en", "import.summary", { persons: 3, unions: 2, sources: 1 })).toBe("3 people, 2 partnerships, 1 sources");
    expect(translate("en", "viewer.error", {})).toBe("Error: {error}");
  });

  it("wählt die Mehrzahlform", () => {
    expect(translateN("de", "import.warnings", 1)).toBe("1 Hinweis beim Import");
    expect(translateN("de", "import.warnings", 5)).toBe("5 Hinweise beim Import");
    expect(translateN("en", "map.persons", 1)).toBe("1 person");
    expect(translateN("en", "map.persons", 0)).toBe("0 people");
  });

  it("formatiert Zahlen je Sprache", () => {
    expect(formatNumber("de", 1234.5)).toBe("1.234,5");
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
  });
});

describe("detectLang", () => {
  it("bevorzugt die gespeicherte Wahl, dann die Browsersprache, sonst Deutsch", () => {
    expect(detectLang("en", "de-DE")).toBe("en");
    expect(detectLang(null, "en-GB")).toBe("en");
    expect(detectLang(null, "fr-FR")).toBe("de");
    expect(detectLang("xx", undefined)).toBe("de");
  });
});

describe("Anzeige im Kern auf Englisch", () => {
  it("formatiert unscharfe Daten", () => {
    expect(formatFuzzyDate({ kind: "exact", year: 1850, month: 3, day: 12 }, "en")).toBe("12 March 1850");
    expect(formatFuzzyDate({ kind: "about", year: 1750 }, "en")).toBe("about 1750");
    expect(formatFuzzyDate({ kind: "between", year: 1700, yearTo: 1710 }, "en")).toBe("between 1700 and 1710");
    expect(formatFuzzyDate(undefined, "en")).toBe("unknown");
    expect(formatFuzzyDate({ kind: "before", year: 1800 })).toBe("vor 1800"); // Standard bleibt Deutsch
  });

  it("benennt Verwandtschaft", () => {
    const b = (u: number, d: number, s: "M" | "F" | "U" = "U", half = false) => bloodRelationLabel(u, d, s, half, "en");
    expect(b(0, 1, "M")).toBe("Father");
    expect(b(0, 2, "F")).toBe("Grandmother");
    expect(b(0, 3, "M")).toBe("Great-grandfather");
    expect(b(0, 4, "F")).toBe("Great-great-grandmother");
    expect(b(2, 0, "M")).toBe("Grandson");
    expect(b(1, 1, "F", true)).toBe("Half-sister");
    expect(b(1, 2, "F")).toBe("Aunt");
    expect(b(1, 3, "M")).toBe("Great-uncle");
    expect(b(2, 1, "F")).toBe("Niece");
    expect(b(2, 2)).toBe("1st cousin");
    expect(b(3, 3)).toBe("2nd cousin");
    expect(b(3, 2)).toBe("1st cousin, once removed");
    expect(b(2, 4)).toBe("1st cousin, twice removed");
    expect(b(0, 9, "M")).toBe("Ancestor (9 generations away)");
  });

  it("beschreibt Partner, Schwäger und Nicht-Verwandte auf Englisch", () => {
    const data: TreeData = {
      version: 1,
      persons: [
        { id: "m", sex: "M", givenNames: "Max" },
        { id: "f", sex: "F", givenNames: "Fina" },
        { id: "x", sex: "F", givenNames: "Xenia" },
        { id: "k", sex: "M", givenNames: "Kai" },
      ],
      unions: [
        { id: "u1", partnerIds: ["m", "f"], kind: "marriage", endReason: "divorce", children: [{ personId: "k", kind: "biological" }] },
      ],
      sources: [],
    };
    const g = new FamilyGraph(data);
    expect(describeRelationship(g, "m", "f", { lang: "en" }).label).toBe("Ex-husband");
    expect(describeRelationship(g, "m", "k", { lang: "en" }).label).toContain("Father");
    expect(describeRelationship(g, "x", "m", { lang: "en" }).label).toBe("not related");
    expect(describeRelationship(g, "x", "m").label).toBe("nicht verwandt");
  });
});
