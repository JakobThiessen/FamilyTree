import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FamilyGraph, loadGraph, parseTreeData, parseTreeJson, TreeFormatError } from "../../src/core";
import type { Person, Union } from "../../src/core";

const load = (file: string) => loadGraph(readFileSync(`example/json/${file}`, "utf8"));

describe("drei Ehen nacheinander (multiple-marriages.json)", () => {
  const g = load("multiple-marriages.json");

  it("ist gültig", () => {
    expect(g.validate()).toEqual([]);
    expect(g.personCount).toBe(10);
    expect(g.unionCount).toBe(3);
  });

  it("liefert Partner in Ehe-Reihenfolge", () => {
    expect(g.partners("p_1")).toEqual(["p_2", "p_3", "p_4"]);
    expect(g.unionsOf("p_1").map((u) => u.id)).toEqual(["u_1", "u_2", "u_3"]);
    expect(g.partners("p_3")).toEqual(["p_1"]);
  });

  it("liefert Kinder und Eltern", () => {
    expect(g.children("p_1")).toEqual(["p_5", "p_6", "p_7", "p_8", "p_9", "p_10"]);
    expect(g.children("p_2")).toEqual(["p_5", "p_6"]);
    expect(g.parents("p_7").sort()).toEqual(["p_1", "p_3"]);
  });

  it("trennt volle und Halbgeschwister", () => {
    const s = g.siblings("p_5");
    expect(s.full).toEqual(["p_6"]);
    expect(s.half.sort()).toEqual(["p_10", "p_7", "p_8", "p_9"]);
    expect(g.siblings("p_9").full).toEqual(["p_10"]);
    expect(g.siblings("p_9").half.sort()).toEqual(["p_5", "p_6", "p_7", "p_8"]);
  });

  it("findet Stiefeltern und Stiefkinder", () => {
    // Kind aus Ehe 1: Stiefmütter sind Frau 2 und Frau 3
    expect(g.stepParents("p_5").sort()).toEqual(["p_3", "p_4"]);
    // Kind aus Ehe 3: Frau 1 und 2 sind nur "frühere Partnerinnen" des Vaters, also Stiefmütter im weiten Sinn
    expect(g.stepParents("p_9").sort()).toEqual(["p_2", "p_3"]);
    // Frau 2 hat die Kinder aus Ehe 1 und 3 als Stiefkinder, nicht ihre eigenen
    expect(g.stepChildren("p_3")).toEqual(["p_5", "p_6", "p_9", "p_10"]);
    expect(g.stepChildren("p_1")).toEqual([]);
    expect(g.stepParents("p_1")).toEqual([]);
  });

  it("kennt den Status einer unsicheren Verknüpfung", () => {
    const links = g.parentLinks("p_10");
    expect(links).toHaveLength(1);
    expect(links[0]?.link.status).toBe("assumed");
  });
});

describe("Heirat unter Cousins (cousin-marriage.json)", () => {
  const g = load("cousin-marriage.json");

  it("ist gültig, Person nur einmal", () => {
    expect(g.validate()).toEqual([]);
    expect(g.personCount).toBe(9);
    expect([...g.persons()].filter((p) => p.givenNames === "Georg")).toHaveLength(1);
  });

  it("Konrad und Agnes sind Partner, ihre Eltern Geschwister", () => {
    expect(g.partners("p_7")).toEqual(["p_8"]);
    expect(g.siblings("p_3").full).toEqual(["p_5"]);
    // Konrad und Agnes sind keine Geschwister
    expect(g.siblings("p_7").full).toEqual([]);
    expect(g.siblings("p_7").half).toEqual([]);
  });

  it("zwei Wege führen zum selben Großelternpaar, ohne dass Georg kopiert wird", () => {
    // Weg über den Vater von Konrad: Konrad -> Peter -> Georg
    const viaKonrad = g.parents("p_7").flatMap((p) => g.parents(p));
    // Weg über die Mutter von Agnes: Agnes -> Christine -> Georg
    const viaAgnes = g.parents("p_8").flatMap((p) => g.parents(p));
    const common = viaKonrad.filter((id) => viaAgnes.includes(id)).sort();
    expect(common).toEqual(["p_1", "p_2"]);
    // Ludwig, das gemeinsame Kind, hat über beide Eltern denselben Ahn
    expect(g.parents("p_9").sort()).toEqual(["p_7", "p_8"]);
  });

  it("Konrad hat keine Stiefeltern durch die Cousinenheirat", () => {
    expect(g.stepParents("p_7")).toEqual([]);
    expect(g.stepParents("p_8")).toEqual([]);
  });
});

describe("Validierung", () => {
  const person = (id: string): Person => ({ id, sex: "U" });
  const union = (id: string, partnerIds: string[], children: string[]): Union => ({
    id,
    partnerIds,
    kind: "marriage",
    children: children.map((personId) => ({ personId, kind: "biological" as const })),
  });

  it("erkennt einen Zyklus (Großvater wäre sein eigener Enkel)", () => {
    const g = new FamilyGraph({
      persons: [person("a"), person("b"), person("c")],
      unions: [union("u1", ["a"], ["b"]), union("u2", ["b"], ["c"]), union("u3", ["c"], ["a"])],
    });
    const issues = g.validate().filter((i) => i.code === "parent-cycle");
    expect(issues).toHaveLength(1);
    expect(new Set(issues[0]?.ids)).toEqual(new Set(["a", "b", "c"]));
  });

  it("erkennt, wenn jemand sein eigener Elternteil ist", () => {
    const g = new FamilyGraph({ persons: [person("a")], unions: [union("u1", ["a"], ["a"])] });
    expect(g.validate().map((i) => i.code)).toContain("parent-cycle");
  });

  it("meldet keinen Zyklus bei Ahnenschwund (Raute)", () => {
    const g = new FamilyGraph({
      persons: ["a", "b", "c", "d"].map(person),
      unions: [union("u1", ["a"], ["b", "c"]), union("u2", ["b", "c"], ["d"])],
    });
    expect(g.validate()).toEqual([]);
  });

  it("erkennt hängende Verweise", () => {
    const g = new FamilyGraph({ persons: [person("a")], unions: [union("u1", ["a", "x"], ["y"])] });
    const codes = g.validate().map((i) => i.code);
    expect(codes).toContain("dangling-partner");
    expect(codes).toContain("dangling-child");
    // hängende Verweise tauchen in Abfragen nicht auf
    expect(g.partners("a")).toEqual([]);
    expect(g.children("a")).toEqual([]);
  });

  it("erkennt doppelte IDs, die erste gilt", () => {
    const g = new FamilyGraph({
      persons: [{ id: "a", sex: "M", givenNames: "Erster" }, { id: "a", sex: "F", givenNames: "Zweiter" }],
      unions: [],
    });
    expect(g.validate().map((i) => i.code)).toEqual(["duplicate-person"]);
    expect(g.getPerson("a")?.givenNames).toBe("Erster");
    expect(g.personCount).toBe(1);
  });

  it("erkennt zwei biologische Unions, erlaubt aber zusätzliche Adoption", () => {
    const persons = ["m1", "f1", "m2", "f2", "k"].map(person);
    const bio2 = new FamilyGraph({
      persons,
      unions: [union("u1", ["m1", "f1"], ["k"]), union("u2", ["m2", "f2"], ["k"])],
    });
    expect(bio2.validate().map((i) => i.code)).toEqual(["multiple-biological-unions"]);

    const adopted: Union = { ...union("u2", ["m2", "f2"], []), children: [{ personId: "k", kind: "adopted" }] };
    const ok = new FamilyGraph({ persons, unions: [union("u1", ["m1", "f1"], ["k"]), adopted] });
    expect(ok.validate()).toEqual([]);
    expect(ok.parents("k", { biologicalOnly: true }).sort()).toEqual(["f1", "m1"]);
    expect(ok.parents("k")).toHaveLength(4);
  });

  it("erkennt mehr als zwei Partner und doppelte Partner/Kinder", () => {
    const g = new FamilyGraph({
      persons: ["a", "b", "c", "k"].map(person),
      unions: [
        union("u1", ["a", "b", "c"], []),
        union("u2", ["a", "a"], ["k", "k"]),
      ],
    });
    const codes = g.validate().map((i) => i.code);
    expect(codes).toContain("too-many-partners");
    expect(codes).toContain("duplicate-partner");
    expect(codes).toContain("duplicate-child-link");
  });

  it("verkraftet eine sehr tiefe Ahnenreihe ohne Stack-Überlauf", () => {
    const n = 20000;
    const persons = Array.from({ length: n }, (_, i) => person(`p${i}`));
    const unions = Array.from({ length: n - 1 }, (_, i) => union(`u${i}`, [`p${i}`], [`p${i + 1}`]));
    expect(new FamilyGraph({ persons, unions }).validate()).toEqual([]);
  });
});

describe("Laden", () => {
  it("lehnt falsche Form mit verständlicher Meldung ab", () => {
    expect(() => parseTreeJson("{kaputt")).toThrow(TreeFormatError);
    expect(() => parseTreeData({ version: 2, persons: [], unions: [] })).toThrow(/Version/);
    expect(() => parseTreeData({ version: 1, persons: [{ id: "a", sex: "X" }], unions: [] })).toThrow(/sex/);
    expect(() => parseTreeData({ version: 1, persons: [], unions: [{ id: "u", partnerIds: [] }] })).toThrow(/children/);
  });

  it("ergänzt fehlende sources", () => {
    expect(parseTreeData({ version: 1, persons: [], unions: [] }).sources).toEqual([]);
  });
});
