/**
 * Sitzungs-Controller fürs Bearbeiten (M10, Schritt 3): reines TypeScript, ohne Svelte und DOM.
 *
 * Hält den aktuellen Baum und die Stapel für Rückgängig/Wiederholen. Die Stapel bestehen nur aus den
 * `inverse`-Operationen von `applyEdit` (D38); sie leben nur in der Sitzung und werden nie gespeichert.
 * Eine neue Operation leert den Wiederholen-Stapel. Der Rückgängig-Stapel ist begrenzt (`limit`).
 */
import { applyEdit } from "./edit";
import type { EditCreated, EditOp, Touched } from "./edit";
import type { MessageRef, TreeData } from "./types";

export type StepKind = "apply" | "undo" | "redo";

export type SessionResult =
  | {
      ok: true;
      kind: StepKind;
      /** neuer Stand des Baums (derselbe wie `session.data`) */
      data: TreeData;
      touched: Touched;
      created: EditCreated;
      notes: MessageRef[];
    }
  | { ok: false; reject: MessageRef };

export const DEFAULT_UNDO_LIMIT = 200;

export class EditSession {
  private current: TreeData;
  private undoStack: EditOp[] = [];
  private redoStack: EditOp[] = [];
  private sinceSave = 0;

  constructor(
    data: TreeData,
    private readonly limit: number = DEFAULT_UNDO_LIMIT,
  ) {
    this.current = data;
  }

  get data(): TreeData {
    return this.current;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /**
   * Zahl der Schritte (Ändern, Rückgängig, Wiederholen) seit der letzten Sicherung. Sie zählt nur hoch:
   * ein Rückgängig stellt zwar den Stand her, ändert aber den Baum gegenüber der Sicherung.
   */
  get changesSinceSave(): number {
    return this.sinceSave;
  }

  /** Der aktuelle Stand ist gesichert (gespeichert, exportiert oder als Backup geschrieben). */
  markSaved(): void {
    this.sinceSave = 0;
  }

  /** Neuer Baum (z. B. geöffnet oder durch eine Übernahme ersetzt): Stapel und Zähler beginnen von vorn. */
  reset(data: TreeData): void {
    this.current = data;
    this.undoStack = [];
    this.redoStack = [];
    this.sinceSave = 0;
  }

  /** Wendet eine Operation an. Bei Ablehnung bleibt alles unverändert. */
  apply(op: EditOp): SessionResult {
    const r = applyEdit(this.current, op);
    if (!r.ok) return r;
    this.current = r.data;
    this.undoStack.push(r.inverse);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.sinceSave++;
    return { ok: true, kind: "apply", data: r.data, touched: r.touched, created: r.created, notes: r.notes };
  }

  undo(): SessionResult {
    return this.step("undo", this.undoStack, this.redoStack);
  }

  redo(): SessionResult {
    return this.step("redo", this.redoStack, this.undoStack);
  }

  private step(kind: StepKind, from: EditOp[], to: EditOp[]): SessionResult {
    const op = from[from.length - 1];
    if (!op) return { ok: false, reject: { code: `edit.reject.nothing-to-${kind}` } };
    const r = applyEdit(this.current, op);
    if (!r.ok) return r; // Stapel bleibt, damit nichts verloren geht
    from.pop();
    to.push(r.inverse);
    this.current = r.data;
    this.sinceSave++;
    return { ok: true, kind, data: r.data, touched: r.touched, created: r.created, notes: r.notes };
  }
}
