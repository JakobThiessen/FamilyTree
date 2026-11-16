import { describe, expect, it, vi } from "vitest";
import { AvatarCache } from "../../src/render/avatarCache";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("AvatarCache", () => {
  it("lädt einmal, liefert danach sofort und meldet die Ankunft", async () => {
    const load = vi.fn(async (id: string) => `bild-${id}`);
    const onLoad = vi.fn();
    const c = new AvatarCache<string>(load, onLoad);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("a")).toBeUndefined(); // läuft schon, kein zweiter Ladevorgang
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(c.get("a")).toBe("bild-a");
  });

  it("merkt sich Fehlendes bis retryMissing", async () => {
    let have = false;
    const load = vi.fn(async () => (have ? "x" : undefined));
    const c = new AvatarCache<string>(load, () => {});
    c.get("a");
    await flush();
    c.get("a");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    have = true;
    c.retryMissing();
    c.get("a");
    await flush();
    expect(c.get("a")).toBe("x");
  });

  it("wirft das am längsten unbenutzte Bild hinaus und gibt es frei", async () => {
    const disposed: string[] = [];
    const c = new AvatarCache<string>(async (id) => id, () => {}, 2, (v) => disposed.push(v));
    for (const id of ["a", "b"]) c.get(id), await flush();
    c.get("a"); // a ist jetzt jünger als b
    c.get("c");
    await flush();
    expect(c.size).toBe(2);
    expect(disposed).toEqual(["b"]);
    expect(c.get("a")).toBe("a");
  });

  it("verwirft Ergebnisse nach clear (anderer Baum)", async () => {
    const disposed: string[] = [];
    const onLoad = vi.fn();
    const c = new AvatarCache<string>(async (id) => id, onLoad, 5, (v) => disposed.push(v));
    c.get("a");
    c.clear();
    await flush();
    expect(c.size).toBe(0);
    expect(onLoad).not.toHaveBeenCalled();
    expect(disposed).toEqual(["a"]);
  });

  it("Ladefehler zählen als fehlend, ohne Absturz", async () => {
    const load = vi.fn(async () => {
      throw new Error("kaputt");
    });
    const c = new AvatarCache<string>(load, () => {});
    c.get("a");
    await flush();
    c.get("a");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
