// Vorschaubilder erzeugen (M11, D45). Nur im Browser (createImageBitmap, Canvas).
// Das Original wird nur gelesen und nicht gespeichert; das Bild verlässt den Rechner nie.
import type { MediaThumb } from "./mediaLookup";

/** Längste Kante der Vorschau in Pixeln. */
export const THUMB_SIDE = 400;

/** Bilddateien, die der Browser lesen kann. */
export const isImageFile = (name: string): boolean => /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(name);

export async function makeThumb(file: Blob, side: number = THUMB_SIDE): Promise<MediaThumb> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    let blob: Blob;
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(width, height);
      c.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
      blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    } else {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      c.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
      blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.8));
    }
    return { thumb: blob, width, height, origWidth: bmp.width, origHeight: bmp.height };
  } finally {
    bmp.close();
  }
}
