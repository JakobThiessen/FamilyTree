/** Brücke zum Layout-Worker (nur im Browser; benutzt `Worker`). */
import type { TreeChanges } from "../core/edit";
import type { LayoutResult } from "../core/layout";
import type { TreeData, ViewRequest } from "../core/types";
import type { LayoutRequest, LayoutResponse } from "./layoutMessages";
import { CodedError } from "./workerError";

/** `Omit`, das bei Vereinigungstypen jeden Fall einzeln behandelt. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * Hält einen Layout-Worker. Anders als beim Import bleibt er am Leben (er merkt sich die Positionen),
 * mit `dispose()` beenden.
 */
export class LayoutClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: LayoutResponse) => void; reject: (e: Error) => void }>();

  constructor() {
    // `new URL(..., import.meta.url)` ist das Vite-Muster, um einen Worker zu bündeln.
    this.worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
      const entry = this.pending.get(e.data.id);
      if (!entry) return;
      this.pending.delete(e.data.id);
      entry.resolve(e.data);
    };
    this.worker.onerror = (e) => {
      const error = new CodedError(e.message || "Worker-Fehler", e.message ? undefined : "worker-failed");
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  private send(msg: DistributiveOmit<LayoutRequest, "id">): Promise<LayoutResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id } as LayoutRequest);
    });
  }

  private async expectOk(p: Promise<LayoutResponse>): Promise<LayoutResult | undefined> {
    const res = await p;
    if (!res.ok) throw new CodedError(res.error, res.code, res.params);
    return res.result;
  }

  /** Baumdaten (oder einen größeren Ausschnitt davon) an den Worker geben. */
  async setData(data: Pick<TreeData, "persons" | "unions">): Promise<void> {
    await this.expectOk(this.send({ type: "setData", data }));
  }

  /** Nur geänderte Datensätze an den Worker geben (statt des ganzen Baums). */
  async applyChanges(changes: TreeChanges): Promise<void> {
    await this.expectOk(this.send({ type: "applyChanges", changes }));
  }

  /** Layout einer Ansicht. Gleicher Fokus und Modus wie zuvor = inkrementell (`result.added` nennt die neuen Karten). */
  async layout(request: ViewRequest): Promise<LayoutResult> {
    const result = await this.expectOk(this.send({ type: "layout", request }));
    if (!result) throw new CodedError("Layout-Worker lieferte kein Ergebnis", "layout-no-result");
    return result;
  }

  async reset(): Promise<void> {
    await this.expectOk(this.send({ type: "reset" }));
  }

  dispose(): void {
    this.worker.terminate();
    const error = new CodedError("Layout-Worker beendet", "layout-ended");
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}
