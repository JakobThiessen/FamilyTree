import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FamilyGraph,
  loadGraph,
  ancestorLevels,
  descendantLevels,
  ancestorProfile,
  pedigreeCollapse,
  hasPedigreeCollapse,
  findCommonAncestors,
  describeRelationship,
  bloodRelationLabel,
  KinshipCalculator,
  inbreedingCoefficient,
} from "../../src/core";
import type { Person, Sex, Union } from "../../src/core";
import { importGedcom } from "../../src/import";

const load = (file: string) => loadGraph(readFileSync(`example/json/${file}`, "utf8"));

/**
 * Baut einen kleinen Graphen in Kurzschreibweise (erfundene Personen):
 * Personen "id:M|F" und Unions "partner1+partner2 > kind1, kind2" (Union-IDs u_1, u_2, …).
 */
function build(persons: string[], unions: string[]): FamilyGraph {
  const ps: Person[] = persons.map((s) => {
    const [id, sex] = s.split(":");
    return { id: id as string, sex: (sex ?? "U") as Sex, givenNames: id as string };
  });
  const us: Union[] = unions.map((s, i) => {
    const [partners, kids] = s.split(">").map((x) => x.trim());
    return {
      id: `u_${i + 1}`,
      partnerIds: (partners as string)
        .split("+")
        .map((x) => x.trim())
        .filter(Boolean),
      kind: "marriage",
      children: (kids ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((personId) => ({ personId, kind: "biological" as const })),
    };
  });
  return new FamilyGraph({ persons: ps, unions: us });
}

describe("Vorfahren und Nachfahren je Tiefe", () => {
  const g = load("cousin-marriage.json");

  it("liefert Vorfahren je Tiefe, Ahnen nur in der kürzesten Schicht", () => {
    const levels = ancestorLevels(g, "p_9").map((l) => [...l].sort());
    expect(levels).toEqual([["p_9"], ["p_7", "p_8"], ["p_3", "p_4", "p_5", "p_6"], ["p_1", "p_2"]]);
  });

  it("begrenzt mit maxDepth", () => {
    expect(ancestorLevels(g, "p_9", { maxDepth: 1 })).toHaveLength(2);
    expect(ancestorLevels(g, "p_9", { maxDepth: 0 })).toEqual([["p_9"]]);
  });

  it("liefert Nachfahren je Tiefe", () => {
    const levels = descendantLevels(g, "p_1").map((l) => [...l].sort());
    expect(levels).toEqual([["p_1"], ["p_3", "p_5"], ["p_7", "p_8"], ["p_9"]]);
  });

  it("kennt keine unbekannte Person", () => {
    expect(ancestorLevels(g, "p_x")).toEqual([]);
    expect(descendantLevels(g, "p_x")).toEqual([]);
  });

  it("zählt Wege je Tiefe", () => {
    const profile = ancestorProfile(g, "p_9");
    expect(profile.get("p_1")).toEqual(new Map([[3, 2]]));
    expect(profile.get("p_4")).toEqual(new Map([[2, 1]]));
  });

  it("terminiert auch bei Zyklen (kaputte Daten)", () => {
    const cyc = build(["a:M", "b:M"], ["a > b", "b > a"]);
    expect(ancestorLevels(cyc, "a").length).toBeLessThanOrEqual(cyc.personCount + 1);
    expect(findCommonAncestors(cyc, "a", "b").length).toBeGreaterThan(0);
  });
});

describe("Ahnenschwund", () => {
  const g = load("cousin-marriage.json");

  it("erkennt die doppelten Großeltern bei Cousinenheirat", () => {
    const c = pedigreeCollapse(g, "p_9");
    expect(c.repeated).toEqual([
      { id: "p_1", pathCount: 2, depths: [3] },
      { id: "p_2", pathCount: 2, depths: [3] },
    ]);
    expect(c.generations).toEqual([
      { depth: 1, paths: 2, distinct: 2 },
      { depth: 2, paths: 4, distinct: 4 },
      { depth: 3, paths: 4, distinct: 2 },
    ]);
    // 8 verschiedene Ahnen auf 10 belegten Plätzen
    expect(c.implex).toBeCloseTo(0.2);
    expect(hasPedigreeCollapse(g, "p_9")).toBe(true);
  });

  it("meldet nichts ohne Schleife", () => {
    expect(hasPedigreeCollapse(g, "p_7")).toBe(false);
    expect(pedigreeCollapse(g, "p_1")).toEqual({ repeated: [], generations: [], implex: 0 });
  });

  it("erkennt einen Ahn auf Wegen verschiedener Tiefe", () => {
    // z ist Vater von x; y ist Tochter von x; k ist Kind von x und y
    const h = build(["z:M", "x:M", "y:F", "k:M"], ["z > x", "x > y", "x+y > k"]);
    const z = pedigreeCollapse(h, "k").repeated.find((r) => r.id === "z");
    expect(z?.depths).toEqual([2, 3]);
    expect(z?.pathCount).toBe(2);
  });
});

describe("gemeinsame Vorfahren (bidirektionale Suche)", () => {
  it("findet bei Cousins beide Großeltern", () => {
    const g = load("cousin-marriage.json");
    const common = findCommonAncestors(g, "p_7", "p_8");
    expect(common.map((c) => [c.id, c.distA, c.distB, c.lowest])).toEqual([
      ["p_1", 2, 2, true],
      ["p_2", 2, 2, true],
    ]);
  });

  it("findet alle, nicht nur die nächsten, und markiert die niedrigsten", () => {
    // Geschwister s, t mit Eltern (p, q); p ist Kind von (g, h): gemeinsame Ahnen = p, q, g, h
    const g = build(["g:M", "h:F", "p:M", "q:F", "s:M", "t:F"], ["g+h > p", "p+q > s, t"]);
    const common = findCommonAncestors(g, "s", "t");
    expect(common.map((c) => c.id).sort()).toEqual(["g", "h", "p", "q"]);
    expect(
      common
        .filter((c) => c.lowest)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["p", "q"]);
  });

  it("zählt A selbst als Ahn, wenn A Vorfahr von B ist", () => {
    const g = load("cousin-marriage.json");
    const common = findCommonAncestors(g, "p_1", "p_9");
    expect(common[0]).toMatchObject({ id: "p_1", distA: 0, distB: 3, lowest: true });
  });

  it("liefert nichts bei Fremden oder unbekannten Personen", () => {
    const g = load("multiple-marriages.json");
    expect(findCommonAncestors(g, "p_2", "p_3")).toEqual([]);
    expect(findCommonAncestors(g, "p_2", "p_x")).toEqual([]);
  });

  it("respektiert maxDepth", () => {
    const g = load("cousin-marriage.json");
    expect(findCommonAncestors(g, "p_7", "p_8", { maxDepth: 1 })).toEqual([]);
  });

  it("meldet Tiefen je Seite", () => {
    const g = load("cousin-marriage.json");
    const p1 = findCommonAncestors(g, "p_9", "p_7").find((c) => c.id === "p_1");
    expect(p1).toMatchObject({ distA: 3, distB: 2, depthsA: [3], depthsB: [2] });
  });
});

describe("Bezeichnungen", () => {
  it("benennt direkte Linien", () => {
    expect(bloodRelationLabel(0, 1, "M")).toBe("Vater");
    expect(bloodRelationLabel(0, 2, "F")).toBe("Großmutter");
    expect(bloodRelationLabel(0, 3, "M")).toBe("Urgroßvater");
    expect(bloodRelationLabel(0, 4, "F")).toBe("Ururgroßmutter");
    expect(bloodRelationLabel(1, 0, "F")).toBe("Tochter");
    expect(bloodRelationLabel(2, 0, "M")).toBe("Enkel");
    expect(bloodRelationLabel(3, 0, "F")).toBe("Urenkelin");
    expect(bloodRelationLabel(0, 1, "U")).toBe("Elternteil");
  });

  it("benennt Seitenlinien", () => {
    expect(bloodRelationLabel(1, 1, "M")).toBe("Bruder");
    expect(bloodRelationLabel(1, 1, "F", true)).toBe("Halbschwester");
    expect(bloodRelationLabel(1, 2, "F")).toBe("Tante");
    expect(bloodRelationLabel(1, 3, "M")).toBe("Großonkel");
    expect(bloodRelationLabel(1, 4, "F")).toBe("Urgroßtante");
    expect(bloodRelationLabel(2, 1, "F")).toBe("Nichte");
    expect(bloodRelationLabel(3, 1, "M")).toBe("Großneffe");
  });

  it("zählt Cousins n. Grades und Generationen versetzt", () => {
    expect(bloodRelationLabel(2, 2, "M")).toBe("Cousin 1. Grades");
    expect(bloodRelationLabel(3, 3, "F")).toBe("Cousine 2. Grades");
    expect(bloodRelationLabel(3, 2, "M")).toBe("Cousin 1. Grades, 1 Generation versetzt");
    expect(bloodRelationLabel(2, 4, "F")).toBe("Cousine 1. Grades, 2 Generationen versetzt");
  });

  it("schreibt sehr weite Linien nicht mehr aus", () => {
    expect(bloodRelationLabel(0, 9, "M")).toBe("Vorfahre (9 Generationen entfernt)");
    expect(bloodRelationLabel(9, 0, "F")).toBe("Nachfahre (9 Generationen entfernt)");
  });
});

describe("Verwandtschaft: Mehrfach-Ehen (multiple-marriages.json)", () => {
  const g = load("multiple-marriages.json");

  it("unterscheidet Voll- und Halbgeschwister", () => {
    expect(describeRelationship(g, "p_5", "p_6").label).toBe("Bruder");
    expect(describeRelationship(g, "p_6", "p_5").label).toBe("Schwester");
    const half = describeRelationship(g, "p_5", "p_7");
    expect(half.label).toBe("Halbbruder");
    expect(half.blood[0]).toMatchObject({ ancestors: ["p_1"], half: true });
    expect(describeRelationship(g, "p_9", "p_10").label).toBe("Bruder");
    expect(describeRelationship(g, "p_10", "p_5").label).toBe("Halbschwester");
  });

  it("benennt Eltern und Kinder", () => {
    expect(describeRelationship(g, "p_1", "p_7").label).toBe("Vater");
    expect(describeRelationship(g, "p_7", "p_1").label).toBe("Sohn");
    expect(describeRelationship(g, "p_3", "p_7").blood[0]).toMatchObject({ up: 0, down: 1, half: false });
  });

  it("benennt Ehepartner", () => {
    const r = describeRelationship(g, "p_1", "p_3");
    expect(r.label).toBe("Ehemann");
    expect(r.partner?.unionId).toBe("u_2");
    expect(describeRelationship(g, "p_3", "p_1").label).toBe("Ehefrau");
  });

  it("erkennt Stiefeltern und Stiefkinder", () => {
    expect(describeRelationship(g, "p_3", "p_5").label).toBe("Stiefmutter"); // Frau 2 ↔ Kind aus Ehe 1
    expect(describeRelationship(g, "p_4", "p_7").label).toBe("Stiefmutter");
    expect(describeRelationship(g, "p_5", "p_3").label).toBe("Stiefsohn");
    expect(describeRelationship(g, "p_8", "p_4").label).toBe("Stieftochter");
  });

  it("kennt keine Verwandtschaft zwischen den Ehefrauen", () => {
    const r = describeRelationship(g, "p_2", "p_3");
    expect(r.label).toBe("nicht verwandt");
    expect(r.blood).toEqual([]);
  });

  it("erkennt dieselbe und unbekannte Person", () => {
    expect(describeRelationship(g, "p_1", "p_1")).toMatchObject({ same: true, label: "dieselbe Person" });
    expect(describeRelationship(g, "p_1", "p_x").label).toBe("nicht verwandt");
  });
});

describe("Verwandtschaft: Cousinenheirat (cousin-marriage.json)", () => {
  const g = load("cousin-marriage.json");

  it("beschreibt Ehepartner, die zugleich Cousins sind", () => {
    const r = describeRelationship(g, "p_7", "p_8");
    expect(r.label).toBe("Ehemann, Cousin 1. Grades");
    expect(r.blood).toHaveLength(1);
    expect(r.blood[0]).toMatchObject({ ancestors: ["p_1", "p_2"], up: 2, down: 2, half: false });
    expect(describeRelationship(g, "p_8", "p_7").label).toBe("Ehefrau, Cousine 1. Grades");
  });

  it("benennt Onkel, Nichte und Urgroßvater", () => {
    expect(describeRelationship(g, "p_3", "p_8").label).toBe("Onkel");
    expect(describeRelationship(g, "p_8", "p_3").label).toBe("Nichte");
    expect(describeRelationship(g, "p_1", "p_9").label).toBe("Urgroßvater");
    expect(describeRelationship(g, "p_9", "p_2").label).toBe("Urenkel");
  });

  it("gibt dasselbe Ergebnis für den GEDCOM-Import", () => {
    const { data } = importGedcom(readFileSync("example/gedcom/cousin-marriage.ged"));
    const gg = new FamilyGraph(data);
    const byName = (n: string) => [...gg.persons()].find((p) => p.givenNames === n)?.id as string;
    const r = describeRelationship(gg, byName("Konrad"), byName("Agnes"));
    expect(r.label).toBe("Ehemann, Cousin 1. Grades");
    expect(r.blood[0]?.ancestors).toHaveLength(2);
  });
});

describe("Verwandtschaft: mehrfach und angeheiratet (erfundene Personen)", () => {
  it("erkennt doppelte Cousins als zwei Linien", () => {
    // Zwei Geschwisterpaare (a1,a2) und (b1,b2) heiraten über Kreuz.
    const g = build(
      ["ga:M", "gb:F", "gc:M", "gd:F", "a1:M", "a2:F", "b1:F", "b2:M", "c1:M", "c2:F"],
      ["ga+gb > a1, a2", "gc+gd > b1, b2", "a1+b1 > c1", "a2+b2 > c2"],
    );
    const r = describeRelationship(g, "c1", "c2");
    expect(r.blood).toHaveLength(2);
    expect(r.blood.map((l) => l.ancestors.slice().sort())).toEqual([
      ["ga", "gb"],
      ["gc", "gd"],
    ]);
    expect(r.label).toBe("Cousin 1. Grades (doppelt)");
  });

  it("erkennt Halbgeschwister, die zugleich Cousins sind, als zwei Linien", () => {
    // x und y haben dieselbe Mutter m; ihre Väter f1, f2 sind Brüder.
    const g = build(
      ["gv:M", "gw:F", "f1:M", "f2:M", "m:F", "x:M", "y:F"],
      ["gv+gw > f1, f2", "f1+m > x", "f2+m > y"],
    );
    const labels = describeRelationship(g, "x", "y")
      .blood.map((l) => l.label)
      .sort();
    expect(labels).toEqual(["Cousin 1. Grades", "Halbbruder"]);
  });

  it("benennt Schwager, Schwiegereltern, Schwippschwager", () => {
    // s1 (Sohn) und s2 (Tochter) sind Geschwister (Eltern e1+e2). x heiratet s1, y heiratet s2.
    // k ist Kind von s1+x, kk heiratet k.
    const g = build(
      ["e1:M", "e2:F", "s1:M", "s2:F", "x:F", "y:M", "k:M", "kk:F"],
      ["e1+e2 > s1, s2", "s1+x > k", "s2+y", "k+kk"],
    );
    expect(describeRelationship(g, "x", "s2").label).toBe("Schwägerin");
    expect(describeRelationship(g, "s2", "x").label).toBe("Schwägerin");
    expect(describeRelationship(g, "y", "s1").label).toBe("Schwager");
    expect(describeRelationship(g, "kk", "s1").label).toBe("Schwiegertochter");
    expect(describeRelationship(g, "s1", "kk").label).toBe("Schwiegervater");
    expect(describeRelationship(g, "x", "y").label).toBe("Schwippschwägerin");
    expect(describeRelationship(g, "y", "x").label).toBe("Schwippschwager");
    expect(describeRelationship(g, "e1", "x").label).toBe("Schwiegervater");
  });

  it("markiert Geschiedene mit Ex-", () => {
    const base = build(["a:M", "b:F"], ["a+b"]);
    const u = base.getUnion("u_1") as Union;
    const g = new FamilyGraph({ persons: [...base.persons()], unions: [{ ...u, endReason: "divorce" }] });
    expect(describeRelationship(g, "a", "b").label).toBe("Ex-Ehemann");
    expect(describeRelationship(g, "b", "a").label).toBe("Ex-Ehefrau");
  });
});

describe("Inzuchtkoeffizient", () => {
  it("ist 1/16 beim Kind von Cousins 1. Grades (cousin-marriage.json)", () => {
    const g = load("cousin-marriage.json");
    expect(inbreedingCoefficient(g, "p_9")).toBeCloseTo(1 / 16, 10);
    expect(inbreedingCoefficient(g, "p_7")).toBe(0);
    expect(inbreedingCoefficient(g, "p_1")).toBe(0);
  });

  it("berechnet bekannte Grundfälle", () => {
    // Kind von Vollgeschwistern: 1/4
    const sib = build(["m:F", "f:M", "s:M", "t:F", "k:M"], ["f+m > s, t", "s+t > k"]);
    expect(inbreedingCoefficient(sib, "k")).toBeCloseTo(1 / 4, 10);
    // Kind von Onkel und Nichte: 1/8
    const un = build(
      ["g1:M", "g2:F", "o:M", "e:F", "x:M", "n:F", "ek:M"],
      ["g1+g2 > o, e", "e+x > n", "o+n > ek"],
    );
    expect(inbreedingCoefficient(un, "ek")).toBeCloseTo(1 / 8, 10);
    // Kind von Halbgeschwistern (gemeinsamer Vater): 1/8
    const half = build(
      ["v:M", "w1:F", "w2:F", "h1:M", "h2:F", "hk:M"],
      ["v+w1 > h1", "v+w2 > h2", "h1+h2 > hk"],
    );
    expect(inbreedingCoefficient(half, "hk")).toBeCloseTo(1 / 8, 10);
    // Kind von Vater und Tochter: 1/4
    const fd = build(["pf:M", "pm:F", "pd:F", "pk:M"], ["pf+pm > pd", "pf+pd > pk"]);
    expect(inbreedingCoefficient(fd, "pk")).toBeCloseTo(1 / 4, 10);
  });

  it("rechnet Inzucht der Vorfahren mit (zweite Generation Geschwisterheirat)", () => {
    // f+m → s, t; s+t → k1, k2 (beide F = 1/4); k1+k2 → z. Kinship der Geschwister k1, k2 = 3/8.
    const g = build(
      ["m:F", "f:M", "s:M", "t:F", "k1:M", "k2:F", "z:M"],
      ["f+m > s, t", "s+t > k1, k2", "k1+k2 > z"],
    );
    expect(inbreedingCoefficient(g, "k1")).toBeCloseTo(1 / 4, 10);
    expect(inbreedingCoefficient(g, "z")).toBeCloseTo(3 / 8, 10);
  });

  it("ist 0 bei unbekanntem Elternteil; Kinship-Grundwerte", () => {
    const g = build(["a:M", "b:M"], ["a > b"]);
    const calc = new KinshipCalculator(g);
    expect(calc.inbreeding("b")).toBe(0);
    expect(calc.kinship("a", "b")).toBeCloseTo(1 / 4);
    expect(calc.kinship("a", "a")).toBeCloseTo(1 / 2);
    expect(calc.kinship("a", "x")).toBe(0);
  });

  it("wertet Adoptiveltern nur auf Wunsch", () => {
    const base = build(["a:M", "b:F", "c:M", "d:F", "k:M"], ["a+b > c, d", "c+d > k"]);
    const adopted = new FamilyGraph({
      persons: [...base.persons()],
      unions: [...base.unions()].map((u) =>
        u.id === "u_2" ? { ...u, children: [{ personId: "k", kind: "adopted" as const }] } : u,
      ),
    });
    expect(inbreedingCoefficient(adopted, "k")).toBe(0);
    expect(inbreedingCoefficient(adopted, "k", { includeAdopted: true })).toBeCloseTo(1 / 4);
  });

  it("terminiert bei Zyklen", () => {
    const cyc = build(["a:M", "b:M"], ["a+b > a"]);
    expect(Number.isFinite(inbreedingCoefficient(cyc, "a"))).toBe(true);
  });
});
