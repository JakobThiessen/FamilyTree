/** Brücke zum Import-Worker (nur im Browser; benutzt `Worker` und `File`). */
import type { ImportResult } from "../import/gedcomImport";
import type { ImportRequest, ImportResponse } from "./importMessages";
import { CodedError } from "./workerError";

/** Liest eine Datei im Worker. Der Worker wird pro Import gestartet und danach beendet. */
export async function importFileInWorker(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  // `new URL(..., import.meta.url)` ist das Vite-Muster, um einen Worker zu bündeln.
  const worker = new Worker(new URL("./importWorker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<ImportResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ImportResponse>) => {
        if (e.data.ok) resolve(e.data.result);
        else reject(new CodedError(e.data.error, e.data.code, e.data.params));
      };
      worker.onerror = (e) => reject(new CodedError(e.message || "Worker-Fehler", e.message ? undefined : "worker-failed"));
      const msg: ImportRequest = { name: file.name, buffer };
      worker.postMessage(msg, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
