// Formular „Verwandten hinzufügen“ und Folgenhinweis beim Löschen (M10 Schritt 5/6). Erfundene Personen.
import { describe, expect, it } from "vitest";
import { applyEdit } from "../../src/core";
import type { TreeData } from "../../src/core";
import { buildRelative, deleteConsequences, emptyRelativeForm, unionChoices } from "../../src/ui/relativeForm";

const data: TreeData = {
  version: 1,
  persons: [
    { id: "p_1", givenNames: "Karl", surname: "Muster", sex: "M" },
    { id: "p_2", givenNames: "Anna", surname: "Muster", sex: "F" },
    { id: "p_3", givenNames: "Berta", surname: "Muster", sex: "F" },
    { id: "p_4", givenNames: "Cora", surname: "Muster", sex: "F" },
    { id: "p_5", givenNames: "Dirk", surname: "Muster", sex: "M" },
  ],
  unions: [
    { id: "u_1", partnerIds: ["p_1", "p_2"], kind: "marriage", children: [{ personId: "p_4", kind: "biological" }] },
    { id: "u_2", partnerIds: ["p_1", "p_3"], kind: "marriage", children: [{ personId: "p_5", kind: "biological" }] },
    { id: "u_3", partnerIds: ["p_4"], kind: "unknown", children: [{ personId: "p_3", kind: "adopted" }] },
  ],
  sources: [],
};

describe("relativeForm", () => {
  it("Name ist Pflicht, Geburtsdatum wird geprüft", () => {
    const f = emptyRelativeForm(data, "child", "p_2");
    const r = buildRelative(data, "child", "p_2", f);
    expect(r).toMatchObject({ ok: false, errors: { givenNames: { key: "rel.err.name" } } });
    f.givenNames = "Emil";
    f.birth = "Quatsch";
    expect(buildRelative(data, "child", "p_2", f)).toMatchObject({ ok: false, errors: { birth: { key: "edit.err.date" } } });
    f.birth = "um 1850";
    const ok = buildRelative(data, "child", "p_2", f);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const e = applyEdit(data, ok.plan.op);
      expect(e.ok && e.data.persons.find((p) => p.id === ok.plan.personId)).toMatchObject({ givenNames: "Emil", birth: { date: { kind: "about", year: 1850 } } });
    }
  });

  it("vorhandene Person: Auswahl nötig; Ablehnung des Kerns kommt als reject", () => {
    const f = emptyRelativeForm(data, "parent", "p_1");
    f.mode = "existing";
    expect(buildRelative(data, "parent", "p_1", f)).toMatchObject({ ok: false, errors: { existing: { key: "rel.err.existing" } } });
    f.existingId = "p_4"; // Kind von Karl als Elternteil von Karl
    const r = buildRelative(data, "parent", "p_1", f);
    expect(r.ok).toBe(true); // geplant; der Zyklus fällt erst beim Anwenden auf
    if (r.ok) expect(applyEdit(data, r.plan.op)).toMatchObject({ ok: false, reject: { code: "edit.reject.cycle" } });
    // Karl hat keine Eltern, Cora hat Eltern voll: "parents-full" schon im Planer
    const full = buildRelative(data, "parent", "p_4", { ...emptyRelativeForm(data, "parent", "p_4"), givenNames: "X" });
    expect(full).toMatchObject({ ok: false, reject: { code: "edit.reject.parents-full" } });
  });

  it("Union-Auswahl nennt Partner bzw. Eltern", () => {
    const c = unionChoices(data, "child", "p_1", "unbekannt");
    expect(c.map((x) => x.value)).toEqual(["u_1", "u_2", "new"]);
    expect(c[0]!.vars?.who).toBe("Anna Muster");
    const s = unionChoices(data, "sibling", "p_3", "unbekannt");
    expect(s.map((x) => x.value)).toEqual(["u_3"]); // Berta ist nur in u_3 Kind (adoptiert)
    expect(unionChoices(data, "sibling", "p_1", "unbekannt").map((x) => x.value)).toEqual(["new"]);
    expect(unionChoices(data, "partner", "p_4", "unbekannt").map((x) => x.value)).toEqual(["u_3", "new"]);
    expect(unionChoices(data, "parent", "p_5", "unbekannt")).toEqual([]);
  });

  it("Löschvorschau: Hinweise des Kerns, Kinder ohne Elternteil; speichert nichts", () => {
    const before = JSON.stringify(data);
    const c = deleteConsequences(data, "p_4")!;
    expect(c.notes.map((n) => n.code)).toContain("edit.note.person-removed-from-unions");
    expect(c.orphans).toBe(1); // u_3: Berta (adoptiert) bleibt ohne Elternteil
    expect(deleteConsequences(data, "p_9")).toBeUndefined();
    expect(JSON.stringify(data)).toBe(before);
  });
});
