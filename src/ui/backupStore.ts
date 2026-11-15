// Zähler „Änderungen seit der letzten Sicherung“ pro gespeichertem Baum im localStorage (nur eine Zahl, keine Daten).
// Fehlt localStorage oder ist es gesperrt, läuft der Zähler nur in der Sitzung.
import { initialBackupState, parseBackupState } from "../core";
import type { BackupState } from "../core";

const key = (treeId: string) => `familytree.backup.${treeId}`;

export function loadBackupState(treeId: string): BackupState {
  try {
    return parseBackupState(localStorage.getItem(key(treeId)));
  } catch {
    return initialBackupState();
  }
}

export function saveBackupState(treeId: string, s: BackupState): void {
  try {
    localStorage.setItem(key(treeId), JSON.stringify(s));
  } catch {
    /* ohne Ablage nur für diese Sitzung */
  }
}
