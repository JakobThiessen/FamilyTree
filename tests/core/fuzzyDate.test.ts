import { describe, it, expect } from "vitest";
import { compareFuzzyDate, formatFuzzyDate, parseFuzzyDate, yearRange } from "../../src/core/fuzzyDate";

describe("parseFuzzyDate", () => {
  it("liest genaue Daten in mehreren Schreibweisen", () => {
    expect(parseFuzzyDate("1800")).toMatchObject({ kind: "exact", year: 1800 });
    expect(parseFuzzyDate("1800-03-12")).toMatchObject({ kind: "exact", year: 1800, month: 3, day: 12 });
    expect(parseFuzzyDate("12.03.1800")).toMatchObject({ kind: "exact", year: 1800, month: 3, day: 12 });
    expect(parseFuzzyDate("12. März 1800")).toMatchObject({ kind: "exact", year: 1800, month: 3, day: 12 });
    expect(parseFuzzyDate("märz 1800")).toMatchObject({ kind: "exact", year: 1800, month: 3 });
  });

  it("liest um / vor / nach", () => {
    expect(parseFuzzyDate("um 1750")).toMatchObject({ kind: "about", year: 1750, text: "um 1750" });
    expect(parseFuzzyDate("ca. 1750")).toMatchObject({ kind: "about", year: 1750 });
    expect(parseFuzzyDate("vor 1850")).toMatchObject({ kind: "before", year: 1850 });
    expect(parseFuzzyDate("nach 1700")).toMatchObject({ kind: "after", year: 1700 });
  });

  it("liest Zeiträume", () => {
    expect(parseFuzzyDate("zwischen 1700 und 1710")).toMatchObject({ kind: "between", year: 1700, yearTo: 1710 });
    expect(parseFuzzyDate("1700-1710")).toMatchObject({ kind: "between", year: 1700, yearTo: 1710 });
    expect(parseFuzzyDate("1700-03")).toMatchObject({ kind: "exact", year: 1700, month: 3 });
  });

  it("lehnt Unsinn ab", () => {
    expect(parseFuzzyDate("")).toBeNull();
    expect(parseFuzzyDate("gestern")).toBeNull();
    expect(parseFuzzyDate("31.02.1800")).toBeNull();
    expect(parseFuzzyDate("29.02.1900")).toBeNull(); // 1900 kein Schaltjahr
    expect(parseFuzzyDate("29.02.1904")).not.toBeNull();
    expect(parseFuzzyDate("13.13.1800")).toBeNull();
    expect(parseFuzzyDate("zwischen 1710 und 1700")).toBeNull();
  });
});

describe("formatFuzzyDate", () => {
  it("formatiert auf Deutsch", () => {
    expect(formatFuzzyDate({ kind: "exact", year: 1800, month: 3, day: 12 })).toBe("12. März 1800");
    expect(formatFuzzyDate({ kind: "exact", year: 1800, month: 3 })).toBe("März 1800");
    expect(formatFuzzyDate({ kind: "exact", year: 1800 })).toBe("1800");
    expect(formatFuzzyDate({ kind: "about", year: 1750 })).toBe("um 1750");
    expect(formatFuzzyDate({ kind: "before", year: 1850 })).toBe("vor 1850");
    expect(formatFuzzyDate({ kind: "after", year: 1700 })).toBe("nach 1700");
    expect(formatFuzzyDate({ kind: "between", year: 1700, yearTo: 1710 })).toBe("zwischen 1700 und 1710");
    expect(formatFuzzyDate(undefined)).toBe("unbekannt");
  });

  it("Parsen und Formatieren ergeben den Kreis", () => {
    for (const s of ["12. März 1800", "um 1750", "vor 1850", "nach 1700", "zwischen 1700 und 1710", "1800"]) {
      expect(formatFuzzyDate(parseFuzzyDate(s)!)).toBe(s);
    }
  });
});

describe("Vergleich und Spannen", () => {
  it("yearRange hat offene Enden bei vor/nach", () => {
    expect(yearRange({ kind: "before", year: 1850 })).toEqual({ from: -Infinity, to: 1850 });
    expect(yearRange({ kind: "after", year: 1700 })).toEqual({ from: 1700, to: Infinity });
    expect(yearRange({ kind: "between", year: 1700, yearTo: 1710 })).toEqual({ from: 1700, to: 1710 });
  });

  it("sortiert nach Datum, unbekannte zuletzt", () => {
    const list = [undefined, parseFuzzyDate("1850")!, parseFuzzyDate("März 1800")!, parseFuzzyDate("1800")!];
    list.sort(compareFuzzyDate);
    expect(list.map((d) => formatFuzzyDate(d))).toEqual(["1800", "März 1800", "1850", "unbekannt"]);
  });
});
