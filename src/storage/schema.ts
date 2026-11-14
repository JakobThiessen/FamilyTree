/**
 * IndexedDB-Schema (siehe docs/DECISIONS.md D13).
 *
 * Alle Bäume liegen in EINER Datenbank. Jeder Datensatz trägt die `treeId`,
 * der Schlüssel ist `[treeId, id]`. So lässt sich ein ganzer Baum per Schlüsselbereich
 * löschen, und Personen/Unions können einzeln nachgeladen werden.
 */

import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { Person, Source, Union } from "../core";

export const DB_NAME = "familytree";
export const DB_VERSION = 1;

/** Metadaten eines Baums (für die Liste, ohne Personen laden zu müssen). */
export interface TreeMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  personCount: number;
  unionCount: number;
  sourceCount: number;
}

export type PersonRecord = Person & { treeId: string };
export type SourceRecord = Source & { treeId: string };
/**
 * Union plus Hilfsfelder für die Indizes. IndexedDB kann Mehrfach-Indizes (`multiEntry`)
 * nur über Listen einfacher Schlüssel bilden, daher die Textschlüssel `treeId\0personId`.
 */
export type UnionRecord = Union & { treeId: string; partnerKeys: string[]; childKeys: string[] };

export interface FamilyTreeDB extends DBSchema {
  trees: { key: string; value: TreeMeta };
  persons: { key: [string, string]; value: PersonRecord; indexes: { byTree: string } };
  unions: {
    key: [string, string];
    value: UnionRecord;
    indexes: { byTree: string; byPartner: string; byChild: string };
  };
  sources: { key: [string, string]; value: SourceRecord; indexes: { byTree: string } };
}

export type Db = IDBPDatabase<FamilyTreeDB>;

/** Schlüssel für die Mehrfach-Indizes. */
export const personKey = (treeId: string, personId: string) => `${treeId}\u0000${personId}`;

export function openTreeDb(name: string = DB_NAME): Promise<Db> {
  return openDB<FamilyTreeDB>(name, DB_VERSION, {
    // Läuft nur bei neuer bzw. älterer Datenbank. Spätere Versionen ergänzen hier Migrationsschritte.
    upgrade(db) {
      db.createObjectStore("trees", { keyPath: "id" });
      db.createObjectStore("persons", { keyPath: ["treeId", "id"] }).createIndex("byTree", "treeId");
      const unions = db.createObjectStore("unions", { keyPath: ["treeId", "id"] });
      unions.createIndex("byTree", "treeId");
      unions.createIndex("byPartner", "partnerKeys", { multiEntry: true });
      unions.createIndex("byChild", "childKeys", { multiEntry: true });
      db.createObjectStore("sources", { keyPath: ["treeId", "id"] }).createIndex("byTree", "treeId");
    },
  });
}
