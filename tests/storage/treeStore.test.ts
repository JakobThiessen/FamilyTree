// fake-indexeddb ersetzt die Browser-IndexedDB durch eine In-Memory-Version (siehe DECISIONS.md D13).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyEdit, changesFromTouched, parseTreeJson, type EditOp, type Person, type TreeData, type Union } from "../../src/core";
import { importFileContent, parseBackup, serializeBackup } from "../../src/import";
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

describe("Backup und Restore", () => {
  it("sichert alle Bäume und spielt sie zusätzlich wieder ein", async () => {
    const a = await store.saveTree("Familie A", json("multiple-marriages.json"));
    await store.saveTree("Familie B", chain(5));
    const text = serializeBackup(await store.exportAll());

    const restored = await store.restoreAll(parseBackup(text));
    expect(restored).toHaveLength(2);
    const all = await store.listTrees();
    expect(all).toHaveLength(4); // nichts überschrieben, nichts gelöscht
    const copy = restored.find((m) => m.name === "Familie A")!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.createdAt).toBe(a.createdAt);
    expect(sorted((await store.loadTree(copy.id)).persons)).toEqual(sorted((await store.loadTree(a.id)).persons));
  });

  it("lehnt fremde und kaputte Dateien ab", () => {
    expect(() => parseBackup("kein json")).toThrow();
    expect(() => parseBackup('{"format":"anderes"}')).toThrow(/Backup/);
    expect(() => parseBackup('{"format":"familytree-backup","version":1,"trees":[{"name":"x","data":{}}]}')).toThrow();
  });
});

describe("Gezieltes Schreiben (applyChanges, M10, D38)", () => {
  /** Gleiche Operationen im Speicher und in der Datenbank; danach müssen beide Stände übereinstimmen. */
  async function run(treeId: string, data: TreeData, ops: EditOp[]): Promise<TreeData> {
    let d = data;
    for (const op of ops) {
      const r = applyEdit(d, op);
      if (!r.ok) throw new Error(r.reject.code);
      d = r.data;
      await store.applyChanges(treeId, changesFromTouched(d, r.touched));
    }
    return d;
  }

  const ops: EditOp[] = [
    { type: "addPerson", person: { givenNames: "Neu", surname: "Test", sex: "F" } }, // p_<n>
    { type: "addSource", source: { title: "Neue Quelle" } },
    { type: "deletePerson", id: "p_3" },
    { type: "updatePerson", person: { id: "p_2", givenNames: "Geändert", sex: "M" } },
  ];

  it("loadTree entspricht dem Stand von applyEdit im Speicher, Zähler stimmen", async () => {
    const data = chain(5);
    const meta = await store.saveTree("Kette", data);
    const n = data.persons.length;
    const added = `p_${n}`; // chain vergibt p_0..p_5, q_0..q_4: nächste freie p-Nummer ist p_6
    void added;
    const mem = await run(meta.id, data, [
      ...ops,
      { type: "linkChild", unionId: "u_0", personId: "q_4", kind: "adopted" },
      { type: "addUnion", union: { partnerIds: ["p_2"], kind: "partnership", children: [] } },
    ]);
    const loaded = await store.loadTree(meta.id);
    expect(sorted(loaded.persons)).toEqual(sorted(mem.persons));
    expect(sorted(loaded.unions)).toEqual(sorted(mem.unions));
    expect(sorted(loaded.sources)).toEqual(sorted(mem.sources));
    const m = await store.getTree(meta.id);
    expect([m?.personCount, m?.unionCount, m?.sourceCount]).toEqual([mem.persons.length, mem.unions.length, mem.sources.length]);
    expect(m!.updatedAt).toBeGreaterThanOrEqual(meta.updatedAt);
  });

  it("loadUnionsOf und loadNeighborhood stimmen nach Änderungen (Hilfsfelder neu gebildet)", async () => {
    const data = chain(4);
    const meta = await store.saveTree("Kette", data);
    // p_1 wechselt: wird aus u_1 (Kind) gelöst und Kind von u_3; Partner q_0 wird aus u_0 entfernt
    const mem = await run(meta.id, data, [
      { type: "unlinkChild", unionId: "u_0", personId: "p_0" },
      { type: "linkChild", unionId: "u_3", personId: "p_0", kind: "adopted" },
      { type: "deletePerson", id: "q_0" },
    ]);
    const g = (id: string) => mem.unions.filter((u) => u.partnerIds.includes(id) || u.children.some((c) => c.personId === id));
    for (const id of ["p_0", "p_1", "p_3", "p_4", "q_0", "q_3"]) {
      const got = await store.loadUnionsOf(meta.id, id);
      expect(sorted(got)).toEqual(sorted(g(id)));
    }
    const nb = await store.loadNeighborhood(meta.id, "p_0", { up: 2, down: 0 });
    expect(nb.unions.map((u) => u.id)).toContain("u_3"); // neuer Elternweg von p_0
    expect(nb.persons.some((p) => p.id === "q_0")).toBe(false);
  });

  it("unbekannter Baum: TreeNotFoundError; Löschen mit unbekannter ID ändert Zähler nicht", async () => {
    await expect(store.applyChanges("t_gibtsnicht", { putPersons: [] })).rejects.toBeInstanceOf(TreeNotFoundError);
    const meta = await store.saveTree("K", chain(2));
    const after = await store.applyChanges(meta.id, { deletePersons: ["p_99"], deleteUnions: ["u_99"], putPersons: [{ id: "p_0", sex: "U" }] });
    expect(after.personCount).toBe(meta.personCount);
    expect(after.unionCount).toBe(meta.unionCount);
  });

  it("Rollback: bei einem Fehler bleibt alles beim alten Stand", async () => {
    const data = chain(3);
    const meta = await store.saveTree("K", data);
    // Eine Funktion im Datensatz lässt IndexedDB beim Klonen scheitern; davor stehende Schreibaufträge müssen zurückgerollt werden.
    const bad = { id: "p_bad", sex: "U", notes: [(() => 1) as unknown as string] } as Person;
    await expect(
      store.applyChanges(meta.id, {
        deletePersons: ["p_0"],
        putPersons: [{ id: "p_1", givenNames: "Nope", sex: "F" }, bad],
        putUnions: [{ id: "u_new", partnerIds: ["p_1"], kind: "unknown", children: [] }],
      }),
    ).rejects.toBeDefined();
    const loaded = await store.loadTree(meta.id);
    expect(sorted(loaded.persons)).toEqual(sorted(data.persons));
    expect(sorted(loaded.unions)).toEqual(sorted(data.unions));
    const m = await store.getTree(meta.id);
    expect(m).toEqual(meta);
    // Die Datenbank bleibt benutzbar.
    await store.applyChanges(meta.id, { putPersons: [{ id: "p_x", sex: "U" }] });
    expect((await store.getTree(meta.id))?.personCount).toBe(meta.personCount + 1);
  });

  it("Undo über inverse schreibt den Ausgangszustand zurück", async () => {
    const data = chain(3);
    const meta = await store.saveTree("K", data);
    const r = applyEdit(data, { type: "deletePerson", id: "p_2" });
    if (!r.ok) throw new Error("abgelehnt");
    await store.applyChanges(meta.id, changesFromTouched(r.data, r.touched));
    const back = applyEdit(r.data, r.inverse);
    if (!back.ok) throw new Error("abgelehnt");
    await store.applyChanges(meta.id, changesFromTouched(back.data, back.touched));
    const loaded = await store.loadTree(meta.id);
    expect(sorted(loaded.persons)).toEqual(sorted(data.persons));
    expect(sorted(loaded.unions)).toEqual(sorted(data.unions));
    expect((await store.getTree(meta.id))?.personCount).toBe(data.persons.length);
  });
});

describe("Medien (D45)", () => {
  const rec = (file: string) => ({ file, thumb: new Blob([file]), width: 10, height: 20, origWidth: 100, origHeight: 200 });

  it("speichert und lädt Vorschauen je Baum und löscht sie mit dem Baum", async () => {
    const a = await store.saveTree("A", chain(1));
    const b = await store.saveTree("B", chain(1));
    await store.saveMedia(a.id, [rec("Fotos/1.jpg"), rec("Fotos/2.jpg")]);
    await store.saveMedia(b.id, [rec("Fotos/1.jpg")]);
    expect(await store.countMedia(a.id)).toBe(2);
    expect((await store.loadMedia(a.id, "Fotos/2.jpg"))?.origHeight).toBe(200);
    expect(await store.loadMedia(b.id, "Fotos/2.jpg")).toBeUndefined();
    await store.deleteTree(a.id);
    expect(await store.countMedia(a.id)).toBe(0);
    expect(await store.countMedia(b.id)).toBe(1);
  });

  it("Backup enthält nur Verweise, keine Bilder", async () => {
    const data = chain(1);
    data.persons[0]!.media = [{ file: "Fotos/1.jpg", primary: true }];
    const meta = await store.saveTree("A", data);
    await store.saveMedia(meta.id, [rec("Fotos/1.jpg")]);
    const text = serializeBackup(await store.exportAll());
    expect(text).toContain("Fotos/1.jpg");
    expect(text.length).toBeLessThan(2000);
    expect(parseBackup(text)[0]!.data.persons[0]!.media).toEqual([{ file: "Fotos/1.jpg", primary: true }]);
  });
});
