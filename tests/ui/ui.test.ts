import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FamilyGraph, PersonSearchIndex, normalizeText } from "../../src/core";
import type { Person, TreeData } from "../../src/core";
import { importGedcom } from "../../src/import/gedcomImport";
import { describePerson } from "../../src/ui/personInfo";

const load = (f: string): TreeData => JSON.parse(readFileSync(`example/json/${f}`, "utf8")) as TreeData;

describe("Namenssuche", () => {
  const persons: Person[] = [
    { id: "a", givenNames: "Anna", surname: "Müller", sex: "F", birth: { date: { kind: "exact", year: 1850 } } },
    { id: "b", givenNames: "Hannah", surname: "Schmidt", sex: "F" },
    { id: "c", givenNames: "Karl", surname: "Strauß", sex: "M", death: { date: { kind: "exact", year: 1901 } } },
    { id: "d", givenNames: "Anna Maria", surname: "Muller", sex: "F" },
  ];
  const index = new PersonSearchIndex(persons);

  it("normalisiert Umlaute und ß", () => {
    expect(normalizeText("Müller Strauß")).toBe("muller strauss");
  });
  it("findet unabhängig von Akzenten und Groß-/Kleinschreibung", () => {
    expect(index.search("MULLER").map((h) => h.id).sort()).toEqual(["a", "d"]);
    expect(index.search("strauss").map((h) => h.id)).toEqual(["c"]);
  });
  it("Wortanfang schlägt Treffer mitten im Wort", () => {
    expect(index.search("ann").map((h) => h.id)).toEqual(["a", "d", "b"]);
  });
  it("alle Wörter müssen passen, auch Jahre", () => {
    expect(index.search("anna 1850").map((h) => h.id)).toEqual(["a"]);
    expect(index.search("karl 1850")).toEqual([]);
    expect(index.search("1901").map((h) => h.id)).toEqual(["c"]);
  });
  it("führt Änderungen nach (update)", () => {
    const idx = new PersonSearchIndex(persons);
    idx.update([{ id: "b", givenNames: "Berta", surname: "Neumann", sex: "F" }, { id: "e", givenNames: "Emil", surname: "Neumann", sex: "M" }], ["c"]);
    expect(idx.size).toBe(4);
    expect(idx.search("neumann").map((h) => h.id).sort()).toEqual(["b", "e"]);
    expect(idx.search("schmidt")).toEqual([]);
    expect(idx.search("strauss")).toEqual([]);
  });
  it("leere Anfrage und Limit", () => {
    expect(index.search("   ")).toEqual([]);
    expect(index.search("a", 2)).toHaveLength(2);
  });
});

describe("Personendetails", () => {
  it("zeigt Partnerschaften in Reihenfolge, Kinder und Eltern", () => {
    const data = load("multiple-marriages.json");
    const graph = new FamilyGraph(data);
    const sources = new Map(data.sources.map((s) => [s.id, s]));
    const person = data.persons.find((p) => graph.unionsOf(p.id).length >= 2)!;
    const info = describePerson(graph, sources, person.id)!;
    expect(info.unions.length).toBeGreaterThanOrEqual(2);
    const child = info.unions.flatMap((u) => u.children)[0];
    expect(child).toBeTruthy();
    const kid = describePerson(graph, sources, child!.id)!;
    expect(kid.parentFamilies.length).toBeGreaterThan(0);
  });
  it("löst Quellen auf und lässt nur http(s)-Adressen als Link zu", () => {
    const data: TreeData = {
      version: 1,
      sources: [
        { id: "s1", title: "Kirchenbuch", url: "https://example.org/kb" },
        { id: "s2", title: "Böse", url: "javascript:alert(1)" },
      ],
      persons: [
        {
          id: "p1", sex: "M", givenNames: "Max", notes: ["Notiz"], status: "assumed",
          birth: { date: { kind: "about", year: 1700 }, status: "assumed", citations: [{ sourceId: "s1", detail: "S. 4" }, { sourceId: "s2" }, { sourceId: "fehlt" }] },
        },
      ],
      unions: [],
    };
    const info = describePerson(new FamilyGraph(data), new Map(data.sources.map((s) => [s.id, s])), "p1")!;
    expect(info.status).toBe("assumed");
    expect(info.notes).toEqual(["Notiz"]);
    const c = info.events[0]!.citations;
    expect(c[0]).toMatchObject({ title: "Kirchenbuch", detail: "S. 4", url: "https://example.org/kb" });
    expect(c[1]!.url).toBeUndefined();
    expect(c[2]!.title).toContain("fehlt");
    expect(info.events[0]!.date).toBe("um 1700");
  });
  it("unbekannte Person gibt null, GEDCOM-Beispiel lässt sich beschreiben", () => {
    const { data } = importGedcom(readFileSync("example/gedcom/cousin-marriage.ged"));
    const graph = new FamilyGraph(data);
    expect(describePerson(graph, new Map(), "gibtsnicht")).toBeNull();
    expect(describePerson(graph, new Map(), data.persons[0]!.id)).not.toBeNull();
  });
});
