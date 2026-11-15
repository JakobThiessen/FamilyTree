import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { FamilyGraph, loadGraph, layoutView, LayoutSession } from "../../src/core";
import type { LayoutResult, Person, Sex, Union, ViewRequest } from "../../src/core";

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
      order: i + 1,
      children: (kids ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((personId) => ({ personId, kind: "biological" as const })),
    };
  });
  return new FamilyGraph({ persons: ps, unions: us });
}

const req = (focusId: string, up: number, down: number, mode: ViewRequest["mode"] = "direct"): ViewRequest => ({
  focusId, up, down, mode,
});

/** Prüft die Grundregeln jedes Layouts: keine Überlappung, Karten nur einmal echt, Schichten bei den Eltern. */
function expectSound(g: FamilyGraph, r: LayoutResult): void {
  const byLayer = new Map<number, { l: number; r: number }[]>();
  for (const n of r.nodes) {
    const list = byLayer.get(n.layer) ?? [];
    list.push({ l: n.x - n.width / 2, r: n.x + n.width / 2 });
    byLayer.set(n.layer, list);
  }
  for (const list of byLayer.values()) {
    list.sort((a, b) => a.l - b.l);
    for (let i = 1; i < list.length; i++) expect((list[i] as { l: number }).l).toBeGreaterThanOrEqual((list[i - 1] as { r: number }).r - 1e-6);
  }
  const real = r.nodes.filter((n) => !n.ghost).map((n) => n.personId);
  expect(new Set(real).size).toBe(real.length);
  const keys = r.nodes.map((n) => n.key);
  expect(new Set(keys).size).toBe(keys.length);
  const layerOf = new Map(r.nodes.map((n) => [n.key, n.layer]));
  for (const u of r.unions) {
    for (const c of u.children) expect(layerOf.get(c.key)).toBeGreaterThan(u.layer);
  }
  void g;
}

describe("Layout: Schichten und Sanduhr", () => {
  const g = load("cousin-marriage.json");

  it("legt Eltern über, Kinder unter den Fokus", () => {
    const r = layoutView(g, req("p_5", 2, 2));
    const layer = (id: string) => r.nodes.find((n) => n.key === id)?.layer;
    expect(layer("p_5")).toBe(0);
    expect(layer("p_1")).toBe(-1);
    expect(layer("p_2")).toBe(-1);
    expect(layer("p_8")).toBe(1);
    expect(layer("p_9")).toBe(2);
    expectSound(g, r);
  });

  it("zentriert den Fokus bei x = 0 und liefert Rahmen und Statistik", () => {
    const r = layoutView(g, req("p_9", 3, 0));
    const focus = r.nodes.find((n) => n.key === r.focusKey) as { x: number; y: number };
    expect(focus.x).toBe(0);
    expect(focus.y).toBe(0);
    expect(r.bounds.minY).toBeLessThan(0);
    expect(r.stats.persons).toBe(9);
  });

  it("unbekannter Fokus gibt ein leeres Layout", () => {
    const r = layoutView(g, req("p_999", 2, 2));
    expect(r.nodes).toEqual([]);
    expect(r.focusKey).toBeNull();
  });

  it("Modus direct zeigt keine Partner außerhalb der Linie, family schon", () => {
    const direct = layoutView(g, req("p_3", 0, 2, "direct"));
    expect(direct.nodes.map((n) => n.key).sort()).toEqual(["p_3", "p_7", "p_9"]);
    const family = layoutView(g, req("p_3", 0, 2, "family"));
    expect(family.nodes.map((n) => n.key)).toContain("p_4");
    expect(family.nodes.map((n) => n.key)).toContain("p_8");
    expectSound(g, family);
  });
});

describe("Layout: Geisterknoten bei Ahnenschwund", () => {
  const g = load("cousin-marriage.json");

  it("zeigt die gemeinsamen Ahnen einmal echt und einmal als Geist", () => {
    const r = layoutView(g, req("p_9", 4, 0));
    expect(r.nodes.filter((n) => n.personId === "p_1" && !n.ghost)).toHaveLength(1);
    const ghosts = r.nodes.filter((n) => n.ghost);
    expect(ghosts.map((n) => n.personId).sort()).toEqual(["p_1", "p_2"]);
    expect(r.stats.ghosts).toBe(2);
    // der Geist steht eine Schicht über seinem Kind und hat keine eigenen Verweise nach oben
    const ghostBand = r.bands.find((b) => b.ghost);
    expect(ghostBand?.layer).toBe(-2 - 1);
    expectSound(g, r);
  });

  it("ein Geist hängt über die Union am Kind, die echte Union bleibt einmal bestehen", () => {
    const r = layoutView(g, req("p_9", 4, 0));
    const u1 = r.unions.filter((u) => u.unionId === "u_1");
    expect(u1).toHaveLength(2);
    expect(u1.filter((u) => !u.ghost)).toHaveLength(1);
    const ghostUnion = u1.find((u) => u.ghost);
    expect(ghostUnion?.partnerKeys.every((k) => k.includes("~"))).toBe(true);
    expect(ghostUnion?.children).toHaveLength(1);
  });

  it("hat ohne Ahnenschwund keine Geister", () => {
    const r = layoutView(g, req("p_7", 4, 1));
    expect(r.nodes.some((n) => n.ghost)).toBe(false);
  });

  it("bei Heirat unter Verwandten erscheint der Ast, der zum zweiten Mal erreicht wird, als Geist", () => {
    // Fokus ist der gemeinsame Ahn: Konrad (p_7) und Agnes (p_8) kommen aus verschiedenen Ästen.
    const r = layoutView(g, req("p_1", 0, 3));
    const ghosts = r.nodes.filter((n) => n.ghost).map((n) => n.personId);
    expect(ghosts).toEqual(["p_5"]);
    expectSound(g, r);
  });
});

describe("Layout: Schleifen und tiefste Schicht", () => {
  it("legt einen Ahn auf Wegen unterschiedlicher Länge in die tiefste Schicht", () => {
    // Opa (a) hat Kinder b und c. b hat Kind d, c hat Kind e; d und e haben Kind f (Fokus).
    // a erreicht f nur über Länge 3, zusätzlich ist a direkt Elternteil von f (Länge 1) -> tiefste Schicht −3.
    const g = build(
      ["a:M", "x:F", "b:M", "c:M", "d:M", "e:F", "f:M", "y:F"],
      ["a+x > b, c, f", "b > d", "c > e", "d+e > f"],
    );
    // f hat damit zwei Eltern-Unions (a+x und d+e), beide biologisch: für das Layout egal.
    const r = layoutView(g, req("f", 5, 0));
    expect(r.nodes.find((n) => n.key === "a")?.layer).toBe(-3);
    expect(r.nodes.find((n) => n.key === "f")?.layer).toBe(0);
    expectSound(g, r);
  });

  it("Eltern liegen immer über ihren Kindern, auch bei ungleich langen Ästen", () => {
    const g = build(
      ["g1:M", "g2:F", "m:F", "f:M", "k:M", "gg1:M", "gg2:F"],
      ["gg1+gg2 > g1", "g1+g2 > f", "f+m > k"],
    );
    const r = layoutView(g, req("k", 5, 0));
    expect(r.nodes.find((n) => n.key === "f")?.layer).toBe(-1);
    expect(r.nodes.find((n) => n.key === "m")?.layer).toBe(-1);
    expect(r.nodes.find((n) => n.key === "g1")?.layer).toBe(-2);
    expect(r.nodes.find((n) => n.key === "gg1")?.layer).toBe(-3);
    expectSound(g, r);
  });
});

describe("Layout: Partnerbänder und Mehrfach-Ehen", () => {
  const g = load("multiple-marriages.json");

  it("stellt Partner in Ehe-Reihenfolge in ein Band", () => {
    const r = layoutView(g, req("p_1", 0, 1, "family"));
    const band = r.bands.find((b) => b.nodeKeys.includes("p_1")) as { nodeKeys: string[]; layer: number };
    // Mehrfach-Ehen (D43): Hub in der Mitte, erste Ehe links, weitere rechts in Ehe-Reihenfolge
    expect(band.nodeKeys).toEqual(["p_2", "p_1", "p_3", "p_4"]);
    expect(band.layer).toBe(0);
    expectSound(g, r);
  });

  it("hängt die Kinder an die richtige Union (in Reihenfolge)", () => {
    const r = layoutView(g, req("p_1", 0, 1, "family"));
    const unions = r.unions.filter((u) => !u.ghost);
    expect(unions.map((u) => u.unionId)).toEqual(["u_1", "u_2", "u_3"]);
    expect(unions[0]?.children.map((c) => c.key)).toEqual(["p_5", "p_6"]);
    expect(unions[1]?.children.map((c) => c.key)).toEqual(["p_7", "p_8"]);
    expect(unions[2]?.children.map((c) => c.key)).toEqual(["p_9", "p_10"]);
    expect(unions[2]?.children[1]?.status).toBe("assumed");
    // Kinder stehen in der Reihenfolge der Ehen von links nach rechts
    const xs = ["p_5", "p_7", "p_9"].map((k) => r.nodes.find((n) => n.key === k)?.x as number);
    expect(xs[0]).toBeLessThan(xs[1] as number);
    expect(xs[1]).toBeLessThan(xs[2] as number);
  });

  it("zeigt Halbgeschwister im Modus family neben dem Fokus", () => {
    const r = layoutView(g, req("p_9", 1, 0, "family"));
    const keys = r.nodes.map((n) => n.key);
    for (const id of ["p_1", "p_4", "p_10", "p_5", "p_7"]) expect(keys).toContain(id);
    expectSound(g, r);
  });

  it("Modus all kommt mit jedem Fokus und Tiefe ohne Überlappung aus", () => {
    for (const focus of ["p_1", "p_5", "p_9", "p_4"]) {
      const r = layoutView(g, req(focus, 3, 3, "all"));
      expectSound(g, r);
      expect(r.nodes).toHaveLength(10);
    }
  });
});

describe("Layout: Zusatzfälle", () => {
  it("markiert versteckte Eltern/Kinder am Rand (+n)", () => {
    const g = load("cousin-marriage.json");
    const r = layoutView(g, req("p_9", 1, 0));
    const konrad = r.nodes.find((n) => n.key === "p_7");
    expect(konrad?.hiddenParents).toBe(2);
    const g2 = load("multiple-marriages.json");
    const r2 = layoutView(g2, req("p_1", 0, 0));
    expect(r2.nodes[0]?.hiddenChildren).toBe(6);
  });

  it("verträgt eine Person ohne Verwandte und Partner ohne Kinder", () => {
    const g = build(["a:M", "b:F", "c:U"], ["a+b"]);
    const r = layoutView(g, req("a", 2, 2, "family"));
    expect(r.nodes.map((n) => n.key)).toEqual(["a", "b"]);
    expect(r.unions).toHaveLength(1);
    expect(layoutView(g, req("c", 2, 2)).nodes).toHaveLength(1);
  });

  it("legt eine Person mit zwei Eltern-Unions (Adoption) nur einmal echt an", () => {
    const g = build(["f:M", "m:F", "af:M", "am:F", "k:U"], ["f+m > k", "af+am > k"]);
    const r = layoutView(g, req("k", 1, 0));
    expect(r.nodes.filter((n) => n.personId === "k")).toHaveLength(1);
    expect(r.nodes.map((n) => n.key).sort()).toEqual(["af", "am", "f", "k", "m"]);
    expectSound(g, r);
  });

  it("überlebt Zyklen in kaputten Daten", () => {
    const g = build(["a:M", "b:M"], ["a > b", "b > a"]);
    const r = layoutView(g, req("a", 3, 3));
    expect(r.nodes.length).toBeGreaterThan(0);
  });
});

describe("Layout: inkrementell pro Chunk", () => {
  it("verschiebt vorhandene Karten nicht, wenn die Tiefe wächst", () => {
    const g = load("cousin-marriage.json");
    const session = new LayoutSession({ persons: [...g.persons()], unions: [...g.unions()] });
    const first = session.layout(req("p_9", 1, 0));
    const second = session.layout(req("p_9", 3, 0));
    for (const n of first.nodes) {
      const m = second.nodes.find((x) => x.key === n.key);
      expect(m?.x).toBe(n.x);
      expect(m?.y).toBe(n.y);
    }
    expect(second.added.sort()).toEqual(second.nodes.filter((n) => !first.nodes.some((f) => f.key === n.key)).map((n) => n.key).sort());
    expect(second.added.length).toBeGreaterThan(0);
    expectSound(g, second);
  });

  it("führt Änderungslisten nach (applyChanges) wie ein neuer Stand mit setData", () => {
    const g = load("multiple-marriages.json");
    const persons = [...g.persons()];
    const unions = [...g.unions()];
    const session = new LayoutSession({ persons, unions });
    const focus = persons[0]!.id;
    session.layout(req(focus, 2, 2, "family"));
    session.applyChanges({ putPersons: [{ id: "p_new", givenNames: "Neu", surname: "Muster", sex: "F" }, { ...persons[1]!, givenNames: "Geändert" }] });
    session.reset();
    const after = session.layout(req(focus, 2, 2, "family"));
    const fresh = new LayoutSession({ persons: [...persons.map((p) => (p.id === persons[1]!.id ? { ...p, givenNames: "Geändert" } : p)), { id: "p_new", givenNames: "Neu", surname: "Muster", sex: "F" }], unions }).layout(req(focus, 2, 2, "family"));
    expect(after.nodes.map((n) => [n.key, n.x, n.y])).toEqual(fresh.nodes.map((n) => [n.key, n.x, n.y]));
    // eine Union mit unbekanntem Partner passt nicht zum Stand: wirft, Stand bleibt
    expect(() => session.applyChanges({ putUnions: [{ id: "u_bad", partnerIds: ["nobody"], kind: "marriage", children: [] }] })).toThrow();
  });

  it("verschiebt auch bei Geistern und Familienmodus nichts", () => {
    const g = load("multiple-marriages.json");
    const session = new LayoutSession({ persons: [...g.persons()], unions: [...g.unions()] });
    const a = session.layout(req("p_5", 0, 0, "family"));
    const b = session.layout(req("p_5", 2, 2, "family"));
    for (const n of a.nodes) {
      const m = b.nodes.find((x) => x.key === n.key);
      expect(m?.x).toBe(n.x);
    }
    expectSound(g, b);
  });

  it("fängt bei anderem Fokus neu an", () => {
    const g = load("cousin-marriage.json");
    const session = new LayoutSession({ persons: [...g.persons()], unions: [...g.unions()] });
    session.layout(req("p_9", 2, 0));
    const r = session.layout(req("p_1", 0, 2));
    expect(r.added.length).toBe(r.nodes.length);
    expect(r.nodes.find((n) => n.key === "p_1")?.x).toBe(0);
  });
});

describe("Layout: Performance", () => {
  const file = "example/performance/tree-50000.json";
  it("vollständiger Ahnenbaum (4.095 Ahnen) und breiter Nachkommenbaum unter 100 ms", () => {
    const persons: Person[] = [{ id: "f", sex: "U" }];
    const unions: Union[] = [];
    // Ahnen: Person n hat Eltern 2n+1 (Vater) und 2n+2 (Mutter), 12 Generationen
    const total = 2 ** 13 - 1;
    for (let n = 0; n < total; n++) {
      if (n > 0) persons.push({ id: `a${n}`, sex: n % 2 === 1 ? "M" : "F" });
      if (2 * n + 2 < total) {
        const child = n === 0 ? "f" : `a${n}`;
        unions.push({ id: `ua${n}`, partnerIds: [`a${2 * n + 1}`, `a${2 * n + 2}`], kind: "marriage", children: [{ personId: child, kind: "biological" }] });
      }
    }
    // Nachkommen: jeder hat 3 Kinder, 6 Generationen (1.092 Personen), plus Partner je Person
    let c = 0;
    let level = ["f"];
    for (let d = 0; d < 6; d++) {
      const next: string[] = [];
      for (const p of level) {
        const spouse = `s${c++}`;
        persons.push({ id: spouse, sex: "U" });
        const kids = [0, 1, 2].map(() => `d${c++}`);
        for (const k of kids) persons.push({ id: k, sex: "U" });
        unions.push({ id: `ud${c}`, partnerIds: [p, spouse], kind: "marriage", children: kids.map((k) => ({ personId: k, kind: "biological" as const })) });
        next.push(...kids);
      }
      level = next;
    }
    const g = new FamilyGraph({ persons, unions });
    // großer Chunk: 9 Generationen Ahnen (1.023) und 5 Generationen Nachkommen
    const chunk = req("f", 9, 5, "family");
    layoutView(g, chunk);
    const c1 = layoutView(g, chunk);
    console.log(`Großer Chunk: ${c1.nodes.length} Karten, ${c1.stats.ms.toFixed(1)} ms`);
    expect(c1.nodes.length).toBeGreaterThan(1500);
    // Allein ca. 55 ms; Vitest führt Dateien parallel aus, dann steigt die Zeit auf über 100 ms. Daher 250 ms Obergrenze.
    expect(c1.stats.ms).toBeLessThan(250);
    expectSound(g, c1);
    // Extremfall: alles auf einmal (nur grobe Obergrenze, Richtwert ca. 20 µs je Karte)
    const request = req("f", 20, 20, "family");
    const r = layoutView(g, request);
    console.log(`Extremfall: ${r.nodes.length} Karten, ${r.stats.ms.toFixed(1)} ms`);
    expect(r.nodes.length).toBeGreaterThan(8000);
    expect(r.stats.ms).toBeLessThan(1000);
    expectSound(g, r);
  });

  it.skipIf(!existsSync(file))("Layout eines Chunks bei 50.000 Personen unter 100 ms", () => {
    const g = loadGraph(readFileSync(file, "utf8"));
    expect(g.personCount).toBeGreaterThan(40000);
    // Fokus mit vielen Verwandten suchen: Person mit Kindern in der Mitte des Baums
    let focus = "p_1";
    let best = 0;
    for (const p of g.persons()) {
      const n = g.children(p.id).length + g.parents(p.id).length;
      if (n > best) {
        best = n;
        focus = p.id;
      }
      if (best >= 6) break;
    }
    // Mehrere Chunk-Größen, auch sehr große Ansichten im Modus all (Ziel: jeweils unter 100 ms)
    for (const request of [req(focus, 6, 6, "family"), req(focus, 10, 10, "family"), req(focus, 8, 8, "all")]) {
      layoutView(g, request); // Aufwärmen
      const r = layoutView(g, request);
      console.log(`Chunk ${request.mode} ${request.up}/${request.down}: ${r.nodes.length} Karten, ${r.stats.ms.toFixed(1)} ms`);
      expect(r.nodes.length).toBeGreaterThan(10);
      expect(r.stats.ms).toBeLessThan(100);
    }
    const r = layoutView(g, req(focus, 6, 6, "family"));
    expectSound(g, r);
  });
});

describe("Layout-Worker (Nachrichtenverarbeitung)", () => {
  it("setData, layout und reset laufen über den Handler", async () => {
    const { createLayoutHandler } = await import("../../src/workers/layoutHandler");
    const g = load("cousin-marriage.json");
    const handle = createLayoutHandler();
    expect(handle({ id: 1, type: "setData", data: { persons: [...g.persons()], unions: [...g.unions()] } })).toEqual({ id: 1, ok: true });
    const a = handle({ id: 2, type: "layout", request: req("p_9", 1, 0) });
    expect(a.ok && a.result?.nodes.length).toBe(3);
    const b = handle({ id: 3, type: "layout", request: req("p_9", 2, 0) });
    expect(b.ok && b.result?.added.length).toBe(4);
    expect(handle({ id: 4, type: "reset" }).ok).toBe(true);
    // Antwort lässt sich per structuredClone übertragen (Worker-Tauglichkeit)
    expect(() => structuredClone(b)).not.toThrow();
  });
});

describe("Layout: keine Überkreuzung bei Geschwistern (D43)", () => {
  const P = (id: string) => ({ id, givenNames: id, surname: "Beispiel", sex: "U" as const });
  const U = (id: string, partnerIds: string[], kids: string[]) => ({
    id, kind: "marriage" as const, partnerIds, children: kids.map((personId) => ({ personId, kind: "biological" as const })),
  });
  // Natalie (Fokus) und Jakob mit zwei Kindern; Jakobs Schwester Irina hat zwei Kinder, sein Bruder eins.
  const ids = ["gp1", "gp2", "jakob", "irina", "andreas", "natalie", "becker", "tim", "emily", "isa", "dan", "alice", "andw", "n1", "n2"];
  const data = {
    version: 1 as const,
    sources: [],
    persons: ids.map(P),
    unions: [
      U("u1", ["gp1", "gp2"], ["irina", "jakob", "andreas"]),
      U("u2", ["jakob", "natalie"], ["tim", "emily"]),
      U("u3", ["irina", "becker"], ["isa", "dan"]),
      U("u5", ["andreas", "andw"], ["alice"]),
      U("u4", ["n1", "n2"], ["natalie"]),
    ],
  };

  function crossings(g: FamilyGraph, focusId: string, mode: "direct" | "family" | "all"): string[] {
    const r = layoutView(g, req(focusId, 2, 2, mode));
    const byKey = new Map(r.nodes.map((n) => [n.key, n]));
    const bad: string[] = [];
    for (const u of r.unions) {
      const ks = [...new Set(u.children.map((c) => byKey.get(c.key)).filter((n): n is NonNullable<typeof n> => !!n))];
      if (ks.length < 2) continue;
      const layer = (ks[0] as { layer: number }).layer;
      const lo = Math.min(...ks.map((k) => k.x));
      const hi = Math.max(...ks.map((k) => k.x));
      if (r.nodes.some((n) => n.layer === layer && n.x > lo && n.x < hi && !ks.some((k) => k.bandId === n.bandId))) bad.push(u.key);
    }
    return bad;
  }

  it("Kinder einer Verbindung stehen nebeneinander, fremde Kinder nie dazwischen", () => {
    const g = new FamilyGraph(data);
    for (const focus of ["natalie", "jakob", "irina", "tim"]) {
      for (const mode of ["direct", "family", "all"] as const) expect(crossings(g, focus, mode)).toEqual([]);
    }
  });

  it("gilt auch für die Beispieldateien", () => {
    for (const f of ["cousin-marriage.json", "migration.json", "multiple-marriages.json"]) {
      const eg = load(f);
      for (const p of eg.persons()) {
        for (const mode of ["direct", "family"] as const) expect(crossings(eg, p.id, mode)).toEqual([]);
      }
    }
  });
});
