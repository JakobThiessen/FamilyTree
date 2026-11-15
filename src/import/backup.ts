/**
 * Backup-Datei: alle gespeicherten Bäume in EINER JSON-Datei (M9, D32).
 * Reines TypeScript, liest und schreibt keine Dateien. Jeder Baum steckt im
 * normalen Austauschformat (`TreeData`), das Backup ist also nur ein Umschlag.
 */

import { parseTreeData, TreeFormatError } from "../core";
import type { TreeData } from "../core";

export const BACKUP_FORMAT = "familytree-backup";
export const BACKUP_VERSION = 1;

/** Ein Baum im Backup (Name und Zeitstempel in Millisekunden seit 1970). */
export interface BackupTree {
  name: string;
  createdAt: number;
  updatedAt: number;
  data: TreeData;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** ISO-Zeitpunkt der Sicherung */
  createdAt: string;
  trees: BackupTree[];
}

/** Baut den Text der Backup-Datei. */
export function serializeBackup(trees: BackupTree[], now: Date = new Date()): string {
  const file: BackupFile = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), trees };
  return JSON.stringify(file) + "\n";
}

/** Liest eine Backup-Datei und prüft die Form jedes Baums. Wirft `TreeFormatError` bei Fehlern. */
export function parseBackup(text: string): BackupTree[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TreeFormatError("Keine gültige JSON-Datei.", "backup-invalid-json");
  }
  const r = raw as Partial<BackupFile> | null;
  if (!r || typeof r !== "object" || r.format !== BACKUP_FORMAT) {
    throw new TreeFormatError("Das ist keine FamilyTree-Backup-Datei.", "backup-not-backup");
  }
  if (r.version !== BACKUP_VERSION) throw new TreeFormatError(`Nicht unterstützte Backup-Version: ${String(r.version)}.`, "backup-version", { version: String(r.version) });
  if (!Array.isArray(r.trees)) throw new TreeFormatError('Feld "trees" muss eine Liste sein.', "backup-trees-list");
  return r.trees.map((t, i) => {
    if (!t || typeof t !== "object" || typeof t.name !== "string") {
      throw new TreeFormatError(`trees[${i}]: "name" (Text) fehlt.`, "backup-tree-name", { i });
    }
    const now = Date.now();
    return {
      name: t.name,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : now,
      updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : now,
      data: parseTreeData(t.data),
    };
  });
}
