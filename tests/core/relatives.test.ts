// Verwandte hinzufügen (M10 Schritt 5): Planer + applyEdit, jeweils ein Undo-Schritt. Erfundene Personen.
import { describe, expect, it } from "vitest";
import { applyEdit, defaultUnion, EditSession, FamilyGraph, planRelative } from "../../src/core";
import type { RelativeSpec, TreeData } from "../../src/core";

/** Karl (1) ∞ Anna (2) → Cora (4); Karl ∞ Berta (3) → Dirk (5); Frieda (7) allein. */
function base(): TreeData {
  return {
    version: 1,
    persons: [
      { id: "p_1", givenNames: "Karl", surname: "Muster", sex: "M" },
      { id: "p_2", givenNames: "Anna", surname: "Muster", sex: "F" },
      { id: "p_3", givenNames: "Berta", surname: "Muster", sex: "F" },
      { id: "p_4", givenNames: "Cora", surname: "Muster", sex: "F" },
      { id: "p_5", givenNames: "Dirk", surname: "Muster", sex: "M" },
      { id: "p_7", givenNames: "Frieda", surname: "Allein", sex: "F" },
    ],
    unions: [
      { id: "u_1", partnerIds: ["p_1", "p_2"], kind: "marriage", children: [{ personId: "p_4", kind: "biological" }] },
      { id: "u_2", partnerIds: ["p_1", "p_3"], kind: "marriage", children: [{ personId: "p_5", kind: "biological" }] },
    ],
    sources: [],
  };
}
const fresh = { person: { givenNames: "Neu", surname: "Person", sex: "U" as const } };
const plan = (d: TreeData, s: RelativeSpec) => {
  const r = planRelative(d, s);
  if (!r.ok) throw new Error(`abgelehnt: ${r.reject.code}`);
  return r;
};
const apply = (d: TreeData, s: RelativeSpec) => {
  const r = plan(d, s);
  const e = applyEdit(d, r.op);
  if (!e.ok) throw new Error(`abgelehnt: ${e.reject.code}`);
  return { r, e };
};

describe("planRelative", () => {
  it("Elternteil: ohne Eltern neue Union, mit Platz in der Elternunion, sonst voll", () => {
    const d = base();
    const a = apply(d, { kind: "parent", focusId: "p_7", target: fresh });
    const u = a.e.data.unions.find((x) => x.id === a.r.unionId)!;
    expect(u.partnerIds).toEqual([a.r.personId]);
    expect(u.children).toEqual([{ personId: "p_7", kind: "biological" }]);

    // Dirk hat Karl und Berta: voll
    const full = planRelative(d, { kind: "parent", focusId: "p_5", target: fresh });
    expect(full).toEqual({ ok: false, reject: { code: "edit.reject.parents-full", params: { id: "p_5" } } });

    // Union mit einem Elternteil: zweiter Platz frei, keine zusätzliche Union
    const half = apply(a.e.data, { kind: "parent", focusId: "p_7", target: { person: { sex: "M" } } });
    expect(half.e.data.unions.find((x) => x.id === a.r.unionId)!.partnerIds).toHaveLength(2);
    expect(half.e.data.unions).toHaveLength(a.e.data.unions.length);
  });

  it("Partner: neue Union, oder Union mit freiem Platz wiederverwenden", () => {
    const d = base();
    const n = apply(d, { kind: "partner", focusId: "p_7", target: fresh });
    expect(n.e.data.unions).toHaveLength(3);
    expect(n.e.data.unions.find((x) => x.id === n.r.unionId)!.partnerIds).toEqual(["p_7", n.r.personId]);
    // Kind ohne Partner anlegen, dann Partner dazu: dieselbe Union
    const k = apply(d, { kind: "child", focusId: "p_7", target: fresh });
    expect(defaultUnion(k.e.data, "partner", "p_7")).toBe(k.r.unionId);
    const p = apply(k.e.data, { kind: "partner", focusId: "p_7", target: { person: { sex: "M" } } });
    expect(p.e.data.unions).toHaveLength(k.e.data.unions.length);
    // Karl hat zwei volle Unions: neue Union
    expect(defaultUnion(d, "partner", "p_1")).toBe("new");
  });

  it("Kind: Union wählen oder neue Union ohne Partner", () => {
    const d = base();
    const c = apply(d, { kind: "child", focusId: "p_1", unionId: "u_2", target: fresh });
    expect(c.e.data.unions.find((x) => x.id === "u_2")!.children.map((l) => l.personId)).toEqual(["p_5", c.r.personId]);
    expect(defaultUnion(d, "child", "p_2")).toBe("u_1"); // genau eine Union
    const n = apply(d, { kind: "child", focusId: "p_7", target: fresh });
    expect(n.e.data.unions.find((x) => x.id === n.r.unionId)!.partnerIds).toEqual(["p_7"]);
  });

  it("Geschwister: Kind in der Elternunion, ohne Eltern Union ohne Partner mit Hinweis", () => {
    const d = base();
    const s = apply(d, { kind: "sibling", focusId: "p_4", target: fresh });
    expect(s.r.unionId).toBe("u_1");
    expect(new FamilyGraph(s.e.data).children("p_1")).toContain(s.r.personId);
    expect(s.r.notes).toEqual([]);
    const lone = apply(d, { kind: "sibling", focusId: "p_7", target: fresh });
    const u = lone.e.data.unions.find((x) => x.id === lone.r.unionId)!;
    expect(u.partnerIds).toEqual([]);
    expect(u.children.map((c) => c.personId)).toEqual(["p_7", lone.r.personId]);
    expect(lone.r.notes[0]!.code).toBe("edit.note.sibling-without-parents");
  });

  it("vorhandene Person verknüpfen: keine neue Person; Zyklus und zweite Biologie werden abgelehnt", () => {
    const d = base();
    const l = apply(d, { kind: "partner", focusId: "p_7", target: { existingId: "p_5" } });
    expect(l.e.data.persons).toHaveLength(d.persons.length);
    // Cora ist Kind von Karl: Cora als Elternteil von Karl wäre ein Zyklus
    const cyc = planRelative(d, { kind: "parent", focusId: "p_1", target: { existingId: "p_4" } });
    const rc = cyc.ok ? applyEdit(d, cyc.op) : cyc;
    expect(!rc.ok && rc.reject.code).toBe("edit.reject.cycle");
    // Dirk hat schon leibliche Eltern: als Kind von Frieda wäre das eine zweite biologische Union
    const bio = planRelative(d, { kind: "child", focusId: "p_7", target: { existingId: "p_5" } });
    const rb = bio.ok ? applyEdit(d, bio.op) : bio;
    expect(!rb.ok && rb.reject.code).toBe("edit.reject.second-biological");
    expect(planRelative(d, { kind: "child", focusId: "p_7", target: { existingId: "p_7" } })).toMatchObject({ ok: false, reject: { code: "edit.reject.same-person" } });
  });

  it("Fehler: unbekannte Person und Union, Union gehört nicht zur Person", () => {
    const d = base();
    expect(planRelative(d, { kind: "child", focusId: "p_99", target: fresh })).toMatchObject({ ok: false, reject: { code: "edit.reject.person-not-found" } });
    expect(planRelative(d, { kind: "child", focusId: "p_1", unionId: "u_9", target: fresh })).toMatchObject({ ok: false, reject: { code: "edit.reject.union-not-found" } });
    expect(planRelative(d, { kind: "child", focusId: "p_3", unionId: "u_1", target: fresh })).toMatchObject({ ok: false, reject: { code: "edit.reject.union-not-of-person" } });
  });

  it("ein Knopfdruck = ein Undo-Schritt (Person und Union), Redo stellt wieder her", () => {
    const d = base();
    const s = new EditSession(d);
    const r = plan(d, { kind: "parent", focusId: "p_7", target: fresh });
    expect(s.apply(r.op).ok).toBe(true);
    expect(s.data.persons).toHaveLength(d.persons.length + 1);
    s.undo();
    expect(s.data.persons).toHaveLength(d.persons.length);
    expect(s.data.unions).toHaveLength(d.unions.length);
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(s.data.persons).toHaveLength(d.persons.length + 1);
  });

  it("Löschen einer Person mit Folgenhinweis, Undo stellt alles her", () => {
    const d = base();
    const s = new EditSession(d);
    const res = s.apply({ type: "deletePerson", id: "p_2" });
    expect(res.ok && res.notes.map((n) => n.code)).toContain("edit.note.person-removed-from-unions");
    s.undo();
    expect(s.data.unions.find((u) => u.id === "u_1")!.partnerIds).toEqual(["p_1", "p_2"]);
    expect(s.data.persons.some((p) => p.id === "p_2")).toBe(true);
  });
});
