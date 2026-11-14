import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { TreeData } from "../../src/core/types";

describe("example/json/multiple-marriages.json", () => {
  const data = JSON.parse(readFileSync("example/json/multiple-marriages.json", "utf8")) as TreeData;

  it("hat drei Unions für Johann in Reihenfolge", () => {
    const unions = data.unions.filter((u) => u.partnerIds.includes("p_1"));
    expect(unions.map((u) => u.order)).toEqual([1, 2, 3]);
  });

  it("verweist nur auf existierende Personen", () => {
    const ids = new Set(data.persons.map((p) => p.id));
    for (const u of data.unions) {
      for (const id of [...u.partnerIds, ...u.children.map((c) => c.personId)]) expect(ids.has(id)).toBe(true);
    }
  });
});
