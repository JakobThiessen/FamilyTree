// Meldungen des Kerns als Code + Parameter (D37): die UI übersetzt, der deutsche Text bleibt Rückfall.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyEdit, FamilyGraph, parseTreeData, TreeFormatError } from "../../src/core";
import type { TreeData } from "../../src/core";
import { importGedcom, parseBackup } from "../../src/import";
import { adoptBatch, ProviderError } from "../../src/providers";
import { findDuplicates } from "../../src/core/duplicates";
import { requestJson } from "../../src/providers/http";
import { de } from "../../src/ui/locales/de";
import { translate } from "../../src/ui/i18n";
import { disclosureText, editText, errorText, issueText, reasonText, warningText } from "../../src/ui/messages";
import { CodedError } from "../../src/workers/workerError";

const key = (prefix: string, code: string | undefined) => `${prefix}.${code}` as keyof typeof de;

describe("GEDCOM-Hinweise", () => {
  // Eine Datei, die möglichst viele Hinweise auslöst
  const ged = [
    "0 @I1@ INDI",
    "1 NAME Max /Muster/",
    "1 BIRT",
    "2 DATE irgendwann im Frühling",
    "1 FAMC @F9@",
    "1 NOTE @N9@",
    "0 @I1@ INDI",
    "0 INDI",
    "0 FAM",
    "0 @F1@ FAM",
    "1 HUSB @I77@",
    "1 CHIL @I78@",
    "0 @F2@ FAM",
    "0 @F2@ FAM",
    "0 @I3@ INDI",
    "1 FAMC @F1@",
    "1 SOUR @S9@",
    "kaputte Zeile",
    "5 DATE 1900",
    "0 TRLR",
  ].join("\n");
  const result = importGedcom(ged);

  it("tragen einen Code, dessen deutsche Übersetzung dem Text entspricht", () => {
    expect(result.warnings.length).toBeGreaterThan(8);
    for (const w of result.warnings) {
      expect(w.code, w.message).toBeTruthy();
      expect(de, `${w.code}`).toHaveProperty(key("warn", w.code));
      expect(warningText(w, "de"), w.code).toBe(w.message);
    }
  });

  it("erscheinen auf Englisch", () => {
    const head = result.warnings.find((w) => w.code === "head-missing")!;
    expect(warningText(head, "en")).toBe("Header (HEAD) is missing. Is this really a GEDCOM file?");
    const dup = result.warnings.find((w) => w.code === "indi-duplicate")!;
    expect(warningText(dup, "en")).toContain("Duplicate person ID @I1@");
  });

  it("kennt jeder Code des Imports (Quelltext-Abgleich)", () => {
    // Jeder in den Quelldateien verwendete Code hat Schlüssel in beiden Sprachen (Parität prüft i18n.test.ts)
    const used = ["source-missing", "date-unreadable", "note-missing", "indi-no-id", "indi-duplicate", "fam-no-id", "fam-duplicate", "fam-unknown-person", "fam-unknown-child", "fam-empty", "famc-missing-chil", "head-missing", "line-unreadable", "level-orphan"];
    for (const c of used) expect(de, c).toHaveProperty(key("warn", c));
  });
});

describe("Prüfmeldungen", () => {
  it("übersetzen alle Codes von validate()", () => {
    const data: TreeData = {
      version: 1,
      persons: [
        { id: "a", sex: "M" },
        { id: "a", sex: "M" },
        { id: "b", sex: "F" },
        { id: "c", sex: "U" },
        { id: "d", sex: "U" },
      ],
      unions: [
        { id: "u1", partnerIds: ["a", "b", "c"], kind: "marriage", children: [] },
        { id: "u1", partnerIds: ["a", "a"], kind: "marriage", children: [] },
        { id: "u5", partnerIds: ["d", "d"], kind: "marriage", children: [] },
        { id: "u2", partnerIds: ["a", "zz"], kind: "marriage", children: [{ personId: "yy", kind: "biological" }, { personId: "c", kind: "biological" }, { personId: "c", kind: "biological" }] },
        { id: "u3", partnerIds: ["b"], kind: "marriage", children: [{ personId: "c", kind: "biological" }] },
        { id: "u4", partnerIds: ["c"], kind: "marriage", children: [{ personId: "a", kind: "biological" }] },
      ],
      sources: [],
    };
    const issues = new FamilyGraph(data).validate();
    const codes = new Set(issues.map((i) => i.code));
    for (const c of ["duplicate-person", "duplicate-union", "too-many-partners", "dangling-partner", "duplicate-partner", "dangling-child", "duplicate-child-link", "multiple-biological-unions", "parent-cycle"]) {
      expect(codes.has(c as never), c).toBe(true);
    }
    for (const i of issues) {
      expect(issueText(i, "de"), i.code).toBe(i.message);
      expect(issueText(i, "en")).not.toBe(i.message);
    }
  });
});

describe("Fehler", () => {
  it("Dateiformat und Backup", () => {
    for (const [input, fn] of [
      ['"x"', (s: string) => parseTreeData(JSON.parse(s))],
      ['{"version":2}', (s: string) => parseTreeData(JSON.parse(s))],
      ['{"version":1,"persons":[{"id":"a","sex":"Q"}],"unions":[]}', (s: string) => parseTreeData(JSON.parse(s))],
      ['{"format":"x"}', (s: string) => parseBackup(s)],
      ["kein json", (s: string) => parseBackup(s)],
    ] as const) {
      try {
        fn(input);
        throw new Error("sollte werfen");
      } catch (e) {
        expect(e).toBeInstanceOf(TreeFormatError);
        const err = e as TreeFormatError;
        expect(err.code, err.message).toBeTruthy();
        expect(errorText(err, "de")).toBe(err.message);
        expect(errorText(err, "en")).not.toBe(err.message);
      }
    }
  });

  it("Anbieter: Netz, Status, Mehrfachgrenze", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const limited = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    const unreadable = (async () => new Response("kein json", { status: 200 })) as unknown as typeof fetch;

    for (const f of [failing, limited, unreadable]) {
      const e = (await requestJson("http://x", { fetch: f }, {}, "Wikidata").catch((x: unknown) => x)) as ProviderError;
      expect(e).toBeInstanceOf(ProviderError);
      expect(errorText(e, "de")).toBe(e.message);
    }
    const e429 = (await requestJson("http://x", { fetch: limited }, {}, "Wikidata").catch((x: unknown) => x)) as ProviderError;
    expect(errorText(e429, "en")).toBe("Wikidata answered with error 429 (too many requests, please try again later).");
  });

  it("Worker-Fehler und unbekannte Fehler", () => {
    expect(errorText(new CodedError("Layout-Worker beendet", "layout-ended"), "en")).toBe("The layout worker was stopped.");
    expect(errorText(new Error("irgendwas"), "en")).toBe("irgendwas");
    expect(errorText("text", "en")).toBe("text");
  });
});

describe("Online-Quellen", () => {
  it("Hinweis zur Datenübermittlung je Anbieter und Sprache", () => {
    expect(disclosureText("wikidata", "en", "x")).toContain("query.wikidata.org");
    expect(disclosureText("wikidata", "de", "x")).toBe(de["online.disclosure.wikidata"]);
    expect(disclosureText("unbekannt", "en", "Rückfall")).toBe("Rückfall");
  });

  it("Gründe der Dublettenvorschläge", () => {
    const persons = [{ id: "p1", sex: "M" as const, givenNames: "Max", surname: "Muster", birth: { date: { kind: "exact" as const, year: 1800 } } }];
    const [hit] = findDuplicates(persons, { givenNames: "Max", surname: "Muster", birthYear: 1802 });
    expect(hit).toBeDefined();
    expect(hit!.reasonCodes.map((r) => r.code)).toEqual(["surname-same", "given-same", "birth-diff"]);
    expect(hit!.reasons.map((r, i) => reasonText(hit!.reasonCodes[i]!, "de", r))).toEqual(hit!.reasons);
    expect(hit!.reasonCodes.map((r) => reasonText(r, "en", "")).join(", ")).toBe("same last name, same first name, birth year ±2");
  });

  it("Vermerk an der übernommenen Person folgt der Sprache", () => {
    const base: TreeData = { version: 1, persons: [], unions: [], sources: [] };
    const batch = {
      provider: "wikidata",
      root: { system: "wikidata", id: "Q1" },
      people: [{ ref: { system: "wikidata", id: "Q1" }, url: "https://example.org/Q1", givenNames: "Max", surname: "Muster", sex: "M" as const }],
      unions: [],
    };
    const de1 = adoptBatch(base, batch);
    const en1 = adoptBatch(base, batch, { lang: "en" });
    expect(de1.data.persons[0]!.notes![0]).toContain("Übernommen aus");
    expect(en1.data.persons[0]!.notes![0]).toContain("Adopted from");
  });
});

describe("Änderungs-Kern", () => {
  it("jeder Code in src/core/edit.ts hat Übersetzungen (DE und EN)", () => {
    const src = readFileSync(resolve(__dirname, "../../src/core/edit.ts"), "utf8");
    const rel = readFileSync(resolve(__dirname, "../../src/core/relatives.ts"), "utf8");
    const rejects = [...src.matchAll(/fail\("([a-z-]+)"/g), ...rel.matchAll(/reject\("([a-z-]+)"/g)].map((m) => `edit.reject.${m[1]}`);
    const notes = [...src.matchAll(/note\("([a-z-]+)"/g), ...rel.matchAll(/code: "edit\.note\.([a-z-]+)"/g)].map((m) => `edit.note.${m[1]}`);
    expect(rejects.length).toBeGreaterThan(10);
    for (const code of [...new Set([...rejects, ...notes, "edit.reject.no-tree"])]) {
      expect(de, code).toHaveProperty(code);
      expect(editText({ code, params: { id: "p_1", union: "u_1", count: 2, unions: 1, children: 1, child: "p_2", parent: "p_3", other: "u_2" } }, "en"), code).not.toBe(code);
    }
  });

  it("übersetzt eine echte Ablehnung", () => {
    const r = applyEdit({ version: 1, persons: [], unions: [], sources: [] }, { type: "updatePerson", person: { id: "p_9", sex: "U" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(editText(r.reject, "de")).toBe("Die Person p_9 gibt es nicht (mehr).");
    expect(editText(r.reject, "en")).toBe("Person p_9 does not exist (any more).");
  });
});

describe("Wörterbuch", () => {
  it("füllt Parameter in Meldungen", () => {
    expect(translate("en", "issue.too-many-partners", { id: "u1", n: 3 })).toBe("Union u1 has 3 partners (at most 2 allowed).");
  });
});
