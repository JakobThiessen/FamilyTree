// fake-indexeddb ersetzt die Browser-IndexedDB durch eine In-Memory-Version (siehe DECISIONS.md D13).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseTreeJson, type Person, type TreeData, type Union } from "../../src/core";
import { importFileContent } from "../../src/import";
import { TreeNotFoundError, TreeStore } from "../../src/storage";

const json = (f: string): TreeData => parseTreeJson(readFileSync(`example/json/${f}`, "utf8"));
const sorted = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

/** Erfundene Ahnenreihe: n Generationen, jede Person hat genau ein Kind (g0 ist die jüngste). */
function chain(n: number): TreeData {
  const persons: Person[] = [];
  const unions: Union[] = [];
  for (let g = 0; g <= n; g++) persons.push({ id: `p_${g}`, givenNames: `Test${g}`, sex: g % 2 ? "F" : "M" });
  // Union u_g: Eltern p_(g+1) (und Partner q_g) haben das Kind p_g.
  for (let g = 0; g < n; g++) {
    persons.push({ id: `q_${g}`, givenNames: `Partner${g}`, sex: "U" });
    unions.push({
      id: `u_${g}`,
      partnerIds: [`p_${g + 1}`, `q_${g}`],
      kind: "marriage",
      children: [{ personId: `p_${g}`, kind: "biological" }],
    });
  }
  return { version: 1, persons, unions, sources: [{ id: "s_1", title: "Testquelle" }] };
}

let store: TreeStore;
let n = 0;

beforeEach(async () => {
  // Jede Testfunktion bekommt eine frische, leere Datenbank.
  store = await TreeStore.open(`test-db-${++n}`);
});
afterEach(() => store.close());

describe("Verwaltung mehrerer Bäume", () => {
  it("legt Bäume an und listet sie mit Zählern", async () => {
    const a = await store.saveTree("Familie A", json("multiple-marriages.json"));
    const b = await store.createTree("Leer");
    const list = await store.listTrees();
    expect(list.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(a.personCount).toBe(json("multiple-marriages.json").persons.length);
    expect(b.personCount).toBe(0);
  });

  it("benennt um und behält bei leerem Namen den alten", async () => {
    const t = await store.createTree("Alt");
    expect((await store.renameTree(t.id, "  Neu  ")).name).toBe("Neu");
    expect((await store.renameTree(t.id, "   ")).name).toBe("Neu");
    expect((await store.getTree(t.id))?.name).toBe("Neu");
  });

  it("Umbenennen und Laden eines unbekannten Baums wirft TreeNotFoundError", async () => {
    await expect(store.renameTree("t_gibtsnicht", "x")).rejects.toBeInstanceOf(TreeNotFoundError);
    await expect(store.loadTree("t_gibtsnicht")).rejects.toBeInstanceOf(TreeNotFoundError);
  });

  it("löscht nur den gewählten Baum samt Inhalt", async () => {
    const a = await store.saveTree("A", json("multiple-marriages.json"));
    const b = await store.saveTree("B", json("cousin-marriage.json"));
    await store.deleteTree(a.id);
    expect((await store.listTrees()).map((t) => t.id)).toEqual([b.id]);
    // Der andere Baum ist unversehrt, der gelöschte ist komplett leer.
    expect((await store.loadTree(b.id)).persons).toHaveLength(json("cousin-marriage.json").persons.length);
    const firstId = json("multiple-marriages.json").persons[0]!.id;
    expect(await store.loadPersons(a.id, [firstId])).toEqual([]);
    expect(await store.loadUnionsOf(a.id, firstId)).toEqual([]);
  });

  it("gleiche Personen-IDs in zwei Bäumen kommen sich nicht in die Quere", async () => {
    const data = json("multiple-marriages.json");
    const a = await store.saveTree("A", data);
    const b = await store.saveTree("B", data);
    await store.deleteTree(a.id);
    const back = await store.loadTree(b.id);
    expect(sorted(back.persons)).toEqual(sorted(data.persons));
    expect(sorted(back.unions)).toEqual(sorted(data.unions));
  });
});

describe("Persistenz und Round-Trip", () => {
  it.each(["multiple-marriages.json", "cousin-marriage.json"])("JSON-Beispiel %s kommt unverändert zurück", async (f) => {
    const data = json(f);
    const t = await store.saveTree(f, data);
    const back = await store.loadTree(t.id);
    expect(sorted(back.persons)).toEqual(sorted(data.persons));
    expect(sorted(back.unions)).toEqual(sorted(data.unions));
    expect(back.sources).toEqual(data.sources);
  });

  it("speichert das Importergebnis einer GEDCOM-Datei", async () => {
    const bytes = readFileSync("example/gedcom/cousin-marriage.ged");
    const { data } = importFileContent("cousin-marriage.ged", new Uint8Array(bytes));
    const t = await store.saveTree("Aus GEDCOM", data);
    const back = await store.loadTree(t.id);
    expect(sorted(back.persons)).toEqual(sorted(data.persons));
    expect(sorted(back.unions)).toEqual(sorted(data.unions));
  });

  it("überlebt Schließen und erneutes Öffnen", async () => {
    const dbName = `persist-${++n}`;
    const s1 = await TreeStore.open(dbName);
    const t = await s1.saveTree("Bleibt", chain(2));
    s1.close();
    const s2 = await TreeStore.open(dbName);
    expect((await s2.listTrees()).map((x) => x.id)).toEqual([t.id]);
    s2.close();
    store = await TreeStore.open(dbName); // für afterEach
  });

  it("bricht bei fehlerhaften Daten ab und hinterlässt nichts Halbes", async () => {
    const bad = chain(2);
    // Eine Funktion lässt sich nicht in IndexedDB speichern (DataCloneError) -> Transaktion bricht ab.
    (bad.persons[1] as unknown as Record<string, unknown>).oops = () => 1;
    await expect(store.saveTree("Kaputt", bad)).rejects.toThrow();
    expect(await store.listTrees()).toEqual([]);
  });
});

describe("Laden nach Bedarf", () => {
  it("loadPersons liefert nur die gewünschten Personen", async () => {
    const t = await store.saveTree("Kette", chain(5));
    const got = await store.loadPersons(t.id, ["p_1", "p_3", "p_1", "p_unbekannt"]);
    expect(got.map((p) => p.id).sort()).toEqual(["p_1", "p_3"]);
  });

  it("loadUnionsOf findet Unions als Partner und als Kind", async () => {
    const t = await store.saveTree("Kette", chain(5));
    const ids = (await store.loadUnionsOf(t.id, "p_2")).map((u) => u.id).sort();
    expect(ids).toEqual(["u_1", "u_2"]); // u_1: p_2 ist Partner; u_2: p_2 ist Kind
  });

  it("loadNeighborhood lädt nur die verlangte Tiefe nach oben", async () => {
    const t = await store.saveTree("Kette", chain(10));
    const view = await store.loadNeighborhood(t.id, "p_0", { up: 2, down: 0 });
    expect(view.unions.map((u) => u.id).sort()).toEqual(["u_0", "u_1"]);
    // Fokus, 2 Elternpaare und die Kinder der Unions (p_0, p_1) -> p_0, p_1, p_2, q_0, q_1
    expect(view.persons.map((p) => p.id).sort()).toEqual(["p_0", "p_1", "p_2", "q_0", "q_1"]);
    expect(view.persons.length).toBeLessThan(chain(10).persons.length);
  });

  it("loadNeighborhood lädt nach unten und beide Richtungen zugleich", async () => {
    const t = await store.saveTree("Kette", chain(10));
    const down = await store.loadNeighborhood(t.id, "p_5", { up: 0, down: 2 });
    expect(down.unions.map((u) => u.id).sort()).toEqual(["u_3", "u_4"]);
    const both = await store.loadNeighborhood(t.id, "p_5", { up: 1, down: 1 });
    expect(both.unions.map((u) => u.id).sort()).toEqual(["u_4", "u_5"]);
  });

  it("loadNeighborhood mit Tiefe 0 liefert nur den Fokus", async () => {
    const t = await store.saveTree("Kette", chain(3));
    const view = await store.loadNeighborhood(t.id, "p_1", { up: 0, down: 0 });
    expect(view.persons.map((p) => p.id)).toEqual(["p_1"]);
    expect(view.unions).toEqual([]);
  });

  it("Cousinenheirat: doppelter Ahn wird nur einmal geladen", async () => {
    const data = json("cousin-marriage.json");
    const t = await store.saveTree("Cousins", data);
    // Kind mit zwei Wegen zum gemeinsamen Ahn: das Kind mit den meisten Vorfahren wählen.
    const view = await store.loadNeighborhood(t.id, data.persons[0]!.id, { up: 10, down: 0 });
    const ids = view.persons.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(view.unions.map((u) => u.id)).size).toBe(view.unions.length);
  });

  it("lädt zitierte Quellen mit", async () => {
    const data = chain(2);
    data.persons[0]!.birth = { citations: [{ sourceId: "s_1" }] };
    const t = await store.saveTree("Mit Quelle", data);
    const view = await store.loadNeighborhood(t.id, "p_0", { up: 1, down: 0 });
    expect(view.sources.map((s) => s.id)).toEqual(["s_1"]);
  });
});
