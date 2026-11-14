/**
 * Einfaches Raster als räumlicher Index für das Viewport-Culling.
 * Jedes Element wird in alle Zellen eingetragen, die sein Rechteck berührt;
 * eine Abfrage liest nur die Zellen des sichtbaren Ausschnitts.
 */
import type { Rect } from "./camera";

/** Grenze der Zellkoordinaten (±): schützt vor absurd großen Koordinaten, die Schleifen endlos machen würden. */
const LIMIT = 0x7ffff;
const clampCell = (v: number): number => (Number.isNaN(v) ? 0 : Math.max(-LIMIT, Math.min(LIMIT, Math.floor(v))));

export class GridIndex {
  private readonly cells = new Map<number, number[]>();
  /** Elemente, die sehr viele Zellen überdecken: kommen in jeder Abfrage vor, statt tausendfach eingetragen zu werden */
  private readonly oversized: number[] = [];
  private stamp: Int32Array = new Int32Array(0);
  private run = 0;

  constructor(private readonly cellSize = 512) {}

  private key(cx: number, cy: number): number {
    return (cx + 0x80000) * 0x100000 + (cy + 0x80000);
  }

  /** Trägt Element `id` mit seinem Rechteck ein. `id` zählt dicht von 0 aufwärts. */
  insert(id: number, r: Rect): void {
    const s = this.cellSize;
    const x0 = clampCell(r.minX / s), x1 = clampCell(r.maxX / s);
    const y0 = clampCell(r.minY / s), y1 = clampCell(r.maxY / s);
    if (id >= this.stamp.length) {
      const grown = new Int32Array(Math.max(16, this.stamp.length * 2, id + 1));
      grown.set(this.stamp);
      this.stamp = grown;
    }
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) {
      this.oversized.push(id);
      return;
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }

  /** Ruft `visit` für jedes Element, dessen Zelle den Ausschnitt berührt (je Element höchstens einmal). */
  query(r: Rect, visit: (id: number) => void): void {
    const s = this.cellSize;
    const x0 = clampCell(r.minX / s), x1 = clampCell(r.maxX / s);
    const y0 = clampCell(r.minY / s), y1 = clampCell(r.maxY / s);
    const run = ++this.run;
    const take = (list: number[]): void => {
      for (const id of list) {
        if (this.stamp[id] === run) continue;
        this.stamp[id] = run;
        visit(id);
      }
    };
    take(this.oversized);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      // Ausschnitt größer als der Bestand: lieber alle belegten Zellen prüfen als alle Zellen des Ausschnitts
      for (const [k, list] of this.cells) {
        const cx = Math.floor(k / 0x100000) - 0x80000;
        const cy = (k % 0x100000) - 0x80000;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) take(list);
      }
      return;
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) take(list);
      }
    }
  }
}
