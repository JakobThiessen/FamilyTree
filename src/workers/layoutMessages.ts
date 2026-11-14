/** Nachrichten zwischen UI-Thread und Layout-Worker. */
import type { LayoutResult } from "../core/layout";
import type { TreeData, ViewRequest } from "../core/types";

export type LayoutRequest =
  /** Baumdaten setzen oder ersetzen (schon platzierte Karten behalten ihre Position) */
  | { id: number; type: "setData"; data: Pick<TreeData, "persons" | "unions"> }
  /** Layout für eine Ansicht berechnen (inkrementell bei gleichem Fokus und Modus) */
  | { id: number; type: "layout"; request: ViewRequest }
  /** Bisherige Positionen vergessen */
  | { id: number; type: "reset" };

export type LayoutResponse =
  | { id: number; ok: true; result?: LayoutResult }
  | { id: number; ok: false; error: string };
