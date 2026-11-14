// Dublettenvorschläge und Übernahme externer Treffer (erfundene Personen).
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FamilyGraph, findDuplicates, parseTreeJson } from "../../src/core";
import type { Person, TreeData } from "../../src/core";
import { adoptBatch } from "../../src/providers";
import type { ImportBatch } from "../../src/providers";
import { TreeStore } from "../../src/storage";

const base = (): TreeData => parseTreeJson(readFileSync("example/json/multiple-marriages.json", "utf8"));

const P = (id: string, given: string, surname: string, sex: Person["sex"], birth?: number, death?: number): Person => ({
  id, givenNames: given, surname, sex,
  birth: birth ? { date: { kind: "exact", year: birth } } : undefined,
  death: death ? { date: { kind: "exact", year: death } } : undefined,
});

describe("Dublettenvorschläge", () => {
  const persons = [
    P("a", "Johann Georg", "Beispiel", "M", 1800, 1875),
    P("b", "Johann", "Beispiel", "M", 1850),
    P("c", "Anna", "Beispiel", "F", 1800),
    P("d", "Johann", "Beispial", "M", 1801),
    P("e", "Johann", "Muster", "M", 1800),
  ];

  it("bewertet Name und Jahre, schließt Unpassendes aus", () => {
    const r = findDuplicates(persons, { givenNames: "Johann", surname: "Beispiel", sex: "M", birthYear: 1800, deathYear: 1875 });
    expect(r.map((c) => c.personId)).toEqual(["a", "d"]);
    expect(r[0]).toMatchObject({ level: "high" });
    expect(r[0]!.reasons).toContain("Geburtsjahr gleich");
    // b: 50 Jahre Unterschied, c: anderes Geschlecht/Vorname, e: anderer Nachname
  });

  it("ist unempfindlich gegen Akzente und Schreibweise und braucht einen Nachnamen", () => {
    expect(findDuplicates([P("x", "Jürgen", "Müller", "M", 1900)], { givenNames: "jurgen", surname: "MULLER", birthYear: 1900 })).toHaveLength(1);
    expect(findDuplicates(persons, { givenNames: "Johann" })).toEqual([]);
  });

  it("findet Personen im Beispielbaum", () => {
    const r = findDuplicates(base().persons, { givenNames: "Johann", surname: "Beispiel", birthYear: 1800 });
    expect(r[0]?.personId).toBe("p_1");
  });
});

/** Erfundener Treffer: Johann (Wurzel) mit Frau Anna und Sohn Heinrich. */
const batch = (): ImportBatch => {
  const r = (id: string) => ({ system: "wikitree", id });
  const person = (id: string, given: string, surname: string, sex: "M" | "F", year: number) => ({
    ref: r(id), url: `https://www.wikitree.com/wiki/${id}`, givenNames: given, surname, sex: sex as "M" | "F",
    birth: { date: { kind: "exact" as const, year }, place: "Testort" },
  });
  return {
    provider: "wikitree",
    root: r("Neu-1"),
    people: [person("Neu-1", "Karl", "Neu", "M", 1900), person("Neu-2", "Berta", "Neu", "F", 1902), person("Neu-3", "Emil", "Neu", "M", 1925)],
    unions: [{ partners: [r("Neu-1"), r("Neu-2")], children: [r("Neu-3")], marriage: { date: { kind: "exact", year: 1922 } } }],
  };
};

describe("adoptBatch", () => {
  it("legt vermutete Personen mit Quelle und Union an, ohne die Eingabe zu ändern", () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    const res = adoptBatch(before, batch());
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(res).toMatchObject({ addedPersons: 3, addedUnions: 1, reusedPersons: 0 });
    const root = res.data.persons.find((p) => p.id === res.rootId)!;
    expect(root).toMatchObject({ givenNames: "Karl", status: "assumed", externalRefs: [{ system: "wikitree", id: "Neu-1" }] });
    expect(root.birth).toMatchObject({ status: "assumed", place: { name: "Testort" } });
    const src = res.data.sources.find((s) => s.id === root.birth!.citations![0]!.sourceId)!;
    expect(src.url).toBe("https://www.wikitree.com/wiki/Neu-1");
    const union = res.data.unions.at(-1)!;
    expect(union).toMatchObject({ kind: "marriage", status: "assumed" });
    expect(union.children[0]).toMatchObject({ kind: "biological", status: "assumed" });
    expect(new FamilyGraph(res.data).validate()).toEqual([]);
  });

  it("legt keine neuen Personen an, wenn der Verweis schon im Baum steht (zweite Übernahme)", () => {
    const first = adoptBatch(base(), batch());
    const second = adoptBatch(first.data, batch());
    expect(second).toMatchObject({ addedPersons: 0, addedUnions: 0, reusedPersons: 3 });
    expect(second.data.persons).toHaveLength(first.data.persons.length);
    expect(second.data.unions).toHaveLength(first.data.unions.length);
    expect(second.rootId).toBe(first.rootId);
  });

  it("nimmt ohne Verwandte nur die Wurzelperson", () => {
    const res = adoptBatch(base(), batch(), { includeRelatives: false });
    expect(res).toMatchObject({ addedPersons: 1, addedUnions: 0 });
  });

  it("verknüpft mit einer vorhandenen Person, ohne deren Daten zu ändern", () => {
    const before = base();
    const old = before.persons.find((p) => p.id === "p_1")!;
    const res = adoptBatch(before, batch(), { linkTo: "p_1" });
    const now = res.data.persons.find((p) => p.id === "p_1")!;
    expect(res.rootId).toBe("p_1");
    expect(now.givenNames).toBe(old.givenNames);
    expect(now.birth).toEqual(old.birth);
    expect(now.status).toBe(old.status);
    expect(now.externalRefs).toContainEqual({ system: "wikitree", id: "Neu-1" });
    expect(now.notes!.at(-1)).toContain("vermutet");
    expect(res.addedPersons).toBe(2); // Frau und Sohn
    expect(res.data.persons).toHaveLength(before.persons.length + 2);
    expect(new FamilyGraph(res.data).validate()).toEqual([]);
  });

  it("ergänzt Kinder in einer vorhandenen Union mit denselben Partnern und achtet auf die Invariante", () => {
    const b = batch();
    const mk = adoptBatch(base(), b, { includeRelatives: true });
    // zweiter Treffer: weiteres Kind derselben Eltern
    const b2 = batch();
    b2.people.push({ ref: { system: "wikitree", id: "Neu-4" }, url: "https://www.wikitree.com/wiki/Neu-4", givenNames: "Fritz", surname: "Neu", sex: "M" });
    b2.unions[0]!.children.push({ system: "wikitree", id: "Neu-4" });
    const res = adoptBatch(mk.data, b2);
    expect(res).toMatchObject({ addedPersons: 1, addedUnions: 0 });
    expect(res.data.unions.at(-1)!.children).toHaveLength(2);
    // Kind mit biologischen Eltern im Baum wird nicht in eine zweite Union gelegt
    const clash = batch();
    clash.unions.push({ partners: [{ system: "wikitree", id: "Neu-1" }], children: [{ system: "wikitree", id: "Neu-3" }] });
    const r3 = adoptBatch(base(), clash);
    expect(r3.notes.some((n) => n.includes("andere Eltern"))).toBe(true);
    expect(new FamilyGraph(r3.data).validate()).toEqual([]);
  });

  it("meldet ähnliche vorhandene Personen nur als Hinweis", () => {
    const b = batch();
    const root = b.people[0]!;
    Object.assign(root, { givenNames: "Johann", surname: "Beispiel", birth: { date: { kind: "exact", year: 1800 } } });
    const res = adoptBatch(base(), b);
    expect(res.possibleDuplicates).toEqual([{ newId: res.rootId, existingId: "p_1" }]);
    // nichts verschmolzen: die vorhandene Person ist unverändert, die neue steht daneben
    expect(res.data.persons.filter((p) => p.surname === "Beispiel" && p.birth?.date?.year === 1800)).toHaveLength(2);
  });

  it("wirft bei unbekanntem linkTo", () => {
    expect(() => adoptBatch(base(), batch(), { linkTo: "p_999" })).toThrow();
  });
});

describe("TreeStore.replaceTree", () => {
  it("ersetzt den Inhalt, behält Name und ID", async () => {
    const store = await TreeStore.open("replace-test");
    const meta = await store.saveTree("Test", base());
    const grown = adoptBatch(base(), batch()).data;
    const next = await store.replaceTree(meta.id, grown);
    expect(next).toMatchObject({ id: meta.id, name: "Test", personCount: grown.persons.length });
    expect(next.createdAt).toBe(meta.createdAt);
    const loaded = await store.loadTree(meta.id);
    expect(loaded.persons).toHaveLength(grown.persons.length);
    expect(loaded.unions).toHaveLength(grown.unions.length);
    expect((await store.listTrees()).length).toBe(1);
    await expect(store.replaceTree("t_gibtesnicht", grown)).rejects.toThrow();
    store.close();
  });
});
