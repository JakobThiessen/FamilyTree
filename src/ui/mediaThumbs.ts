// Vorschaubilder erzeugen (M11, D45/D46). Nur im Browser (createImageBitmap, Canvas).
// Das Original wird nur gelesen und nicht gespeichert; das Bild verlässt den Rechner nie.
import type { MediaThumb } from "./mediaHub";

/** Längste Kante der Vorschau in Pixeln. */
export const THUMB_SIDE = 400;
/** Kantenlänge des quadratischen Kartenbilds (Avatar-Kreis, bei starkem Zoom noch scharf). */
export const ICON_SIDE = 128;

/** Bilddateien, die der Browser lesen kann. */
export const isImageFile = (name: string): boolean => /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(name);

/** Zeichnet einen Ausschnitt von `bmp` in ein neues Bild und liefert es als JPEG. */
async function render(bmp: ImageBitmap, sx: number, sy: number, sw: number, sh: number, width: number, height: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(width, height);
    c.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, width, height);
    return c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, width, height);
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.8));
}

export async function makeThumb(file: Blob, side: number = THUMB_SIDE): Promise<MediaThumb> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const thumb = await render(bmp, 0, 0, bmp.width, bmp.height, width, height);
    // Quadratischer Ausschnitt für die Karte; bei Hochformat etwas oberhalb der Mitte (dort sind meist die Gesichter).
    const sq = Math.min(bmp.width, bmp.height);
    const icon = await render(bmp, (bmp.width - sq) / 2, (bmp.height - sq) * 0.25, sq, sq, Math.min(ICON_SIDE, sq), Math.min(ICON_SIDE, sq));
    return { thumb, icon, width, height, origWidth: bmp.width, origHeight: bmp.height };
  } finally {
    bmp.close();
  }
}
