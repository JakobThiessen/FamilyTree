/** Nachrichten zwischen UI-Thread und Import-Worker. */
import type { ImportResult } from "../import/gedcomImport";

export interface ImportRequest {
  name: string;
  /** Dateiinhalt (wird an den Worker übertragen, nicht kopiert) */
  buffer: ArrayBuffer;
}

export type ImportResponse = { ok: true; result: ImportResult } | { ok: false; error: string };
