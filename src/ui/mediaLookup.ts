// Zugriff der Oberfläche auf Vorschaubilder (M11, D45). Zwei Quellen: Arbeitsspeicher (frisch importiert,
// noch nicht gespeichert) und IndexedDB (gespeicherter Baum). Beide liefern dieselbe Form.
import type { MediaRecord, TreeStore } from "../storage";

export type MediaThumb = Omit<MediaRecord, "treeId" | "file">;

export interface MediaLookup {
  /** Vorschau zu `MediaRef.file`, oder `undefined`, wenn das Bild nicht geladen wurde */
  thumb(file: string): Promise<MediaThumb | undefined>;
}

export function memoryLookup(map: ReadonlyMap<string, MediaThumb>): MediaLookup {
  return { thumb: async (file) => map.get(file) };
}

export function storeLookup(store: TreeStore, treeId: string): MediaLookup {
  return { thumb: (file) => store.loadMedia(treeId, file) };
}
