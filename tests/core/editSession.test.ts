import { describe, expect, it } from "vitest";
import { EditSession, type SessionResult, type TreeData } from "../../src/core";

/** Erfundene Familie: Karl und Anna mit Tochter Cora. */
function base(): TreeData {
  return {
    version: 1,
    persons: [
      { id: "p_1", givenNames: "Karl", surname: "Muster", sex: "M" },
      { id: "p_2", givenNames: "Anna", surname: "Muster", sex: "F" },
      { id: "p_3", givenNames: "Cora", surname: "Muster", sex: "F" },
    ],
    unions: [{ id: "u_1", partnerIds: ["p_1", "p_2"], kind: "marriage", order: 1, children: [{ personId: "p_3", kind: "biological" }] }],
    sources: [],
  };
}
const ok = (r: SessionResult) => {
  if (!r.ok) throw new Error(`abgelehnt: ${r.reject.code}`);
  return r;
};
const names = (d: TreeData) => d.persons.map((p) => p.givenNames).sort();

describe("EditSession", () => {
  it("wendet an, macht rückgängig und wiederholt", () => {
    const s = new EditSession(base());
    expect(s.canUndo || s.canRedo).toBe(false);
    const r = ok(s.apply({ type: "addPerson", person: { givenNames: "Dirk", surname: "Muster", sex: "M" } }));
    expect(r.created.persons).toEqual(["p_4"]);
    expect(names(s.data)).toContain("Dirk");
    expect(s.canUndo).toBe(true);

    const u = ok(s.undo());
    expect(u.kind).toBe("undo");
    expect(u.touched.persons).toEqual(["p_4"]);
    expect(names(s.data)).not.toContain("Dirk");
    expect(s.canRedo).toBe(true);

    ok(s.redo());
    expect(names(s.data)).toContain("Dirk");
    expect(s.canRedo).toBe(false);
  });

  it("leert den Wiederholen-Stapel bei einer neuen Operation", () => {
    const s = new EditSession(base());
    ok(s.apply({ type: "updatePerson", person: { id: "p_1", givenNames: "Karl-Heinz", surname: "Muster", sex: "M" } }));
    ok(s.undo());
    expect(s.canRedo).toBe(true);
    ok(s.apply({ type: "updatePerson", person: { id: "p_1", givenNames: "Karlo", surname: "Muster", sex: "M" } }));
    expect(s.canRedo).toBe(false);
  });

  it("lehnt ab, ohne den Stand oder die Stapel zu ändern", () => {
    const s = new EditSession(base());
    const before = s.data;
    const r = s.apply({ type: "deletePerson", id: "p_99" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject).toEqual({ code: "edit.reject.person-not-found", params: { id: "p_99" } });
    expect(s.data).toBe(before);
    expect(s.canUndo).toBe(false);
    expect(s.changesSinceSave).toBe(0);
  });

  it("meldet nichts zum Rückgängig/Wiederholen mit eigenem Code", () => {
    const s = new EditSession(base());
    const u = s.undo();
    const r = s.redo();
    expect(!u.ok && u.reject.code).toBe("edit.reject.nothing-to-undo");
    expect(!r.ok && r.reject.code).toBe("edit.reject.nothing-to-redo");
  });

  it("Person löschen und zurückholen stellt die Union samt Kind her; Hinweise kommen mit", () => {
    const s = new EditSession(base());
    const del = ok(s.apply({ type: "deletePerson", id: "p_2" }));
    expect(del.notes.map((n) => n.code)).toContain("edit.note.person-removed-from-unions");
    expect(s.data.unions[0]!.partnerIds).toEqual(["p_1"]);
    ok(s.undo());
    expect(s.data.unions[0]!.partnerIds).toEqual(["p_1", "p_2"]);
    expect(s.data.persons.map((p) => p.id)).toContain("p_2");
  });

  it("begrenzt den Rückgängig-Stapel", () => {
    const s = new EditSession(base(), 3);
    for (let i = 0; i < 5; i++)
      ok(s.apply({ type: "updatePerson", person: { id: "p_1", givenNames: `K${i}`, surname: "Muster", sex: "M" } }));
    let undone = 0;
    while (s.canUndo) {
      ok(s.undo());
      undone++;
    }
    expect(undone).toBe(3);
    expect(s.data.persons[0]!.givenNames).toBe("K1"); // die ersten zwei Schritte sind nicht mehr umkehrbar
  });

  it("zählt Änderungen seit der Sicherung und setzt sie zurück", () => {
    const s = new EditSession(base());
    ok(s.apply({ type: "updatePerson", person: { id: "p_1", givenNames: "X", surname: "Muster", sex: "M" } }));
    ok(s.undo());
    expect(s.changesSinceSave).toBe(2);
    s.markSaved();
    expect(s.changesSinceSave).toBe(0);
    ok(s.redo());
    expect(s.changesSinceSave).toBe(1);
  });

  it("reset beginnt mit neuem Baum und leeren Stapeln", () => {
    const s = new EditSession(base());
    ok(s.apply({ type: "addPerson", person: { givenNames: "Dirk", surname: "Muster", sex: "M" } }));
    s.reset(base());
    expect(s.canUndo).toBe(false);
    expect(s.changesSinceSave).toBe(0);
    expect(s.data.persons).toHaveLength(3);
  });
});
