/**
 * Zeichenfläche: zeichnet eine `Scene` auf ein Canvas-Element (Canvas 2D, ohne Framework).
 *
 * - Zoom (Mausrad, Zwei-Finger-Geste) und Verschieben (Ziehen) über `Camera`.
 * - Viewport-Culling: gezeichnet wird nur, was `GridIndex` für den sichtbaren Ausschnitt liefert.
 * - Detailstufen (LOD): weit herausgezoomt nur Farbflächen, mittel ohne Text, nah mit Text.
 * - Zeichnen nur bei Änderung (Schmutz-Flagge + `requestAnimationFrame`).
 *
 * Die Klasse kennt weder Svelte noch den Worker: Sie bekommt ein `LayoutResult` und meldet Klicks als Ereignisse.
 */
import type { LayoutResult } from "../core/layout";
import type { Person, PersonId } from "../core/types";
import { Camera } from "./camera";
import type { Rect } from "./camera";
import { BADGE, badgeRect, buildScene } from "./scene";
import { edgeDirection } from "./scene";
import type { BadgeDirection, Scene, SceneCard, SceneEdge, SceneOptions } from "./scene";
import { COLORS } from "./style";

/** Ab diesem Zoom zeichnen wir Text, ab diesem Rahmen und Streifen; darunter nur Farbflächen. */
export const LOD_TEXT = 0.3;
export const LOD_DETAIL = 0.06;
/** Ab diesem Zoom steht die Rolle zur Fokusperson auf der Karte (nur wenige Karten sichtbar, Text ist teuer). */
export const LOD_ROLE = 0.55;
/** Unter diesem Zoom werden S-Kurven als Gerade gezeichnet (D28). */
export const LOD_CURVE = 0.12;
/** Bei mehr Karten fährt die Kamera nicht weich, sondern springt (D28). */
const ANIMATE_MAX_CARDS = 4000;
const ANIMATE_MS = 380;
/** Wer in den Systemeinstellungen weniger Bewegung wünscht, bekommt keine Kamerafahrt (Barrierefreiheit, D35). */
const prefersReducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const CARD_RADIUS = 14;

export interface DrawStats {
  /** Zeichenzeit in Millisekunden */
  ms: number;
  cards: number;
  edges: number;
}

export interface TreeViewEvents {
  /** Klick auf eine Karte (bei Geistern die Person der echten Karte) */
  onFocus?: (personId: PersonId) => void;
  /** Klick auf „+n“ */
  onExpand?: (card: SceneCard, dir: BadgeDirection) => void;
  onDraw?: (stats: DrawStats) => void;
  /** Rolle der Person zur Fokusperson („Vater“, „Cousine 1. Grades“ …); wird nur für sichtbare Karten bei starkem Zoom gefragt */
  roleOf?: (personId: PersonId) => string | undefined;
}

interface Hit {
  card: SceneCard;
  badge?: BadgeDirection;
}

const inRect = (r: Rect, x: number, y: number): boolean => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

export class TreeView {
  readonly camera = new Camera();
  scene: Scene | null = null;
  lastStats: DrawStats = { ms: 0, cards: 0, edges: 0 };

  private readonly ctx: CanvasRenderingContext2D;
  private persons: ReadonlyMap<PersonId, Person> = new Map();
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dirty = false;
  private frame = 0;
  private hover: Hit | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = 0;
  private pinchDist = 0;
  private disposed = false;
  private options: SceneOptions = {};
  /** Breite (CSS-Pixel) am linken Rand, die ein schwebendes Panel verdeckt: Einpassen und Zentrieren sparen sie aus */
  private insetLeft = 0;
  private lastResult: LayoutResult | null = null;
  private roleCache = new Map<PersonId, string>();
  private background: { h: number; g: CanvasGradient } | null = null;
  private anim: { t0: number; from: [number, number, number]; to: [number, number, number] } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly events: TreeViewEvents = {}) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D nicht verfügbar");
    this.ctx = ctx;
    canvas.style.touchAction = "none"; // Gesten selbst auswerten, nicht scrollen lassen
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  // ---------------------------------------------------------------- Daten

  setPersons(persons: ReadonlyMap<PersonId, Person>): void {
    this.persons = persons;
  }

  /**
   * Zeigt ein Layout. `resetView`: Kamera neu ausrichten (bei neuem Fokus); sonst bleibt die Ansicht stehen,
   * so dass beim Aufklappen die vorhandenen Karten an ihrem Platz bleiben.
   */
  setResult(result: LayoutResult, resetView: boolean): void {
    const hadScene = this.scene !== null && this.scene.cards.length > 0;
    const from: [number, number, number] = [this.camera.scale, this.camera.tx, this.camera.ty];
    this.lastResult = result;
    this.scene = buildScene(result, this.persons, this.options);
    this.hover = null;
    this.roleCache.clear();
    if (resetView) this.showFocus(hadScene && this.scene.cards.length <= ANIMATE_MAX_CARDS ? from : undefined);
    this.invalidate();
  }

  /** Sprache gewechselt: Rollen-Zwischenspeicher leeren und Szene neu bauen (Namen, Rollen), Kamera bleibt. */
  refreshLabels(): void {
    this.roleCache.clear();
    this.setOptions(this.options);
  }

  /** Filter und Linienführung ändern: Szene aus dem letzten Layout neu bauen, Kamera bleibt. */
  setOptions(options: SceneOptions): void {
    this.options = { ...options };
    if (this.lastResult) {
      this.scene = buildScene(this.lastResult, this.persons, this.options);
      this.hover = null;
    }
    this.invalidate();
  }

  setInset(left: number): void {
    this.insetLeft = Math.max(0, left);
  }

  /** Zahl der Personen nach/vor dem Filter (für „x von y sichtbar“ in der Oberfläche). */
  get visibleCounts(): { visible: number; total: number } {
    return { visible: this.scene?.visiblePersons ?? 0, total: this.scene?.totalPersons ?? 0 };
  }

  /**
   * Richtet die Kamera auf die ganze Ansicht aus; ist sie dafür zu klein, auf die Fokuskarte.
   * Mit `animateFrom` (Kamera vor dem Wechsel) gleitet sie weich dorthin statt zu springen.
   */
  showFocus(animateFrom?: [number, number, number]): void {
    const scene = this.scene;
    if (!scene || scene.cards.length === 0) return;
    this.fit();
    if (this.camera.scale < 0.5) {
      const focus = scene.cards.find((c) => c.node.key === scene.focusKey) ?? scene.cards[0]!;
      this.camera.scale = 0.8;
      this.camera.centerOn(focus.node.x, focus.node.y, this.width - this.insetLeft, this.height);
      this.camera.tx += this.insetLeft;
    }
    this.anim = null;
    if (animateFrom && !prefersReducedMotion()) {
      const to: [number, number, number] = [this.camera.scale, this.camera.tx, this.camera.ty];
      this.camera.scale = animateFrom[0];
      this.camera.tx = animateFrom[1];
      this.camera.ty = animateFrom[2];
      this.anim = { t0: performance.now(), from: animateFrom, to };
    }
    this.invalidate();
  }

  /** Ein Schritt der Kamerafahrt (Ease-out, Zoom logarithmisch); true, solange sie läuft. */
  private stepAnimation(): boolean {
    const a = this.anim;
    if (!a) return false;
    const t = Math.min(1, (performance.now() - a.t0) / ANIMATE_MS);
    const e = 1 - Math.pow(1 - t, 3);
    this.camera.scale = Math.exp(Math.log(a.from[0]) + (Math.log(a.to[0]) - Math.log(a.from[0])) * e);
    this.camera.tx = a.from[1] + (a.to[1] - a.from[1]) * e;
    this.camera.ty = a.from[2] + (a.to[2] - a.from[2]) * e;
    if (t >= 1) this.anim = null;
    return this.anim !== null;
  }

  fit(): void {
    if (!this.scene) return;
    this.anim = null;
    const b = this.scene.bounds;
    this.camera.fit({ minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY }, this.width - this.insetLeft, this.height);
    this.camera.tx += this.insetLeft;
    this.invalidate();
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt(this.width / 2, this.height / 2, factor);
    this.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);
  }

  // ------------------------------------------------------------ Zeichnen

  invalidate(): void {
    if (this.dirty || this.disposed) return;
    this.dirty = true;
    this.frame = requestAnimationFrame(() => {
      this.dirty = false;
      this.draw();
      if (this.anim) this.invalidate(); // Kamerafahrt läuft weiter
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.invalidate();
  }

  /** Zeichnet sofort (auch für Messungen); gibt Zeit und Zahl der gezeichneten Elemente zurück. */
  draw(): DrawStats {
    const t0 = performance.now();
    const { ctx, camera } = this;
    this.stepAnimation();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Sanfter Verlauf von oben nach unten; der Verlauf wird je Höhe nur einmal angelegt.
    if (!this.background || this.background.h !== this.canvas.height) {
      const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
      g.addColorStop(0, COLORS.backgroundTop);
      g.addColorStop(1, COLORS.backgroundBottom);
      this.background = { h: this.canvas.height, g };
    }
    ctx.fillStyle = this.background.g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let cards = 0;
    let edges = 0;
    const scene = this.scene;
    if (scene && scene.cards.length > 0) {
      const k = camera.scale;
      ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * camera.tx, this.dpr * camera.ty);
      const view = this.visibleWorld(scene);

      // Culling: nur Elemente im sichtbaren Ausschnitt
      const edgeIds: number[] = [];
      scene.edgeIndex.query(view, (id) => {
        const e = scene.edges[id] as SceneEdge;
        if (this.edgeVisible(e, view)) edgeIds.push(id);
      });
      const cardIds: number[] = [];
      scene.cardIndex.query(view, (id) => {
        const c = scene.cards[id] as SceneCard;
        const r = c.rect;
        if (r.maxX >= view.minX && r.minX <= view.maxX && r.maxY + BADGE.h + BADGE.gap >= view.minY && r.minY - BADGE.h - BADGE.gap <= view.maxY) cardIds.push(id);
      });
      edges = edgeIds.length;
      cards = cardIds.length;

      this.drawEdges(scene, edgeIds, k);
      if (k >= LOD_DETAIL) this.drawCards(scene, cardIds, k);
      else this.drawCardDots(scene, cardIds);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lastStats = { ms: performance.now() - t0, cards, edges };
    this.events.onDraw?.(this.lastStats);
    return this.lastStats;
  }

  /** Sichtbarer Ausschnitt, auf den Rahmen der Szene begrenzt (sonst müsste der Index leere Zellen durchlaufen). */
  private visibleWorld(scene: Scene): Rect {
    const v = this.camera.visibleRect(this.width, this.height, 30);
    const b = scene.bounds;
    return {
      minX: Math.max(v.minX, b.minX - 1), maxX: Math.min(v.maxX, b.maxX + 1),
      minY: Math.max(v.minY, b.minY - 1), maxY: Math.min(v.maxY, b.maxY + 1),
    };
  }

  private edgeVisible(e: SceneEdge, view: Rect): boolean {
    const p = e.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i] as number, y = p[i + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return maxX >= view.minX && minX <= view.maxX && maxY >= view.minY && minY <= view.maxY;
  }

  /** Linien werden nach Farbe/Stil gebündelt: ein Pfad und ein `stroke` je Gruppe statt je Linie. */
  private drawEdges(scene: Scene, ids: number[], k: number): void {
    const ctx = this.ctx;
    // Hervorhebung: bei Hover die Linien der überfahrenen Karte (übrige blasser), sonst die der Fokuskarte.
    const hovered = this.hover && !this.hover.badge ? this.hover.card.node.key : null;
    const active = hovered ?? scene.focusKey;
    const dim = hovered !== null;
    const lit: { id: number; dir: "up" | "down" }[] = [];
    const groups = new Map<string, number[]>();
    for (const id of ids) {
      const e = scene.edges[id] as SceneEdge;
      const dir = active ? edgeDirection(e, active) : null;
      if (dir) {
        lit.push({ id, dir });
        continue;
      }
      const key = `${e.color}|${e.style}|${e.ghost ? 1 : 0}|${e.width}`;
      const g = groups.get(key);
      if (g) g.push(id);
      else groups.set(key, [id]);
    }
    for (const [key, list] of groups) {
      const sample = scene.edges[list[0] as number] as SceneEdge;
      ctx.strokeStyle = sample.color;
      ctx.globalAlpha = (sample.ghost ? 0.45 : 1) * (dim ? 0.4 : 1);
      ctx.lineWidth = Math.max(sample.width, 1 / k); // nie dünner als ein Pixel
      ctx.setLineDash(sample.style === "dashed" ? [8, 6] : sample.style === "dotted" ? [2, 5] : []);
      ctx.beginPath();
      for (const id of list) {
        const e = scene.edges[id] as SceneEdge;
        const p = e.points;
        ctx.moveTo(p[0] as number, p[1] as number);
        if (e.curve) {
          // S-Kurve; weit herausgezoomt genügt die Gerade (billiger, D28)
          if (k >= LOD_CURVE) ctx.bezierCurveTo(p[2] as number, p[3] as number, p[4] as number, p[5] as number, p[6] as number, p[7] as number);
          else ctx.lineTo(p[6] as number, p[7] as number);
        } else {
          for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] as number, p[i + 1] as number);
        }
      }
      ctx.stroke();
      void key;
    }
    // Hervorgehobene Linien zuletzt: nach oben (Eltern) gelb, nach unten (Kinder) türkis, Stil bleibt erkennbar.
    for (const dir of ["up", "down"] as const) {
      const mine = lit.filter((l) => l.dir === dir);
      if (mine.length === 0) continue;
      ctx.strokeStyle = dir === "up" ? COLORS.edgeUp : COLORS.edgeDown;
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(3.2, 1.5 / k);
      for (const style of ["solid", "dashed", "dotted"] as const) {
        const part = mine.filter((l) => (scene.edges[l.id] as SceneEdge).style === style);
        if (part.length === 0) continue;
        ctx.setLineDash(style === "dashed" ? [8, 6] : style === "dotted" ? [2, 5] : []);
        ctx.beginPath();
        for (const { id } of part) {
          const e = scene.edges[id] as SceneEdge;
          const p = e.points;
          ctx.moveTo(p[0] as number, p[1] as number);
          if (e.curve) {
            if (k >= LOD_CURVE) ctx.bezierCurveTo(p[2] as number, p[3] as number, p[4] as number, p[5] as number, p[6] as number, p[7] as number);
            else ctx.lineTo(p[6] as number, p[7] as number);
          } else {
            for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] as number, p[i + 1] as number);
          }
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Weit herausgezoomt: je Familienfarbe ein Pfad aus Rechtecken. */
  private drawCardDots(scene: Scene, ids: number[]): void {
    const ctx = this.ctx;
    const groups = new Map<string, number[]>();
    for (const id of ids) {
      const c = scene.cards[id] as SceneCard;
      const g = groups.get(c.color);
      if (g) g.push(id);
      else groups.set(c.color, [id]);
    }
    for (const [color, list] of groups) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const id of list) {
        const r = (scene.cards[id] as SceneCard).rect;
        ctx.rect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
      }
      ctx.fill();
    }
  }

  private drawCards(scene: Scene, ids: number[], k: number): void {
    const ctx = this.ctx;
    const text = k >= LOD_TEXT;
    const roles = k >= LOD_ROLE && this.events.roleOf !== undefined;
    ctx.textBaseline = "alphabetic";
    for (const id of ids) {
      const card = scene.cards[id] as SceneCard;
      const n = card.node;
      const r = card.rect;
      const w = r.maxX - r.minX;
      const h = r.maxY - r.minY;
      const isFocus = n.key === scene.focusKey;
      const isHover = this.hover?.card === card && !this.hover.badge;
      ctx.globalAlpha = n.ghost ? 0.6 : 1;

      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(r.minX, r.minY, w, h, text ? CARD_RADIUS : 6);
      else ctx.rect(r.minX, r.minY, w, h);
      // Leuchten nur bei Fokus und Hover (Schatten ist teuer, D28)
      if (isFocus || isHover) {
        ctx.shadowColor = isFocus ? COLORS.focusGlow : card.color;
        ctx.shadowBlur = isFocus ? 22 : 14;
      }
      ctx.fillStyle = COLORS.card;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      ctx.lineWidth = isFocus ? 2.5 : isHover ? 2 : 1.25;
      ctx.strokeStyle = isFocus ? COLORS.focus : isHover ? card.color : card.color + "88";
      ctx.setLineDash(card.unconfirmed || n.ghost ? [6, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // Avatar-Kreis mit Initialen in der Farbe der Familienlinie
      const ar = Math.min(17, h / 2 - 12);
      const ax = r.minX + 14 + ar;
      ctx.beginPath();
      ctx.arc(ax, n.y, ar, 0, Math.PI * 2);
      ctx.fillStyle = card.color + "30";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = card.color;
      ctx.stroke();

      if (text) {
        ctx.fillStyle = card.color;
        ctx.font = "700 13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(card.initials, ax, n.y + 5);
        ctx.textAlign = "start";

        const tx = ax + ar + 8;
        const maxChars = Math.max(6, Math.floor((r.maxX - 8 - tx) / 6.2));
        const clip = (s: string): string => (s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s);
        const role = roles && !isFocus && !n.ghost ? this.roleFor(n.personId) : undefined;
        const nameY = role ? n.y - 8 : n.y - 3;
        ctx.fillStyle = COLORS.text;
        ctx.font = "600 13px system-ui, sans-serif";
        ctx.fillText(clip((n.ghost ? "↺ " : "") + card.name), tx, nameY);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText(clip(card.dates), tx, nameY + 16);
        if (role) {
          ctx.fillStyle = card.color;
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.fillText(clip(role), tx, nameY + 31);
        }
      }
      ctx.globalAlpha = 1;

      // „+n“-Knöpfe: ab mittlerem Zoom sichtbar
      if (k >= 0.2) {
        if (n.hiddenParents > 0) this.drawBadge(card, "up", n.hiddenParents, text);
        if (n.hiddenChildren > 0) this.drawBadge(card, "down", n.hiddenChildren, text);
      }
    }
  }

  /** Rolle zur Fokusperson, je Fokus zwischengespeichert (die Berechnung ist nicht ganz billig). */
  private roleFor(personId: PersonId): string | undefined {
    if (this.roleCache.has(personId)) return this.roleCache.get(personId) || undefined;
    const role = this.events.roleOf?.(personId) ?? "";
    this.roleCache.set(personId, role);
    return role || undefined;
  }

  private drawBadge(card: SceneCard, dir: BadgeDirection, count: number, text: boolean): void {
    const ctx = this.ctx;
    const b = badgeRect(card, dir);
    const hot = this.hover?.card === card && this.hover.badge === dir;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, 9);
    else ctx.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.fillStyle = hot ? card.color : COLORS.badge;
    ctx.fill();
    ctx.strokeStyle = card.color;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (text) {
      ctx.fillStyle = hot ? COLORS.background : COLORS.badgeText;
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText((dir === "up" ? "▲ +" : "▼ +") + count, (b.minX + b.maxX) / 2, b.maxY - 5);
      ctx.textAlign = "start";
    }
  }

  // ------------------------------------------------------- Treffertest

  /** Karte oder „+n“-Knopf unter einem Bildschirmpunkt. */
  hitTest(sx: number, sy: number): Hit | null {
    const scene = this.scene;
    if (!scene) return null;
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    let found: Hit | null = null;
    scene.cardIndex.query({ minX: wx, maxX: wx, minY: wy, maxY: wy }, (id) => {
      const card = scene.cards[id] as SceneCard;
      const n = card.node;
      if (n.hiddenParents > 0 && inRect(badgeRect(card, "up"), wx, wy)) found = { card, badge: "up" };
      else if (n.hiddenChildren > 0 && inRect(badgeRect(card, "down"), wx, wy)) found = { card, badge: "down" };
      else if (inRect(card.rect, wx, wy) && !found) found = { card };
    });
    return found;
  }

  // ------------------------------------------------------ Eingaben

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, this.local(e));
    try {
      this.canvas.setPointerCapture(e.pointerId); // Ziehen auch außerhalb des Canvas weiter verfolgen
    } catch {
      /* ohne aktiven Zeiger (z. B. synthetische Ereignisse) nicht nötig */
    }
    if (this.pointers.size === 1) this.dragMoved = 0;
    if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // kein Knopf gedrückt: nur Hover
      const hit = this.hitTest(p.x, p.y);
      if (hit?.card !== this.hover?.card || hit?.badge !== this.hover?.badge) {
        this.hover = hit;
        this.canvas.style.cursor = hit ? "pointer" : "grab";
        this.invalidate();
      }
      return;
    }
    if (this.pointers.size === 1) {
      this.dragMoved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      this.camera.panBy(p.x - prev.x, p.y - prev.y);
    } else if (this.pointers.size === 2) {
      // Zwei Finger: Abstandsänderung = Zoom um die Mitte, Mittelpunktbewegung = Verschieben
      this.pointers.set(e.pointerId, p);
      const dist = this.pinchDistance();
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      if (this.pinchDist > 0 && dist > 0) this.camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / this.pinchDist);
      this.pinchDist = dist;
      this.dragMoved = 99;
      this.invalidate();
      return;
    }
    this.pointers.set(e.pointerId, p);
    this.invalidate();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const wasSingle = this.pointers.size === 1;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    this.pinchDist = 0;
    if (e.type === "pointerup" && wasSingle && this.dragMoved < 5) {
      const hit = this.hitTest(p.x, p.y);
      if (hit?.badge) this.events.onExpand?.(hit.card, hit.badge);
      else if (hit) this.events.onFocus?.(hit.card.node.personId);
    }
  };

  private readonly onPointerLeave = (): void => {
    if (this.hover) {
      this.hover = null;
      this.invalidate();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : 1; // Zeilen- statt Pixelmodus
    this.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.0015));
    this.invalidate();
  };
}
