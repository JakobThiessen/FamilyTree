import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { TreeStore } from "../../src/storage";
import { MediaHub, startMediaJob, type MediaThumb } from "../../src/ui/mediaHub";

const th = (n: string, icon = true): MediaThumb => ({ thumb: new Blob([n]), ...(icon ? { icon: new Blob([n + "i"]) } : {}), width: 1, height: 1, origWidth: 2, origHeight: 2 });
const file = (n: string) => new File([n], n);

describe("MediaHub", () => {
  it("hält Vorschauen im Arbeitsspeicher, solange der Baum nicht gespeichert ist, und meldet Ankünfte", async () => {
    const hub = new MediaHub();
    const cb = vi.fn();
    hub.onChange(cb);
    expect(await hub.thumb("a")).toBeUndefined();
    await hub.add([["a", th("a")]]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect((await hub.thumb("a"))?.width).toBe(1);
    expect(await hub.icon("a")).toBeInstanceOf(Blob);
  });

  it("icon fällt auf die Vorschau zurück (ältere Datensätze)", async () => {
    const hub = new MediaHub();
    await hub.add([["a", th("a", false)]]);
    expect(await hub.icon("a")).toBeInstanceOf(Blob);
  });

  it("schreibt nach attach in die Datenbank und reicht Vorhandenes nach", async () => {
    const store = await TreeStore.open("hub-test-1");
    const meta = await store.saveTree("T", { version: 1, persons: [], unions: [], sources: [] });
    const hub = new MediaHub();
    await hub.add([["a", th("a")]]);
    await hub.attach(store, meta.id);
    expect(await store.countMedia(meta.id)).toBe(1);
    await hub.add([["b", th("b")]]);
    expect(await store.countMedia(meta.id)).toBe(2);
    expect((await hub.thumb("b"))?.origWidth).toBe(2); // jetzt aus der Datenbank
    store.close();
  });
});

describe("startMediaJob", () => {
  it("erzeugt alle Vorschauen in Päckchen, zählt Fehler und meldet Fortschritt", async () => {
    const hub = new MediaHub();
    const adds = vi.spyOn(hub, "add");
    const entries: [string, File][] = ["a", "b", "c", "d", "e"].map((n) => [n, file(n)]);
    const progress: number[] = [];
    const job = startMediaJob(entries, hub, async (f) => { if (f.name === "c") throw new Error("kaputt"); return th(f.name); }, (d) => progress.push(d), { concurrency: 2, batch: 2 });
    const r = await job.done;
    expect(r).toEqual({ done: 5, failed: 1 });
    expect(progress.at(-1)).toBe(5);
    expect(await hub.thumb("e")).toBeDefined();
    expect(await hub.thumb("c")).toBeUndefined();
    expect(adds.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("cancel bricht ab, ohne weiter zu schreiben", async () => {
    const hub = new MediaHub();
    const entries: [string, File][] = Array.from({ length: 20 }, (_, i) => [`f${i}`, file(`f${i}`)]);
    let job: ReturnType<typeof startMediaJob>;
    job = startMediaJob(entries, hub, async (f) => { if (f.name === "f3") job.cancel(); return th(f.name); }, () => {}, { concurrency: 1, batch: 2 });
    const r = await job.done;
    expect(r.done).toBeLessThan(20);
  });
});
