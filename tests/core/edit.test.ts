import { describe, expect, it } from "vitest";
import { applyEdit, changesFromTouched, FamilyGraph, type EditOp, type EditResult, type TreeData } from "../../src/core";

/** Erfundene Familie: Karl hat zwei Ehen (Anna, dann Berta); Kinder Cora (mit Anna), Dirk und Eva (mit Berta). */
function base(): TreeData {
  return {
    version: 1,
    persons: [
      { id: "p_1", givenNames: "Karl", surname: "Muster", sex: "M" },
      { id: "p_2", givenNames: "Anna", surname: "Muster", sex: "F" },
      { id: "p_3", givenNames: "Berta", surname: "Muster", sex: "F" },
      { id: "p_4", givenNames: "Cora", surname: "Muster", sex: "F" },
      { id: "p_5", givenNames: "Dirk", surname: "Muster", sex: "M" },
      { id: "p_6", givenNames: "Eva", surname: "Muster", sex: "F" },
    ],
    unions: [
      { id: "u_1", partnerIds: ["p_1", "p_2"], kind: "marriage", order: 1, children: [{ personId: "p_4", kind: "biological" }] },
      {
        id: "u_2",
        partnerIds: ["p_1", "p_3"],
        kind: "marriage",
        order: 2,
        children: [
          { personId: "p_5", kind: "biological" },
          { personId: "p_6", kind: "biological" },
        ],
      },
    ],
    sources: [{ id: "s_1", title: "Testquelle" }],
  };
}

const norm = (d: TreeData): TreeData => {
  const by = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  return { ...d, persons: by(d.persons), unions: by(d.unions), sources: by(d.sources) };
};
const ok = (r: EditResult) => {
  if (!r.ok) throw new Error(`abgelehnt: ${r.reject.code}`);
  return r;
};
const code = (r: EditResult) => (r.ok ? undefined : r.reject.code);

/** Op anwenden, Umkehr anwenden: ergibt den Ausgangszustand; Umkehr der Umkehr (Redo) ergibt den neuen Stand. */
function roundTrip(data: TreeData, op: EditOp) {
  const before = structuredClone(data);
  const r = ok(applyEdit(data, op));
  expect(data).toEqual(before); // Eingabe unverändert
  const back = ok(applyEdit(r.data, r.inverse));
  expect(norm(back.data)).toEqual(norm(before));
  const again = ok(applyEdit(back.data, back.inverse));
  expect(norm(again.data)).toEqual(norm(r.data));
  return r;
}

describe("Person anlegen, ändern", () => {
  it("vergibt fortlaufende IDs und kann zurückgenommen werden", () => {
    const r = roundTrip(base(), { type: "addPerson", person: { givenNames: "Fritz", sex: "M" } });
    expect(r.created.persons).toEqual(["p_7"]);
    expect(r.touched.persons).toEqual(["p_7"]);
    expect(r.data.persons.at(-1)?.givenNames).toBe("Fritz");
  });

  it("ändert eine Person; unbekannte Person wird abgelehnt", () => {
    const r = roundTrip(base(), { type: "updatePerson", person: { id: "p_4", givenNames: "Cora-Marie", sex: "F" } });
    expect(r.data.persons.find((p) => p.id === "p_4")?.givenNames).toBe("Cora-Marie");
    expect(r.touched).toEqual({ persons: ["p_4"], unions: [], sources: [] });
    const bad = applyEdit(base(), { type: "updatePerson", person: { id: "p_99", sex: "U" } });
    expect(bad).toEqual({ ok: false, reject: { code: "edit.reject.person-not-found", params: { id: "p_99" } } });
  });

  it("lehnt Zitate auf unbekannte Quellen ab", () => {
    const r = applyEdit(base(), { type: "addPerson", person: { sex: "U", birth: { citations: [{ sourceId: "s_9" }] } } });
    expect(code(r)).toBe("edit.reject.unknown-source");
  });
});

describe("Person löschen", () => {
  it("Kinder bleiben in der Union, Partner wird entfernt; Hinweis als Code", () => {
    const r = roundTrip(base(), { type: "deletePerson", id: "p_3" });
    const u2 = r.data.unions.find((u) => u.id === "u_2");
    expect(u2?.partnerIds).toEqual(["p_1"]);
    expect(u2?.children).toHaveLength(2);
    expect(r.notes.map((n) => n.code)).toEqual(["edit.note.person-removed-from-unions"]);
    expect(r.notes[0]?.params).toEqual({ id: "p_3", unions: 1 });
  });

  it("beide Partner weg: Union mit Kindern bleibt (ohne Partner), mit Hinweis", () => {
    const d = ok(applyEdit(base(), { type: "deletePerson", id: "p_1" })).data;
    const r = ok(applyEdit(d, { type: "deletePerson", id: "p_3" }));
    expect(r.data.unions.find((u) => u.id === "u_2")?.partnerIds).toEqual([]);
    expect(r.notes.map((n) => n.code)).toContain("edit.note.union-without-partners");
  });

  it("Union ohne Partner und ohne Kinder verschwindet; Undo stellt sie her", () => {
    const d = base();
    d.unions.push({ id: "u_3", partnerIds: ["p_4"], kind: "unknown", children: [] });
    const r = roundTrip(d, { type: "deletePerson", id: "p_4" });
    expect(r.data.unions.map((u) => u.id)).toEqual(["u_1", "u_2"]);
    expect(r.data.unions.find((u) => u.id === "u_1")?.children).toEqual([]);
    expect([...r.touched.unions].sort()).toEqual(["u_1", "u_3"]);
    expect(r.notes.map((n) => n.code)).toContain("edit.note.unions-removed-empty");
  });

  it("Kind löschen entfernt die Kind-Verknüpfung", () => {
    const r = roundTrip(base(), { type: "deletePerson", id: "p_5" });
    expect(r.data.unions[1]?.children.map((c) => c.personId)).toEqual(["p_6"]);
  });
});

describe("Unions", () => {
  it("legt eine dritte Union an (Mehrfach-Ehe)", () => {
    const r = roundTrip(base(), { type: "addUnion", union: { partnerIds: ["p_1"], kind: "partnership", order: 3, children: [] } });
    expect(r.created.unions).toEqual(["u_3"]);
    expect(new FamilyGraph(r.data).unionsOf("p_1").length).toBe(3);
  });

  it("lehnt mehr als 2 Partner, doppelte und unbekannte Partner ab", () => {
    const mk = (partnerIds: string[]) =>
      applyEdit(base(), { type: "addUnion", union: { partnerIds, kind: "unknown", children: [] } });
    expect(code(mk(["p_1", "p_2", "p_3"]))).toBe("edit.reject.too-many-partners");
    expect(code(mk(["p_1", "p_1"]))).toBe("edit.reject.duplicate-partner");
    expect(code(mk(["p_1", "p_99"]))).toBe("edit.reject.unknown-partner");
  });

  it("ändert und löscht Unions (Undo stellt Kinderreihenfolge her)", () => {
    roundTrip(base(), { type: "updateUnion", union: { ...base().unions[0]!, kind: "partnership", endReason: "divorce" } });
    const r = roundTrip(base(), { type: "deleteUnion", id: "u_2" });
    expect(r.notes[0]).toEqual({ code: "edit.note.union-children-unlinked", params: { id: "u_2", children: 2 } });
    expect(code(applyEdit(base(), { type: "deleteUnion", id: "u_9" }))).toBe("edit.reject.union-not-found");
  });
});

describe("Kinder verknüpfen und lösen", () => {
  it("verknüpft ein Kind, löst es wieder; leere Union verschwindet beim Lösen", () => {
    const d = ok(applyEdit(base(), { type: "addPerson", person: { givenNames: "Gabi", sex: "F" } })).data; // p_7
    const r = roundTrip(d, { type: "linkChild", unionId: "u_1", personId: "p_7" });
    expect(r.data.unions[0]?.children.map((c) => c.personId)).toEqual(["p_4", "p_7"]);
    expect(r.touched.unions).toEqual(["u_1"]);

    const single = ok(
      applyEdit(d, { type: "addUnion", union: { partnerIds: [], kind: "unknown", children: [{ personId: "p_7", kind: "adopted" }] } }),
    );
    const un = roundTrip(single.data, { type: "unlinkChild", unionId: "u_3", personId: "p_7" });
    expect(un.data.unions.some((u) => u.id === "u_3")).toBe(false);
    expect(un.notes[0]?.code).toBe("edit.note.unions-removed-empty");
  });

  it("lehnt Doppel-Verknüpfung, unbekanntes und nicht verknüpftes Kind ab", () => {
    expect(code(applyEdit(base(), { type: "linkChild", unionId: "u_1", personId: "p_4" }))).toBe("edit.reject.child-already-linked");
    expect(code(applyEdit(base(), { type: "linkChild", unionId: "u_1", personId: "p_99" }))).toBe("edit.reject.unknown-child");
    expect(code(applyEdit(base(), { type: "unlinkChild", unionId: "u_1", personId: "p_5" }))).toBe("edit.reject.child-not-linked");
  });

  it("ein Kind höchstens in einer biologischen Union, Adoption zusätzlich erlaubt", () => {
    const bio = applyEdit(base(), { type: "linkChild", unionId: "u_1", personId: "p_5" });
    expect(bio).toEqual({
      ok: false,
      reject: { code: "edit.reject.second-biological", params: { child: "p_5", union: "u_1", other: "u_2" } },
    });
    const adopted = ok(applyEdit(base(), { type: "linkChild", unionId: "u_1", personId: "p_5", kind: "adopted", status: "assumed" }));
    expect(adopted.data.unions[0]?.children.at(-1)).toEqual({ personId: "p_5", kind: "adopted", status: "assumed" });
  });

  it("lehnt Zyklen ab", () => {
    // Cora bekommt Kind Hans (u_3); Karl (Vorfahr) darf nicht Kind von Hans werden
    let d = ok(applyEdit(base(), { type: "addPerson", person: { givenNames: "Hans", sex: "M" } })).data; // p_7
    d = ok(
      applyEdit(d, { type: "addUnion", union: { partnerIds: ["p_4"], kind: "unknown", children: [{ personId: "p_7", kind: "biological" }] } }),
    ).data; // u_3
    const r = applyEdit(d, {
      type: "addUnion",
      union: { partnerIds: ["p_7"], kind: "unknown", children: [{ personId: "p_1", kind: "biological" }] },
    });
    expect(r).toEqual({ ok: false, reject: { code: "edit.reject.cycle", params: { parent: "p_7", child: "p_1" } } });
    // Kind als Partner der eigenen Union
    expect(code(applyEdit(d, { type: "linkChild", unionId: "u_3", personId: "p_4" }))).toBe("edit.reject.child-is-partner");
    // Hans als Elternteil von Cora, obwohl Cora seine Mutter ist
    const u1 = { ...d.unions[0]!, partnerIds: ["p_7", "p_2"] };
    expect(code(applyEdit(d, { type: "updateUnion", union: u1 }))).toBe("edit.reject.cycle");
  });
});

describe("Quellen", () => {
  it("legt Quelle an und ändert sie; Undo nimmt zurück", () => {
    const r = roundTrip(base(), { type: "addSource", source: { title: "Kirchenbuch" } });
    expect(r.created.sources).toEqual(["s_2"]);
    roundTrip(base(), { type: "updateSource", source: { id: "s_1", title: "Neu", url: "https://example.org" } });
    expect(code(applyEdit(base(), { type: "updateSource", source: { id: "s_9", title: "x" } }))).toBe("edit.reject.source-not-found");
  });
});

describe("Änderungsliste", () => {
  it("changesFromTouched trennt Schreiben und Löschen", () => {
    const r = ok(applyEdit(base(), { type: "deletePerson", id: "p_4" }));
    const c = changesFromTouched(r.data, r.touched);
    expect(c.deletePersons).toEqual(["p_4"]);
    expect(c.putUnions.map((u) => u.id)).toEqual(["u_1"]);
    expect(c.putPersons).toEqual([]);
  });

  it("Kette aus Operationen lässt sich Schritt für Schritt zurücknehmen", () => {
    let d = base();
    const inverses: EditOp[] = [];
    const ops: EditOp[] = [
      { type: "addPerson", person: { givenNames: "Hans", sex: "M" } },
      { type: "linkChild", unionId: "u_1", personId: "p_7" },
      { type: "deletePerson", id: "p_1" },
      { type: "addSource", source: { title: "Q" } },
    ];
    const snaps = [norm(d)];
    for (const op of ops) {
      const r = ok(applyEdit(d, op));
      d = r.data;
      inverses.push(r.inverse);
      snaps.push(norm(d));
    }
    for (let i = ops.length - 1; i >= 0; i--) {
      d = ok(applyEdit(d, inverses[i]!)).data;
      expect(norm(d)).toEqual(snaps[i]);
    }
  });
});
