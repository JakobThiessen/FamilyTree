/** Nachrichten zwischen UI-Thread und Layout-Worker. */
import type { TreeChanges } from "../core/edit";
import type { LayoutResult } from "../core/layout";
import type { TreeData, ViewRequest } from "../core/types";

export type LayoutRequest =
  /** Baumdaten setzen oder ersetzen (schon platzierte Karten behalten ihre Position) */
  | { id: number; type: "setData"; data: Pick<TreeData, "persons" | "unions"> }
  /** Nur geänderte Datensätze nachführen (Bearbeiten); die Positionen bleiben */
  | { id: number; type: "applyChanges"; changes: TreeChanges }
  /** Layout für eine Ansicht berechnen (inkrementell bei gleichem Fokus und Modus) */
  | { id: number; type: "layout"; request: ViewRequest }
  /** Bisherige Positionen vergessen */
  | { id: number; type: "reset" };

export type LayoutResponse =
  | { id: number; ok: true; result?: LayoutResult }
  | { id: number; ok: false; error: string; code?: string; params?: Record<string, string | number> };
