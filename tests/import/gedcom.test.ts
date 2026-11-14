import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FamilyGraph,
  parseTreeJson,
  serializeTreeData,
  type Person,
  type TreeData,
  type Union,
} from "../../src/core";
import {
  decodeAnsel,
  decodeGedcom,
  exportGedcom,
  formatGedcomDate,
  importFileContent,
  importGedcom,
  parseGedcomDate,
  parseGedcomName,
  parseGedcomText,
} from "../../src/import";

const ged = (f: string) => readFileSync(`example/gedcom/${f}`);
const json = (f: string): TreeData => parseTreeJson(readFileSync(`example/json/${f}`, "utf8"));

/** Entfernt `text` (Originaltext unterscheidet sich je Format) rekursiv, damit Strukturen vergleichbar sind. */
function stripText<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, x) => (k === "text" ? undefined : x)));
}

/** Vergleichbare Form: nur Felder, die GEDCOM und die handgeschriebenen JSON-Beispiele gemeinsam haben. */
function core(data: TreeData) {
  const person = (p: Person) => stripText({ id: p.id, givenNames: p.givenNames, surname: p.surname, sex: p.sex, birth: p.birth, death: p.death });
  const union = (u: Union) =>
    stripText({ id: u.id, partnerIds: u.partnerIds, kind: u.kind, order: u.order, start: u.start, children: u.children.map((c) => ({ personId: c.personId, kind: c.kind })) });
  return { persons: data.persons.map(person), unions: data.unions.map(union) };
}

describe("GEDCOM-Datum", () => {
  it.each([
    ["12 MAR 1800", { kind: "exact", year: 1800, month: 3, day: 12 }],
    ["MAR 1800", { kind: "exact", year: 1800, month: 3 }],
    ["1800", { kind: "exact", year: 1800 }],
    ["ABT 1802", { kind: "about", year: 1802 }],
    ["CAL 1802", { kind: "about", year: 1802 }],
    ["EST 1802", { kind: "about", year: 1802 }],
    ["BEF 1850", { kind: "before", year: 1850 }],
    ["AFT 1700", { kind: "after", year: 1700 }],
    ["BET 1700 AND 1710", { kind: "between", year: 1700, yearTo: 1710 }],
    ["FROM 1700 TO 1710", { kind: "between", year: 1700, yearTo: 1710 }],
    ["FROM 1700", { kind: "after", year: 1700 }],
    ["TO 1700", { kind: "before", year: 1700 }],
    ["abt 5 jan 1750", { kind: "about", year: 1750, month: 1, day: 5 }],
    ["1750/51", { kind: "exact", year: 1750 }],
    ["@#DJULIAN@ 3 APR 1650", { kind: "exact", year: 1650, month: 4, day: 3 }],
  ])("liest %s", (input, expected) => {
    expect(stripText(parseGedcomDate(input))).toEqual(expected);
  });

  it("lehnt Unlesbares ab", () => {
    for (const bad of ["", "(irgendwann)", "31 FEB 1800", "BET 1710 AND 1700", "12 XYZ 1800", "ABT"]) {
      expect(parseGedcomDate(bad), bad).toBeNull();
    }
  });

  it("schreibt zurück und bewahrt den Originaltext", () => {
    expect(formatGedcomDate({ kind: "about", year: 1802 })).toBe("ABT 1802");
    expect(formatGedcomDate({ kind: "between", year: 1700, yearTo: 1710 })).toBe("BET 1700 AND 1710");
    expect(formatGedcomDate({ kind: "exact", year: 1800, month: 3, day: 12 })).toBe("12 MAR 1800");
    expect(formatGedcomDate(parseGedcomDate("CAL 1802")!)).toBe("CAL 1802");
    // Text aus dem deutschen Datumsparser passt nicht zum GEDCOM-Format und wird neu geschrieben.
    expect(formatGedcomDate({ kind: "about", year: 1802, text: "um 1802" })).toBe("ABT 1802");
    expect(formatGedcomDate({ kind: "about", text: "irgendwann" })).toBe("(irgendwann)");
  });
});

describe("Zeichensätze", () => {
  const body = "0 HEAD\n1 CHAR %CS%\n0 @I1@ INDI\n1 NAME Jürgen /Müller/\n0 TRLR\n";
  const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

  it("UTF-8 mit und ohne BOM", () => {
    const text = body.replace("%CS%", "UTF-8");
    expect(importGedcom(Buffer.from(text, "utf8")).data.persons[0]?.givenNames).toBe("Jürgen");
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
    expect(decodeGedcom(bom).charset).toBe("utf-8");
    expect(importGedcom(bom).data.persons[0]?.surname).toBe("Müller");
  });

  it("ISO-8859-1 / ANSI", () => {
    const r = importGedcom(latin1(body.replace("%CS%", "ISO-8859-1")));
    expect(r.charset).toBe("windows-1252");
    expect(r.data.persons[0]).toMatchObject({ givenNames: "Jürgen", surname: "Müller" });
  });

  it("ANSEL: Akzent vor dem Buchstaben, Sonderzeichen", () => {
    // ANSEL: E8 = Trema, steht vor dem Buchstaben; B5 = æ, CF = ß
    const bytes = Uint8Array.from([...Buffer.from("0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME J", "latin1"), 0xe8, 0x75, ...Buffer.from("rgen /M", "latin1"), 0xe8, 0x75, ...Buffer.from("ller/ ", "latin1"), 0xb5, 0xcf, ...Buffer.from("\n0 TRLR\n", "latin1")]);
    const r = importGedcom(bytes);
    expect(r.charset).toBe("ansel");
    expect(r.data.persons[0]).toMatchObject({ givenNames: "Jürgen", surname: "Müller" });
    expect(decodeAnsel(Uint8Array.from([0xe2, 0x65]))).toBe("é");
  });

  it("UTF-16 mit BOM", () => {
    const text = body.replace("%CS%", "UNICODE");
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(importGedcom(bytes).data.persons[0]?.givenNames).toBe("Jürgen");
  });

  it("ohne CHAR-Zeile: UTF-8 oder ersatzweise Windows-1252", () => {
    const t = "0 HEAD\n0 @I1@ INDI\n1 NAME Jürgen /X/\n0 TRLR\n";
    expect(importGedcom(Buffer.from(t, "utf8")).charset).toBe("utf-8");
    expect(importGedcom(latin1(t)).charset).toBe("windows-1252");
  });
});

describe("Zeilenparser", () => {
  it("verbindet CONC/CONT und liest Xrefs", () => {
    const { records, warnings } = parseGedcomText("0 @N1@ NOTE Anfang\r\n1 CONC  und mehr\r\n1 CONT zweite Zeile\r\n0 TRLR");
    expect(warnings).toEqual([]);
    expect(records[0]).toMatchObject({ xref: "N1", tag: "NOTE", value: "Anfang und mehr\nzweite Zeile" });
  });

  it("überspringt kaputte Zeilen mit Warnung", () => {
    const { records, warnings } = parseGedcomText("0 HEAD\nMüll\n2 DATE 1800\n1 CHAR UTF-8\n\n0 TRLR");
    expect(records.map((r) => r.tag)).toEqual(["HEAD", "TRLR"]);
    expect(warnings.map((w) => w.line)).toEqual([2, 3]);
  });

  it("Namen", () => {
    expect(parseGedcomName("Johann Georg /Beispiel/")).toEqual({ givenNames: "Johann Georg", surname: "Beispiel" });
    expect(parseGedcomName("/Beispiel/")).toEqual({ surname: "Beispiel" });
    expect(parseGedcomName("Johann //")).toEqual({ givenNames: "Johann" });
    expect(parseGedcomName("Nur Vorname")).toEqual({ givenNames: "Nur Vorname" });
    expect(parseGedcomName("")).toEqual({});
  });
});

describe("Import der Beispiele passt zu example/json", () => {
  for (const name of ["multiple-marriages", "cousin-marriage"]) {
    it(name, () => {
      const r = importGedcom(ged(`${name}.ged`));
      expect(r.warnings).toEqual([]);
      expect(new FamilyGraph(r.data).validate()).toEqual([]);
      expect(core(r.data)).toEqual(core(json(`${name}.json`)));
    });
  }

  it("Mehrfach-Ehen: Reihenfolge, Kinder an der richtigen Union, GEDCOM-IDs", () => {
    const { data } = importGedcom(ged("multiple-marriages.ged"));
    const g = new FamilyGraph(data);
    expect(g.partners("p_1")).toEqual(["p_2", "p_3", "p_4"]);
    expect(data.unions.map((u) => u.order)).toEqual([1, 2, 3]);
    expect(data.unions[1]?.children.map((c) => c.personId)).toEqual(["p_7", "p_8"]);
    expect(data.persons[0]?.externalRefs).toEqual([{ system: "gedcom", id: "I1" }]);
    expect(data.unions[2]?.externalRefs).toEqual([{ system: "gedcom", id: "F3" }]);
  });

  it("Cousinenheirat: jede Person nur einmal", () => {
    const { data } = importGedcom(ged("cousin-marriage.ged"));
    expect(data.persons).toHaveLength(9);
    const g = new FamilyGraph(data);
    expect(g.parents("p_7").sort()).toEqual(["p_3", "p_4"]);
    expect(g.parents("p_8").sort()).toEqual(["p_5", "p_6"]);
  });
});

describe("Sonderfälle beim Import", () => {
  const wrap = (body: string) => `0 HEAD\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;

  it("ordnet Ehen nach Heiratsdatum, nicht nach Dateireihenfolge", () => {
    const r = importGedcom(
      wrap(`0 @I1@ INDI\n1 SEX M\n0 @I2@ INDI\n1 SEX F\n0 @I3@ INDI\n1 SEX F
0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR\n2 DATE 1850
0 @F2@ FAM\n1 HUSB @I1@\n1 WIFE @I3@\n1 MARR\n2 DATE 1830`),
    );
    expect(r.data.unions.map((u) => u.order)).toEqual([2, 1]);
    expect(new FamilyGraph(r.data).partners("p_1")).toEqual(["p_3", "p_2"]);
  });

  it("Scheidung, Adoption, Quellen, Notizen, Orte", () => {
    const r = importGedcom(
      wrap(`0 @I1@ INDI\n1 NAME A /X/\n1 SEX M\n1 NOTE Zeile eins\n2 CONT Zeile zwei\n1 NOTE @N1@
1 BIRT\n2 DATE ABT 1700\n2 PLAC Musterdorf\n3 MAP\n4 LATI N48.5\n4 LONG W9.25\n2 SOUR @S1@\n3 PAGE Seite 4\n2 SOUR Freitext-Quelle
1 DEAT Y
0 @I2@ INDI\n1 SEX F\n0 @I3@ INDI\n1 FAMC @F1@\n2 PEDI adopted
0 @N1@ NOTE Zentrale Notiz
0 @S1@ SOUR\n1 TITL Kirchenbuch\n1 WWW https://example.org
0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 DIV\n2 DATE 1720\n1 CHIL @I3@`),
    );
    const [a] = r.data.persons;
    expect(a?.notes).toEqual(["Zeile eins\nZeile zwei", "Zentrale Notiz"]);
    expect(a?.birth?.place).toEqual({ name: "Musterdorf", lat: 48.5, lon: -9.25 });
    expect(a?.birth?.citations).toEqual([{ sourceId: "s_1", detail: "Seite 4" }, { sourceId: "s_2" }]);
    expect(a?.death).toEqual({});
    expect(r.data.sources.map((s) => s.title)).toEqual(["Kirchenbuch", "Freitext-Quelle"]);
    const u = r.data.unions[0]!;
    expect(u.endReason).toBe("divorce");
    expect(u.end?.date).toMatchObject({ kind: "exact", year: 1720 });
    expect(u.children).toEqual([{ personId: "p_3", kind: "adopted" }]);
  });

  it("meldet kaputte Verweise, bricht aber nicht ab", () => {
    const r = importGedcom(
      wrap(`0 @I1@ INDI\n1 NAME A /X/\n1 BIRT\n2 DATE irgendwann\n1 FAMC @F9@
0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I77@\n1 CHIL @I88@`),
    );
    expect(r.data.persons).toHaveLength(1);
    expect(r.data.persons[0]?.birth?.date).toEqual({ kind: "about", text: "irgendwann" });
    expect(r.data.unions[0]?.partnerIds).toEqual(["p_1"]);
    expect(r.warnings.length).toBe(3);
    expect(new FamilyGraph(r.data).validate()).toEqual([]);
  });

  it("leere Namen und fehlendes Geschlecht", () => {
    const { data } = importGedcom(wrap("0 @I1@ INDI\n1 NAME //\n0 @I2@ INDI"));
    expect(data.persons[0]).toMatchObject({ sex: "U" });
    expect(data.persons[0]?.givenNames).toBeUndefined();
    expect(data.persons).toHaveLength(2);
  });

  it("ergänzt fehlendes CHIL, wenn INDI auf die FAM zeigt", () => {
    const r = importGedcom(wrap("0 @I1@ INDI\n1 SEX M\n0 @I2@ INDI\n1 FAMC @F1@\n0 @F1@ FAM\n1 HUSB @I1@"));
    expect(r.data.unions[0]?.children).toEqual([{ personId: "p_2", kind: "biological" }]);
    expect(r.data.unions[0]?.kind).toBe("unknown");
    expect(r.warnings).toHaveLength(1);
  });
});

describe("Export und Round-Trip", () => {
  for (const name of ["multiple-marriages", "cousin-marriage"]) {
    it(`Import → Export → Import ergibt gleiche Daten (${name})`, () => {
      const first = importGedcom(ged(`${name}.ged`)).data;
      const text = exportGedcom(first);
      const second = importGedcom(text);
      expect(second.warnings).toEqual([]);
      expect(second.data).toEqual(first);
      // Export ist stabil (zweiter Durchlauf ändert nichts)
      expect(exportGedcom(second.data)).toBe(text);
    });
  }

  it("Round-Trip bewahrt Quellen, Orte, Notizen, Mehrzeiliges und lange Zeilen", () => {
    const longNote = "Lang ".repeat(120) + "\nzweite Zeile";
    const data: TreeData = {
      version: 1,
      sources: [{ id: "s_1", title: "Kirchenbuch", url: "https://example.org", note: "Hinweis" }],
      persons: [
        { id: "p_1", givenNames: "Anna", surname: "Muster", sex: "F", notes: [longNote],
          birth: { date: { kind: "between", year: 1700, yearTo: 1710 }, place: { name: "Musterdorf", lat: 48.5, lon: -9.25 }, citations: [{ sourceId: "s_1", detail: "S. 3" }] },
          death: {} },
        { id: "p_2", surname: "Nurnachname", sex: "M" },
        { id: "p_3", givenNames: "Kind", sex: "U" },
      ],
      unions: [{ id: "u_1", partnerIds: ["p_2", "p_1"], kind: "marriage", order: 1, start: { date: { kind: "exact", year: 1725 } }, end: { date: { kind: "exact", year: 1740 } }, endReason: "divorce", children: [{ personId: "p_3", kind: "adopted" }] }],
    };
    const text = exportGedcom(data);
    expect(Math.max(...text.split("\n").map((l) => l.length))).toBeLessThan(255);
    // Frau steht trotz Reihenfolge ["p_2" (M), "p_1" (F)] unter WIFE
    expect(text).toMatch(/1 HUSB @I2@\n1 WIFE @I1@/);
    const again = importGedcom(text);
    expect(again.warnings).toEqual([]);
    const back = again.data;
    expect(back.persons[0]?.notes).toEqual([longNote]);
    expect(back.persons[0]?.birth).toMatchObject({ date: { kind: "between", year: 1700, yearTo: 1710 }, place: { name: "Musterdorf", lat: 48.5, lon: -9.25 }, citations: [{ sourceId: "s_1", detail: "S. 3" }] });
    expect(back.sources[0]).toMatchObject({ title: "Kirchenbuch", url: "https://example.org", note: "Hinweis" });
    expect(back.unions[0]).toMatchObject({ endReason: "divorce", children: [{ personId: "p_3", kind: "adopted" }] });
    expect(back.unions[0]?.partnerIds).toEqual(["p_2", "p_1"]);
  });

  it("vergibt IDs ohne Kollision, wenn externalRefs fehlen oder doppelt sind", () => {
    const dup = [{ system: "gedcom", id: "I1" }];
    const text = exportGedcom({
      version: 1, sources: [], unions: [],
      persons: [{ id: "a", sex: "M", externalRefs: dup }, { id: "b", sex: "F", externalRefs: dup }, { id: "c", sex: "U" }],
    });
    expect([...text.matchAll(/^0 @(\w+)@ INDI/gm)].map((m) => m[1])).toEqual(["I1", "I2", "I3"]);
  });
});

describe("JSON-Export und Dateierkennung", () => {
  it("JSON-Export lässt sich wieder laden (verlustfrei)", () => {
    const original = json("multiple-marriages.json");
    expect(parseTreeJson(serializeTreeData(original))).toEqual(original);
  });

  it("GEDCOM → JSON → Daten bleiben gleich", () => {
    const { data } = importGedcom(ged("cousin-marriage.ged"));
    expect(parseTreeJson(serializeTreeData(data))).toEqual(data);
  });

  it("importFileContent erkennt JSON und GEDCOM", () => {
    const j = importFileContent("baum.json", readFileSync("example/json/cousin-marriage.json"));
    expect(j.data.persons).toHaveLength(9);
    const g = importFileContent("baum.ged", ged("cousin-marriage.ged"));
    expect(g.data.persons).toHaveLength(9);
    const noExt = importFileContent("export", readFileSync("example/json/cousin-marriage.json"));
    expect(noExt.data.unions).toHaveLength(4);
  });
});
