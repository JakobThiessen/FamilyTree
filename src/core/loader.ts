/**
 * Laden des JSON-Austauschformats (TreeData, Version 1).
 * Nimmt Text oder ein schon geparstes Objekt; liest keine Dateien (das macht der Aufrufer),
 * damit der Kern in Node, Browser und Worker gleich läuft.
 */

import { FamilyGraph } from "./graph";
import type { TreeData } from "./types";

/** Das JSON hat nicht die erwartete Form. */
export class TreeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreeFormatError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Prüft die Grobform. Inhaltliche Fehler (Zyklen, hängende IDs) meldet `FamilyGraph.validate()`. */
export function parseTreeData(input: unknown): TreeData {
  if (!isRecord(input)) throw new TreeFormatError("Wurzel muss ein JSON-Objekt sein.");
  if (input.version !== 1) throw new TreeFormatError(`Nicht unterstützte Version: ${String(input.version)}.`);
  if (!Array.isArray(input.persons)) throw new TreeFormatError('Feld "persons" muss eine Liste sein.');
  if (!Array.isArray(input.unions)) throw new TreeFormatError('Feld "unions" muss eine Liste sein.');
  if (input.sources !== undefined && !Array.isArray(input.sources)) {
    throw new TreeFormatError('Feld "sources" muss eine Liste sein.');
  }

  input.persons.forEach((p: unknown, i: number) => {
    if (!isRecord(p) || typeof p.id !== "string") throw new TreeFormatError(`persons[${i}]: "id" (Text) fehlt.`);
    if (p.sex !== "M" && p.sex !== "F" && p.sex !== "U") {
      throw new TreeFormatError(`persons[${i}] (${p.id}): "sex" muss M, F oder U sein.`);
    }
  });
  input.unions.forEach((u: unknown, i: number) => {
    if (!isRecord(u) || typeof u.id !== "string") throw new TreeFormatError(`unions[${i}]: "id" (Text) fehlt.`);
    if (!Array.isArray(u.partnerIds) || !u.partnerIds.every((x) => typeof x === "string")) {
      throw new TreeFormatError(`unions[${i}] (${u.id}): "partnerIds" muss eine Liste von Texten sein.`);
    }
    if (!Array.isArray(u.children) || !u.children.every((c) => isRecord(c) && typeof c.personId === "string")) {
      throw new TreeFormatError(`unions[${i}] (${u.id}): "children" muss Einträge mit "personId" haben.`);
    }
  });

  // Die Formprüfung oben deckt die Pflichtfelder ab; Details der Unterobjekte prüft validate().
  return { version: 1, sources: [], ...input } as unknown as TreeData;
}

/** JSON-Text -> Daten. */
export function parseTreeJson(text: string): TreeData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new TreeFormatError(`Kein gültiges JSON: ${(e as Error).message}`);
  }
  return parseTreeData(raw);
}

/** Komfort: JSON-Text oder Objekt direkt zum Graphen. */
export function loadGraph(input: string | unknown): FamilyGraph {
  const data = typeof input === "string" ? parseTreeJson(input) : parseTreeData(input);
  return new FamilyGraph(data);
}

/** Daten -> JSON-Text (lesbar eingerückt). Gegenstück zu `parseTreeJson`. */
export function serializeTreeData(data: TreeData): string {
  return JSON.stringify(data, null, 2) + "\n";
}
