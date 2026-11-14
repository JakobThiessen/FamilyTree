/**
 * Kamera der Zeichenfläche: Zoom und Verschieben (reines TypeScript, ohne DOM, daher testbar).
 *
 * Bildschirm = Welt * scale + (tx, ty). Die Welt ist das Koordinatensystem des Layouts.
 */
import type { LayoutBounds } from "../core/layout";

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  scale = 1;
  tx = 0;
  ty = 0;
  minScale = 0.01;
  maxScale = 4;

  worldToScreen(x: number, y: number): [number, number] {
    return [x * this.scale + this.tx, y * this.scale + this.ty];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.tx) / this.scale, (sy - this.ty) / this.scale];
  }

  /** Verschiebt die Ansicht um Bildschirmpixel. */
  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
  }

  /** Zoomt um den Faktor `factor`, der Weltpunkt unter (sx, sy) bleibt dabei stehen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const real = next / this.scale;
    this.tx = sx - (sx - this.tx) * real;
    this.ty = sy - (sy - this.ty) * real;
    this.scale = next;
  }

  /** Stellt den Weltpunkt (wx, wy) in die Mitte der Fläche (width × height Pixel). */
  centerOn(wx: number, wy: number, width: number, height: number): void {
    this.tx = width / 2 - wx * this.scale;
    this.ty = height / 2 - wy * this.scale;
  }

  /** Passt einen Rahmen ein (mit Rand), höchstens aber `maxFitScale` vergrößert. */
  fit(bounds: LayoutBounds, width: number, height: number, padding = 40, maxFitScale = 1): void {
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const s = Math.min((width - 2 * padding) / w, (height - 2 * padding) / h, maxFitScale);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, s));
    this.centerOn((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, width, height);
  }

  /** Sichtbarer Ausschnitt der Welt, optional mit Rand (in Weltmaß). */
  visibleRect(width: number, height: number, margin = 0): Rect {
    const [minX, minY] = this.screenToWorld(0, 0);
    const [maxX, maxY] = this.screenToWorld(width, height);
    return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
  }
}
