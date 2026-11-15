import { describe, expect, it } from "vitest";
import { matchMedia } from "../../src/import/mediaMatch";

describe("matchMedia", () => {
  it("ordnet relative Pfade unabhängig vom gewählten Ordner zu", () => {
    const r = matchMedia(["Fotos/a.jpg", "Fotos/b.jpg"], ["Fotos/a.jpg", "stamm/Fotos/b.jpg"]);
    expect([...r.matched]).toEqual([["Fotos/a.jpg", "Fotos/a.jpg"], ["Fotos/b.jpg", "stamm/Fotos/b.jpg"]]);
    expect(r.missing).toEqual([]);
  });

  it("kommt mit absoluten Windows-Pfaden, Groß-/Kleinschreibung und ./ zurecht", () => {
    const r = matchMedia(["C:\\Bilder\\Opa.JPG", "./x/y.png"], ["fotos/opa.jpg", "y.png"]);
    expect(r.matched.get("C:\\Bilder\\Opa.JPG")).toBe("fotos/opa.jpg");
    expect(r.matched.get("./x/y.png")).toBe("y.png");
  });

  it("meldet fehlende Dateien und nennt Mehrdeutiges getrennt", () => {
    const r = matchMedia(["a.jpg", "fehlt.jpg", "b.jpg"], ["eins/a.jpg", "zwei/a.jpg", "eins/b.jpg", "zwei/b.jpg"]);
    expect(r.matched.size).toBe(0);
    expect(r.missing).toEqual(["fehlt.jpg"]);
    expect(r.ambiguous).toEqual(["a.jpg", "b.jpg"]);
  });

  it("nimmt bei gleichen Dateinamen den Pfad mit dem längeren gemeinsamen Ende", () => {
    const r = matchMedia(["x/Fotos/a.jpg"], ["y/Fotos/a.jpg", "z/Bilder/a.jpg"]);
    expect(r.matched.get("x/Fotos/a.jpg")).toBe("y/Fotos/a.jpg");
  });
});
