import { describe, expect, it } from "vitest";
import {
  BACKUP_HINT_THRESHOLD,
  dismissHint,
  initialBackupState,
  markBackedUp,
  parseBackupState,
  recordChange,
  shouldShowHint,
} from "../../src/core";

const times = (s = initialBackupState(), n = 1) => {
  for (let i = 0; i < n; i++) s = recordChange(s);
  return s;
};

describe("Sicherungshinweis", () => {
  it("erscheint erst an der Schwelle", () => {
    expect(shouldShowHint(times(undefined, BACKUP_HINT_THRESHOLD - 1))).toBe(false);
    expect(shouldShowHint(times(undefined, BACKUP_HINT_THRESHOLD))).toBe(true);
  });
  it("Schließen blendet aus, bis eine weitere Schwelle erreicht ist", () => {
    let s = dismissHint(times(undefined, 10));
    expect(shouldShowHint(s)).toBe(false);
    s = times(s, 9);
    expect(shouldShowHint(s)).toBe(false);
    expect(shouldShowHint(recordChange(s))).toBe(true);
  });
  it("Sicherung setzt alles zurück", () => {
    expect(markBackedUp()).toEqual(initialBackupState());
  });
  it("liest abgelegte Zustände tolerant", () => {
    expect(parseBackupState('{"count":4,"dismissedAt":2}')).toEqual({ count: 4, dismissedAt: 2 });
    expect(parseBackupState({ count: 4, dismissedAt: 9 })).toEqual({ count: 4, dismissedAt: 0 });
    expect(parseBackupState("kaputt")).toEqual(initialBackupState());
    expect(parseBackupState({ count: -1 })).toEqual(initialBackupState());
    expect(parseBackupState(null)).toEqual(initialBackupState());
  });
});
