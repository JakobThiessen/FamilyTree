/**
 * Nachrichtenverarbeitung des Layout-Workers, getrennt vom Worker selbst,
 * damit sie ohne Browser getestet werden kann.
 */
import { LayoutSession } from "../core/layout";
import type { LayoutRequest, LayoutResponse } from "./layoutMessages";

export function createLayoutHandler(): (msg: LayoutRequest) => LayoutResponse {
  let session = new LayoutSession({ persons: [], unions: [] });
  return (msg) => {
    try {
      switch (msg.type) {
        case "setData":
          session.setData(msg.data);
          return { id: msg.id, ok: true };
        case "layout":
          return { id: msg.id, ok: true, result: session.layout(msg.request) };
        case "reset":
          session.reset();
          return { id: msg.id, ok: true };
      }
    } catch (err) {
      return { id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}
