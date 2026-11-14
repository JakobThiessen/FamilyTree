import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadGraph, FamilyGraph, buildAhnentafel, pedigreeReport, fatherAndMother } from "../../src/core";
import type { Person, Sex, Union } from "../../src/core";

const load = (file: string) => loadGraph(readFileSync(`example/json/${file}`, "utf8"));

/** Kurzschreibweise wie in kinship.test.ts: Personen "id:M|F", Unions "a+b > kind1, kind2" (erfundene Personen). */
function build(persons: string[], unions: string[]): FamilyGraph {
  const ps: Person[] = persons.map((s) => {
    const [id, sex] = s.split(":");
    return { id: id as string, sex: (sex ?? "U") as Sex, givenNames: id as string };
  });
  const us: Union[] = unions.map((s, i) => {
    const [partners, kids] = s.split(">").map((x) => x.trim());
    return {
      id: `u_${i + 1}`,
      partnerIds: (partners as string).split("+").map((x) => x.trim()).filter(Boolean),
      kind: "marriage",
      children: (kids ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((personId) => ({ personId, kind: "biological" })),
    } as Union;
  });
  return new FamilyGraph({ persons: ps, unions: us } as never);
}

describe("Ahnentafel", () => {
  it("nummeriert Vater 2n, Mutter 2n+1, auch wenn die Partner anders gelistet sind", () => {
    const g = build(["k:M", "m:F", "v:M", "mv:M", "mm:F"], ["m+v > k", "mv+mm > m"]); // Mutter zuerst
    const t = buildAhnentafel(g, "k");
    const sosa = Object.fromEntries(t.generations.flatMap((x) => x.rows).map((r) => [r.personId, r.sosa]));
    expect(sosa).toEqual({ k: 1, v: 2, m: 3, mv: 6, mm: 7 });
    expect(t.generations.map((x) => [x.slots, x.known])).toEqual([[1, 1], [2, 2], [4, 2]]);
  });

  it("Cousinenheirat: Ahnen mehrfach, Eltern nur bei der ersten Nennung", () => {
    const g = load("cousin-marriage.json");
    const t = buildAhnentafel(g, "p_9");
    const rows = t.generations.flatMap((x) => x.rows);
    expect(rows.find((r) => r.sosa === 8)?.personId).toBe("p_1");
    const dups = rows.filter((r) => r.duplicateOf !== undefined);
    expect(dups.map((r) => [r.personId, r.sosa, r.duplicateOf]).sort()).toEqual([["p_1", 14, 8], ["p_2", 15, 9]].sort());
    expect(t.rowCount).toBe(rows.length);
    expect(t.truncated).toBe(false);
  });

  it("begrenzt Tiefe und Zeilen", () => {
    const g = load("cousin-marriage.json");
    expect(buildAhnentafel(g, "p_9", { maxDepth: 1 }).generations).toHaveLength(2);
    const t = buildAhnentafel(g, "p_9", { maxRows: 3 });
    expect(t.truncated).toBe(true);
    expect(t.rowCount).toBe(3);
  });

  it("unbekannte Person und Person ohne Eltern", () => {
    const g = load("cousin-marriage.json");
    expect(buildAhnentafel(g, "nope").generations).toEqual([]);
    expect(buildAhnentafel(g, "p_1").generations).toHaveLength(1);
    expect(fatherAndMother(g, "p_1")).toEqual([undefined, undefined]);
  });

  it("Bericht: Ahnenschwund und Inzuchtkoeffizient 1/16", () => {
    const r = pedigreeReport(load("cousin-marriage.json"), "p_9");
    expect(r.collapse.repeated.map((x) => x.id).sort()).toEqual(["p_1", "p_2"]);
    expect(r.inbreeding).toBeCloseTo(1 / 16);
  });
});
