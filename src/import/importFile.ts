/**
 * Einstieg für Dateiinhalte: erkennt JSON oder GEDCOM und liefert `ImportResult`.
 * Wird vom Web Worker aufgerufen, läuft aber genauso in Node (Tests).
 */

import { parseTreeJson } from "../core/loader";
import { decodeGedcom } from "./gedcomCharset";
import { importGedcom, type ImportResult } from "./gedcomImport";

/** Importiert den Inhalt einer Datei. JSON, wenn der Name auf .json endet oder der Inhalt mit "{" beginnt. */
export function importFileContent(name: string, bytes: Uint8Array): ImportResult {
  const lower = name.toLowerCase();
  const looksJson = lower.endsWith(".json") || /^\s*\{/.test(new TextDecoder().decode(bytes.subarray(0, 64)));
  if (looksJson && !lower.endsWith(".ged")) {
    const text = decodeGedcom(bytes).text; // erkennt BOM und UTF-16 mit
    return { data: parseTreeJson(text), warnings: [], charset: "utf-8" };
  }
  return importGedcom(bytes);
}
