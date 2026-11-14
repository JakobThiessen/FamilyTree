import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FamilyGraph, loadGraph, buildTimeline, dateRange, timelinePersonIds, parseFuzzyDate } from "../../src/core";
import type { Person, Union } from "../../src/core";

const load = (file: string) => loadGraph(readFileSync(`example/json/${file}`, "utf8"));
const d = (s: string) => parseFuzzyDate(s) ?? undefined;

describe("dateRange", () => {
  it("liefert Ränder für unscharfe Daten", () => {
    expect(dateRange(d("1800"))).toEqual({ from: 1800, to: 1800 });
    expect(dateRange(d("um 1750"))).toEqual({ from: 1747, to: 1753 });
    expect(dateRange(d("vor 1850"))).toEqual({ from: 1840, to: 1850 });
    expect(dateRange(d("nach 1700"))).toEqual({ from: 1700, to: 1710 });
    expect(dateRange(d("zwischen 1700 und 1710"))).toEqual({ from: 1700, to: 1710 });
    expect(dateRange(undefined)).toBeNull();
  });
});

describe("buildTimeline", () => {
  const g = load("cousin-marriage.json");

  it("Balken mit Geburt und Tod, sortiert nach Beginn", () => {
    const t = buildTimeline(g, timelinePersonIds(g, "p_9", "all"), { currentYear: 2026 });
    expect(t.rows.length + t.undated).toBe(9);
    const starts = t.rows.map((r) => r.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    const georg = t.rows.find((r) => r.personId === "p_1")!;
    expect(georg.start).toBe(1780);
    expect(georg.startDerived).toBe(false);
    expect(georg.markers.some((m) => m.kind === "child")).toBe(true);
    expect(t.minYear).toBeLessThanOrEqual(1780);
  });

  it("Auswahl lineage: Person, Vorfahren und Nachfahren, aber keine Seitenlinien", () => {
    const ids = timelinePersonIds(g, "p_3", "lineage", 5);
    expect(ids).toContain("p_1");
    expect(ids).toContain("p_9");
    expect(ids).not.toContain("p_6"); // Wilhelm: nur angeheiratet
    expect(timelinePersonIds(g, "nope", "lineage")).toEqual([]);
  });

  it("schätzt fehlende Daten aus der Umgebung und markiert sie", () => {
    const persons: Person[] = [
      { id: "a", sex: "M", givenNames: "A", birth: { date: d("1800") } },
      { id: "b", sex: "F", givenNames: "B" }, // kein Datum, Kind kommt 1830
      { id: "k", sex: "M", givenNames: "K", birth: { date: d("1830") } },
      { id: "x", sex: "U", givenNames: "X" }, // gar nichts
    ];
    const unions: Union[] = [
      { id: "u1", partnerIds: ["a", "b"], kind: "marriage", children: [{ personId: "k", kind: "biological" }] },
    ];
    const t = buildTimeline(new FamilyGraph({ persons, unions }), ["a", "b", "k", "x"], { currentYear: 2026 });
    const b = t.rows.find((r) => r.personId === "b")!;
    expect(b.start).toBe(1800); // 1830 − 30
    expect(b.startDerived).toBe(true);
    expect(b.endDerived).toBe(true);
    expect(t.rows.find((r) => r.personId === "a")!.end).toBe(1870); // 1800 + 70
    expect(t.undated).toBe(1);
  });

  it("begrenzt Zeilen um ein Jahr herum und hält Balken sichtbar", () => {
    const persons: Person[] = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      sex: "U" as const,
      givenNames: `P${i}`,
      birth: { date: d(String(1700 + i * 10)) },
      ...(i === 0 ? { death: { date: d("1690") } } : {}), // Tod vor Geburt
    }));
    const graph = new FamilyGraph({ persons, unions: [] });
    const t = buildTimeline(graph, persons.map((p) => p.id), { maxRows: 5, aroundYear: 1900, currentYear: 2026 });
    expect(t.truncated).toBe(true);
    expect(t.total).toBe(50);
    expect(t.rows).toHaveLength(5);
    expect(t.rows.map((r) => r.start)).toEqual([1880, 1890, 1900, 1910, 1920]);
    const one = buildTimeline(graph, ["p0"], { currentYear: 2026 });
    expect(one.rows[0]!.end).toBeGreaterThan(one.rows[0]!.start);
  });
});
