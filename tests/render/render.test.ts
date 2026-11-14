import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { LayoutSession } from "../../src/core";
import type { Person, TreeData, Union } from "../../src/core";
import { Camera, GridIndex, buildScene, badgeRect, lineColor, lifeSpan, initials, isUnknownPerson } from "../../src/render";

const readTree = (file: string): TreeData => JSON.parse(readFileSync(file, "utf8")) as TreeData;
const persons = (ps: Person[]) => new Map(ps.map((p) => [p.id, p]));

/** Kleiner erfundener Baum: Eltern a+b, Kinder c (belegt), d (vermutet), e (adoptiert); c+f haben Kind g. */
function tinyTree() {
  const ps: Person[] = [
    { id: "a", sex: "M", givenNames: "Anton", surname: "Beispiel", birth: { date: { kind: "exact", year: 1800 } } },
    { id: "b", sex: "F", givenNames: "Berta", surname: "Muster" },
    { id: "c", sex: "M", givenNames: "Carl", surname: "Beispiel" },
    { id: "d", sex: "F", givenNames: "Dora", surname: "Beispiel", status: "assumed" },
    { id: "e", sex: "M", givenNames: "Emil", surname: "Beispiel" },
    { id: "f", sex: "F", givenNames: "Frieda", surname: "Vorlage" },
    { id: "g", sex: "F", givenNames: "Gerda", surname: "Beispiel" },
  ];
  const us: Union[] = [
    {
      id: "u1", partnerIds: ["a", "b"], kind: "marriage", order: 1,
      children: [
        { personId: "c", kind: "biological" },
        { personId: "d", kind: "biological", status: "assumed" },
        { personId: "e", kind: "adopted" },
      ],
    },
    { id: "u2", partnerIds: ["c", "f"], kind: "marriage", order: 1, children: [{ personId: "g", kind: "biological" }] },
  ];
  return { ps, us };
}

describe("Camera", () => {
  it("rechnet Welt und Bildschirm hin und zurück", () => {
    const c = new Camera();
    c.scale = 2;
    c.tx = 10;
    c.ty = -5;
    const [sx, sy] = c.worldToScreen(7, 3);
    const [wx, wy] = c.screenToWorld(sx, sy);
    expect(wx).toBeCloseTo(7);
    expect(wy).toBeCloseTo(3);
  });

  it("zoomt um den Mauszeiger: der Punkt darunter bleibt stehen", () => {
    const c = new Camera();
    c.tx = 30;
    c.ty = 40;
    const before = c.screenToWorld(200, 100);
    c.zoomAt(200, 100, 1.7);
    const after = c.screenToWorld(200, 100);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(c.scale).toBeCloseTo(1.7);
  });

  it("begrenzt den Zoom", () => {
    const c = new Camera();
    c.zoomAt(0, 0, 1e6);
    expect(c.scale).toBe(c.maxScale);
    c.zoomAt(0, 0, 1e-9);
    expect(c.scale).toBe(c.minScale);
  });

  it("passt einen Rahmen ein und vergrößert nicht über 1", () => {
    const c = new Camera();
    c.fit({ minX: 0, maxX: 100, minY: 0, maxY: 50 }, 800, 600);
    expect(c.scale).toBe(1);
    c.fit({ minX: 0, maxX: 8000, minY: 0, maxY: 500 }, 800, 600);
    expect(c.scale).toBeLessThan(0.11);
    const v = c.visibleRect(800, 600);
    expect(v.minX).toBeLessThan(0);
    expect(v.maxX).toBeGreaterThan(8000);
  });
});

describe("GridIndex", () => {
  it("liefert nur Elemente im Ausschnitt, jedes einmal", () => {
    const g = new GridIndex(100);
    g.insert(0, { minX: 0, minY: 0, maxX: 50, maxY: 50 });
    g.insert(1, { minX: 90, minY: 0, maxX: 450, maxY: 20 }); // überspannt mehrere Zellen
    g.insert(2, { minX: 1000, minY: 1000, maxX: 1010, maxY: 1010 });
    g.insert(3, { minX: -300, minY: -300, maxX: -250, maxY: -250 }); // negative Koordinaten
    const seen: number[] = [];
    g.query({ minX: 0, minY: 0, maxX: 500, maxY: 100 }, (id) => seen.push(id));
    expect(seen.sort()).toEqual([0, 1]);
    const neg: number[] = [];
    g.query({ minX: -400, minY: -400, maxX: -200, maxY: -200 }, (id) => neg.push(id));
    expect(neg).toEqual([3]);
  });
});

describe("Stil", () => {
  it("gleicher Nachname = gleiche Farbe", () => {
    expect(lineColor("Muster")).toBe(lineColor(" muster "));
    expect(lineColor(undefined)).toBe(lineColor(""));
  });
  it("Initialen und unbekannte Personen", () => {
    expect(initials({ id: "x", sex: "U", givenNames: "anna", surname: "Muster" })).toBe("AM");
    expect(initials({ id: "x", sex: "U", surname: "Muster" })).toBe("M");
    expect(initials({ id: "x", sex: "U" })).toBe("?");
    expect(isUnknownPerson({ id: "x", sex: "U" })).toBe(true);
    expect(isUnknownPerson({ id: "x", sex: "U", givenNames: "A", status: "unknown" })).toBe(true);
    expect(isUnknownPerson({ id: "x", sex: "U", givenNames: "A" })).toBe(false);
  });
  it("Lebensspanne", () => {
    expect(lifeSpan({ id: "x", sex: "U", birth: { date: { kind: "about", year: 1750 } }, death: { date: { kind: "exact", year: 1800 } } })).toBe("* ~1750 – † 1800");
    expect(lifeSpan({ id: "x", sex: "U" })).toBe("");
  });
});

describe("Szene", () => {
  const { ps, us } = tinyTree();
  const session = new LayoutSession({ persons: ps, unions: us });
  const result = session.layout({ focusId: "c", up: 1, down: 1, mode: "direct" });
  const scene = buildScene(result, persons(ps), { lineMode: "orthogonal" });

  it("legt zu jeder Karte eine Szenenkarte mit Familienfarbe an", () => {
    expect(scene.cards.length).toBe(result.nodes.length);
    const carl = scene.cards.find((c) => c.node.personId === "c")!;
    expect(carl.name).toBe("Carl Beispiel");
    expect(carl.color).toBe(lineColor("Beispiel"));
    expect(scene.focusKey).toBe("c");
  });

  it("Standard sind S-Kurven: eine Kurve je Kind, senkrecht aus dem Anker und senkrecht ins Kind", () => {
    const curved = buildScene(result, persons(ps));
    expect(curved.lineMode).toBe("curved");
    const curves = curved.edges.filter((e) => e.curve);
    expect(curves.length).toBeGreaterThan(0);
    for (const e of curves) {
      const p = e.points as number[];
      expect(p.length).toBe(8);
      expect(p[2]).toBe(p[0]); // erster Stützpunkt senkrecht unter dem Anker
      expect(p[4]).toBe(p[6]); // zweiter senkrecht über dem Kind
      expect(p[7]).toBeGreaterThan(p[1] as number); // Kind liegt unter dem Anker
    }
    // keine rechtwinkligen Sammelschienen im Kurvenmodus
    expect(curved.edges.some((e) => !e.curve && e.points.length === 6)).toBe(false);
    // Kartenzahl und Linienzahl pro Kind bleiben gleich wie rechtwinklig
    expect(curves.length).toBe(scene.edges.filter((e) => e.points.length === 6).length);
  });

  it("Filter: unbestätigte Verbindungen und unbekannte Personen ausblenden, Fokus bleibt", () => {
    const full = new LayoutSession({ persons: ps, unions: us }).layout({ focusId: "a", up: 0, down: 2, mode: "family" });
    const all = buildScene(full, persons(ps));
    expect(all.edges.some((e) => e.style === "dashed")).toBe(true);
    const noDashed = buildScene(full, persons(ps), { showUnconfirmed: false });
    expect(noDashed.edges.some((e) => e.style === "dashed")).toBe(false);
    expect(noDashed.cards.length).toBe(all.cards.length); // Karten bleiben

    const withUnknown: Person[] = [...ps, { id: "z", sex: "U" }];
    const u2: Union[] = [...us, { id: "u3", partnerIds: ["a", "z"], kind: "partnership", children: [] }];
    const res = new LayoutSession({ persons: withUnknown, unions: u2 }).layout({ focusId: "a", up: 0, down: 2, mode: "family" });
    const shown = buildScene(res, persons(withUnknown));
    const hidden = buildScene(res, persons(withUnknown), { showUnknown: false });
    expect(shown.cards.some((c) => c.node.personId === "z")).toBe(true);
    expect(hidden.cards.some((c) => c.node.personId === "z")).toBe(false);
    expect(hidden.visiblePersons).toBe(shown.visiblePersons - 1);
    expect(hidden.totalPersons).toBe(shown.totalPersons);
    expect(hidden.cards.some((c) => c.node.personId === "a")).toBe(true);
    // Fokus wird nie ausgeblendet, auch wenn er unbekannt wäre
    const focusUnknown = new LayoutSession({ persons: withUnknown, unions: u2 }).layout({ focusId: "z", up: 1, down: 1, mode: "family" });
    expect(buildScene(focusUnknown, persons(withUnknown), { showUnknown: false }).cards.some((c) => c.node.personId === "z")).toBe(true);
  });

  it("zeichnet Linien rechtwinklig mit Stamm und Sammelschiene", () => {
    const withCorners = scene.edges.filter((e) => e.points.length === 6);
    expect(withCorners.length).toBeGreaterThan(0);
    for (const e of withCorners) {
      // x0,y0 → x0,busY → cx,busY → cx,top: erst senkrecht, dann waagerecht, dann senkrecht
      const p = e.points as [number, number, number, number, number, number];
      expect(p[1]).toBe(p[1]);
      expect(p[3]).toBe(p[1]); // Schiene beginnt bei gleicher Höhe wie der Union-Anker
    }
  });

  it("zeigt „+n“ nur dort, wo etwas zugeklappt ist", () => {
    // Fokus c mit up=1: a und b stehen noch drin, sie haben keine Eltern; c hat Kind g sichtbar
    expect(scene.cards.every((c) => c.node.hiddenParents === 0)).toBe(true);
    const narrow = buildScene(session.layout({ focusId: "g", up: 1, down: 0, mode: "direct" }), persons(ps));
    const gerda = narrow.cards.find((c) => c.node.personId === "g")!;
    expect(gerda.node.hiddenParents).toBe(0);
    const carl = narrow.cards.find((c) => c.node.personId === "c")!;
    expect(carl.node.hiddenParents).toBeGreaterThan(0);
    const r = badgeRect(carl, "up");
    expect(r.maxY).toBeLessThan(carl.rect.minY);
  });

  it("belegte Linien durchgezogen, vermutete gestrichelt, Adoption gepunktet", () => {
    const full = buildScene(new LayoutSession({ persons: ps, unions: us }).layout({ focusId: "a", up: 0, down: 2, mode: "family" }), persons(ps));
    const styles = new Set(full.edges.map((e) => e.style));
    expect(styles.has("solid")).toBe(true);
    expect(styles.has("dashed")).toBe(true);
    expect(styles.has("dotted")).toBe(true);
    const dora = full.cards.find((c) => c.node.personId === "d")!;
    expect(dora.unconfirmed).toBe(true);
  });
});

describe("Spuren der Sammelschienen", () => {
  it("benachbarte Partnerschaften derselben Schicht liegen nicht auf einer Schiene", () => {
    // Zwei Geschwisterpaare mit je zwei Kindern: ihre Schienen würden sich sonst berühren
    const ps: Person[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id, sex: "U", givenNames: id }));
    const us: Union[] = [
      { id: "u1", partnerIds: ["a", "b"], kind: "marriage", children: [{ personId: "c", kind: "biological" }, { personId: "d", kind: "biological" }] },
      { id: "u2", partnerIds: ["c", "e"], kind: "marriage", children: [{ personId: "g", kind: "biological" }, { personId: "h", kind: "biological" }] },
      { id: "u3", partnerIds: ["d", "f"], kind: "marriage", children: [{ personId: "i", kind: "biological" }, { personId: "j", kind: "biological" }] },
    ];
    const res = new LayoutSession({ persons: ps, unions: us }).layout({ focusId: "a", up: 0, down: 3, mode: "family" });
    const scene = buildScene(res, persons(ps), { lineMode: "orthogonal" });
    // Je Stamm (x, Schienenhöhe) die Spanne seiner Kinderlinien; gleiche Höhe heißt gleiche Spur
    const trunks = scene.edges.filter((e) => e.points.length === 4 && e.points[0] === e.points[2]);
    const spans = trunks.map((t) => {
      const x = t.points[0] as number, y = t.points[3] as number;
      const xs = scene.edges.filter((e) => e.points.length === 6 && e.points[0] === x && e.points[1] === y).map((e) => e.points[4] as number);
      return { y, min: Math.min(x, ...xs), max: Math.max(x, ...xs) };
    });
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i]!, b = spans[j]!;
        if (a.y === b.y) expect(a.max < b.min || b.max < a.min).toBe(true);
      }
    }
  });
});

describe("Beispiele", () => {
  it("baut für example/json eine Szene mit Culling-Index", () => {
    for (const f of ["cousin-marriage.json", "multiple-marriages.json"]) {
      const g = readTree(`example/json/${f}`);
      const first = g.persons[0]!;
      const res = new LayoutSession({ persons: g.persons, unions: g.unions }).layout({ focusId: first.id, up: 3, down: 3, mode: "all" });
      const scene = buildScene(res, new Map(g.persons.map((p) => [p.id, p])));
      expect(scene.cards.length).toBe(res.nodes.length);
      const all: number[] = [];
      scene.cardIndex.query(scene.bounds, (id) => all.push(id));
      expect(all.length).toBe(scene.cards.length);
    }
  });
});

const big = "example/performance/tree-50000.json";
describe.skipIf(!existsSync(big))("Performance: 50.000 Personen", () => {
  it("Szenenaufbau und Culling eines großen Ausschnitts sind schnell", () => {
    const g = readTree(big);
    const session = new LayoutSession({ persons: g.persons, unions: g.unions });
    const res = session.layout({ focusId: g.persons[0]!.id, up: 0, down: 30, mode: "direct" });
    expect(res.nodes.length).toBeGreaterThan(1000);
    const map = new Map(g.persons.map((p) => [p.id, p]));
    const t0 = performance.now();
    const scene = buildScene(res, map);
    const build = performance.now() - t0;

    // Culling eines Bildschirmausschnitts mitten im Baum
    const mid = scene.cards[Math.floor(scene.cards.length / 2)]!.node;
    const view = { minX: mid.x - 1000, maxX: mid.x + 1000, minY: mid.y - 600, maxY: mid.y + 600 };
    const t1 = performance.now();
    let seen = 0;
    scene.cardIndex.query(view, () => seen++);
    scene.edgeIndex.query(view, () => seen++);
    const cull = performance.now() - t1;
    console.log(`Szene: ${res.nodes.length} Karten, ${scene.edges.length} Linien, Aufbau ${build.toFixed(0)} ms, Culling ${cull.toFixed(2)} ms (${seen} Treffer)`);
    expect(build).toBeLessThan(2000);
    expect(cull).toBeLessThan(20);
    expect(seen).toBeLessThan(scene.cards.length + scene.edges.length);
  });
});
