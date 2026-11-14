/// <reference lib="webworker" />
/**
 * Web Worker: liest GEDCOM/JSON im Hintergrund, damit die Oberfläche bei großen Dateien nicht einfriert.
 * Die eigentliche Arbeit steckt in `src/import` (reines TypeScript).
 */
import { importFileContent } from "../import/importFile";
import type { ImportRequest, ImportResponse } from "./importMessages";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ImportRequest>) => void) | null;
  postMessage(message: ImportResponse): void;
};

ctx.onmessage = (e) => {
  try {
    const result = importFileContent(e.data.name, new Uint8Array(e.data.buffer));
    ctx.postMessage({ ok: true, result });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
