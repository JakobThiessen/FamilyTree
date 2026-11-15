// Formular „Person bearbeiten“ (M10 Schritt 4): Prüfen, Entfernen leerer Felder, neue Quellen, Undo als ein Schritt.
import { describe, expect, it } from "vitest";
import { applyEdit, EditSession } from "../../src/core";
import type { Person, TreeData } from "../../src/core";
import { buildEdit, emptyCitation, formChanged, NEW_SOURCE, personToForm } from "../../src/ui/personForm";

const person: Person = {
  id: "p_1",
  givenNames: "Erika",
  surname: "Beispiel",
  sex: "F",
  birth: { date: { kind: "exact", year: 1850, month: 3, day: 12, text: "12. März 1850" }, place: { name: "Musterstadt", lat: 48.1, lon: 11.5 }, citations: [{ sourceId: "s_1", detail: "S. 4" }] },
  notes: ["Erste Notiz", "Zweite Notiz"],
  externalRefs: [{ system: "gedcom", id: "@I1@" }],
};
const data: TreeData = { version: 1, persons: [person], unions: [], sources: [{ id: "s_1", title: "Kirchenbuch" }] };

const run = (mutate: (f: ReturnType<typeof personToForm>) => void) => {
  const f = personToForm(person);
  mutate(f);
  return buildEdit(person, f, data.sources);
};

describe("personForm", () => {
  it("unverändertes Formular ergibt dieselbe Person und gilt nicht als geändert", () => {
    const f = personToForm(person);
    expect(formChanged(f, personToForm(person))).toBe(false);
    const r = buildEdit(person, f, data.sources);
    expect(r.ok && r.op).toEqual({ type: "updatePerson", person });
  });

  it("leere Felder werden entfernt, Fremdfelder bleiben", () => {
    const r = run((f) => {
      f.givenNames = "  ";
      f.birth.date = "";
      f.birth.place = "";
      f.birth.lat = "";
      f.birth.lon = "";
      f.birth.citations = [];
      f.notes = "";
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.op.type !== "updatePerson") throw new Error();
    const p = r.op.person;
    expect("givenNames" in p).toBe(false);
    expect("birth" in p).toBe(false);
    expect("notes" in p).toBe(false);
    expect(p.externalRefs).toEqual(person.externalRefs);
    expect(p.surname).toBe("Beispiel");
  });

  it("liest Datum, Komma-Koordinaten und Status", () => {
    const r = run((f) => {
      f.death.date = "um 1900";
      f.death.place = "Anderswo";
      f.death.lat = "47,5";
      f.death.lon = "-8";
      f.death.status = "assumed";
    });
    if (!r.ok || r.op.type !== "updatePerson") throw new Error();
    expect(r.op.person.death).toEqual({
      date: expect.objectContaining({ kind: "about", year: 1900 }),
      place: { name: "Anderswo", lat: 47.5, lon: -8 },
      status: "assumed",
    });
  });

  it("meldet ungültige Eingaben je Feld und baut nichts", () => {
    const r = run((f) => {
      f.birth.date = "irgendwann";
      f.death.place = "X";
      f.death.lat = "95";
      f.death.lon = "abc";
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["birth.date", "death.lat", "death.lon"]);
    expect(r.errors["birth.date"]!.key).toBe("edit.err.date");
  });

  it("Koordinaten nur paarweise und nur mit Ortsnamen", () => {
    const a = run((f) => {
      f.birth.lon = "";
    });
    expect(!a.ok && a.errors["birth.lon"]!.key).toBe("edit.err.coordPair");
    const b = run((f) => {
      f.birth.place = "";
    });
    expect(!b.ok && b.errors["birth.place"]!.key).toBe("edit.err.placeName");
  });

  it("unveränderter, unlesbarer Altdatumstext bleibt erhalten", () => {
    const odd: Person = { ...person, birth: { date: { kind: "exact", text: "Frühling anno dazumal" } } };
    const f = personToForm(odd);
    const r = buildEdit(odd, f, data.sources);
    if (!r.ok || r.op.type !== "updatePerson") throw new Error();
    expect(r.op.person.birth!.date).toEqual({ kind: "exact", text: "Frühling anno dazumal" });
  });

  it("Zitate: Auswahl, Fundstelle ohne Quelle, unbekannte Quelle", () => {
    const a = run((f) => {
      f.death.citations = [{ ...emptyCitation(), detail: "S. 1" }];
    });
    expect(!a.ok && a.errors["death.cite.0"]!.key).toBe("edit.err.sourcePick");
    const b = run((f) => {
      f.birth.citations = [{ ...emptyCitation(), sourceId: "s_99" }];
    });
    expect(!b.ok && b.errors["birth.cite.0"]!.key).toBe("edit.err.sourceGone");
    const c = run((f) => {
      f.birth.citations = [{ ...emptyCitation(), sourceId: NEW_SOURCE }];
    });
    expect(!c.ok && c.errors["birth.cite.0"]!.key).toBe("edit.err.sourceTitle");
    const d = run((f) => {
      f.birth.citations = [{ ...emptyCitation(), sourceId: NEW_SOURCE, newTitle: "X", newUrl: "javascript:1" }];
    });
    expect(!d.ok && d.errors["birth.cite.0"]!.key).toBe("edit.err.sourceUrl");
  });

  it("Notizen: ein Absatz je Notiz", () => {
    const r = run((f) => {
      f.notes = "Eins\n\nZwei\n\n\nDrei";
    });
    if (!r.ok || r.op.type !== "updatePerson") throw new Error();
    expect(r.op.person.notes).toEqual(["Eins", "Zwei", "Drei"]);
  });

  it("neue Quelle: ein patch, ein Undo-Schritt, Zitat zeigt auf die neue ID", () => {
    const r = run((f) => {
      f.death.date = "1900";
      f.death.citations = [{ ...emptyCitation(), sourceId: NEW_SOURCE, newTitle: "Sterbebuch", newUrl: "https://example.org/x", detail: "Nr. 7" }];
    });
    if (!r.ok) throw new Error();
    expect(r.op.type).toBe("patch");
    const s = new EditSession(data);
    const res = s.apply(r.op);
    expect(res.ok).toBe(true);
    expect(s.data.sources.map((x) => x.id)).toEqual(["s_1", "s_2"]);
    expect(s.data.sources[1]).toEqual({ id: "s_2", title: "Sterbebuch", url: "https://example.org/x" });
    expect(s.data.persons[0]!.death!.citations).toEqual([{ sourceId: "s_2", detail: "Nr. 7" }]);
    s.undo();
    expect(s.data).toEqual(data);
    expect(s.canUndo).toBe(false);
  });

  it("gespeicherte Person geht durch applyEdit", () => {
    const r = run((f) => {
      f.surname = "Neu";
    });
    if (!r.ok) throw new Error();
    const res = applyEdit(data, r.op);
    expect(res.ok && res.data.persons[0]!.surname).toBe("Neu");
  });
});
