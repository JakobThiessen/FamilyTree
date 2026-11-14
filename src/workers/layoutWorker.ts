/// <reference lib="webworker" />
/**
 * Web Worker: berechnet das Layout im Hintergrund, damit die Oberfläche beim Zoomen und Verschieben flüssig bleibt.
 * Die Arbeit steckt in `src/core/layout` (reines TypeScript). Der Worker lebt so lange wie die Ansicht und
 * merkt sich die Positionen, damit neue Chunks vorhandene Karten nicht verschieben.
 */
import { createLayoutHandler } from "./layoutHandler";
import type { LayoutRequest, LayoutResponse } from "./layoutMessages";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(message: LayoutResponse): void;
};

const handle = createLayoutHandler();
ctx.onmessage = (e) => ctx.postMessage(handle(e.data));
