/**
 * Sicherungshinweis (M10, Schritt 7): reine Logik, ohne DOM und Svelte.
 *
 * Zählt Schritte (Ändern, Rückgängig, Wiederholen) seit der letzten *Sicherung*. Als Sicherung gelten
 * Backup-Datei und GEDCOM-/JSON-Export; das Schreiben nach IndexedDB zählt nicht (D42). Der Zustand ist ein
 * kleines, unveränderliches Objekt, damit er sich leicht testen und (pro Baum) ablegen lässt.
 */

/** Ab so vielen Änderungen seit der Sicherung (bzw. seit dem Schließen des Hinweises) erscheint der Hinweis. */
export const BACKUP_HINT_THRESHOLD = 10;

export interface BackupState {
  /** Schritte seit der letzten Sicherung */
  count: number;
  /** Stand von `count`, bei dem der Nutzer den Hinweis geschlossen hat (0 = nie) */
  dismissedAt: number;
}

export const initialBackupState = (): BackupState => ({ count: 0, dismissedAt: 0 });

/** Ein Schritt (Ändern, Rückgängig, Wiederholen) ist passiert. */
export const recordChange = (s: BackupState): BackupState => ({ ...s, count: s.count + 1 });

/** Der Stand wurde gesichert (Backup oder Export): alles beginnt von vorn. */
export const markBackedUp = (): BackupState => initialBackupState();

/** Hinweis geschlossen: er kommt erst nach einer weiteren Schwelle an Änderungen wieder. */
export const dismissHint = (s: BackupState): BackupState => ({ ...s, dismissedAt: s.count });

export function shouldShowHint(s: BackupState, threshold: number = BACKUP_HINT_THRESHOLD): boolean {
  return s.count - s.dismissedAt >= threshold;
}

/** Liest einen abgelegten Zustand; Unbrauchbares ergibt den Anfangszustand. */
export function parseBackupState(raw: unknown): BackupState {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return initialBackupState();
    }
  }
  if (typeof v !== "object" || v === null) return initialBackupState();
  const { count, dismissedAt } = v as Record<string, unknown>;
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;
  if (!ok(count)) return initialBackupState();
  return { count, dismissedAt: ok(dismissedAt) && dismissedAt <= count ? dismissedAt : 0 };
}
