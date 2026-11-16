import { describe, expect, it } from "vitest";
import { avatarRef, mediaPriority } from "../../src/core";

describe("avatarRef", () => {
  it("wählt Ausschnitt vor Hauptbild vor erstem Bild", () => {
    expect(avatarRef(undefined)).toBeUndefined();
    expect(avatarRef([])).toBeUndefined();
    expect(avatarRef([{ file: "a" }, { file: "b" }])?.file).toBe("a");
    expect(avatarRef([{ file: "a" }, { file: "b", primary: true }])?.file).toBe("b");
    expect(avatarRef([{ file: "a", primary: true }, { file: "b", cutout: true }])?.file).toBe("b");
    expect(avatarRef([{ file: "a", cutout: true }, { file: "b", cutout: true, primary: true }])?.file).toBe("b");
  });

  it("sortiert Avatarbilder in der Erzeugungsreihenfolge nach vorn", () => {
    expect(mediaPriority({ file: "a", cutout: true })).toBeLessThan(mediaPriority({ file: "b", primary: true }));
    expect(mediaPriority({ file: "b", primary: true })).toBeLessThan(mediaPriority({ file: "c" }));
  });
});
