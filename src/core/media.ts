/** Hilfen für Medien einer Person (reines TypeScript, D46). */
import type { MediaRef } from "./types";

/**
 * Welches Bild steht als Avatar auf der Karte? Ein Gesichtsausschnitt (`cutout`) passt in den
 * kleinen Kreis am besten, danach das Hauptbild, danach das erste Bild. Ohne Medien: `undefined`.
 */
export function avatarRef(media: readonly MediaRef[] | undefined): MediaRef | undefined {
  if (!media?.length) return undefined;
  return media.find((m) => m.cutout && m.primary) ?? media.find((m) => m.cutout) ?? media.find((m) => m.primary) ?? media[0];
}

/** Reihenfolge zum Erzeugen der Vorschauen: Avatarbilder zuerst, damit die Karten früh Gesichter bekommen. */
export function mediaPriority(m: MediaRef): number {
  return m.cutout ? 0 : m.primary ? 1 : 2;
}
