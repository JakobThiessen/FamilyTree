/**
 * SVG-Export der Szene (M9, D33). Reines TypeScript ohne DOM: aus derselben `Scene` wie auf der
 * Zeichenfläche entsteht ein eigenständiger SVG-Text (Karten, Linien, „+n“-Knöpfe, Titel).
 * Das SVG ist die Grundlage für Datei-Export UND Druck/PDF (der Browser druckt das SVG).
 * Zwei Farbschemata: „light“ (weißer Grund, spart Tinte beim Druck) und „dark“ (wie auf dem Bildschirm).
 */
import type { Scene, SceneCard, SceneEdge } from "./scene";
import { badgeRect } from "./scene";
import { COLORS } from "./style";

export type SvgTheme = "light" | "dark";

export interface SvgExportOptions {
  theme?: SvgTheme;
  /** Titel über dem Baum (leer = keiner) */
  title?: string;
  /** Rand um den Inhalt in Weltmaß */
  margin?: number;
}

interface Palette {
  background: string;
  card: string;
  text: string;
  textDim: string;
  focus: string;
  badge: string;
  badgeText: string;
  /** Hex-Farbe der Familienlinie ggf. abdunkeln (auf Weiß sind helle Pastellfarben schlecht lesbar) */
  tone: (hex: string) => string;
}

/** Mischt eine #rrggbb-Farbe mit Schwarz (f = 0..1 Anteil Schwarz). */
function darken(hex: string, f: number): string {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] as string, 16);
  const c = (v: number) => Math.round(v * (1 - f)).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const PALETTES: Record<SvgTheme, Palette> = {
  dark: {
    background: COLORS.background,
    card: COLORS.card,
    text: COLORS.text,
    textDim: COLORS.textDim,
    focus: COLORS.focus,
    badge: COLORS.badge,
    badgeText: COLORS.badgeText,
    tone: (h) => h,
  },
  light: {
    background: "#ffffff",
    card: "#ffffff",
    text: "#1a1d2b",
    textDim: "#555b73",
    focus: "#000000",
    badge: "#e8eaf2",
    badgeText: "#1a1d2b",
    tone: (h) => darken(h, 0.35),
  },
};

/** Zeichen, die in XML-Text und -Attributen nicht roh stehen dürfen. */
export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);
}

const num = (v: number): string => String(Math.round(v * 10) / 10);

function edgePath(e: SceneEdge): string {
  const p = e.points;
  let d = `M${num(p[0] as number)} ${num(p[1] as number)}`;
  if (e.curve && p.length >= 8) {
    d += `C${num(p[2] as number)} ${num(p[3] as number)} ${num(p[4] as number)} ${num(p[5] as number)} ${num(p[6] as number)} ${num(p[7] as number)}`;
  } else {
    for (let i = 2; i < p.length; i += 2) d += `L${num(p[i] as number)} ${num(p[i + 1] as number)}`;
  }
  return d;
}

/** Schneidet Text auf eine Zeichenzahl (wie die Zeichenfläche, damit nichts aus der Karte läuft). */
function clip(s: string, maxChars: number): string {
  return s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s;
}

function cardSvg(card: SceneCard, scene: Scene, pal: Palette): string {
  const n = card.node;
  const r = card.rect;
  const w = r.maxX - r.minX;
  const h = r.maxY - r.minY;
  const isFocus = n.key === scene.focusKey;
  const color = pal.tone(card.color);
  const dash = card.unconfirmed || n.ghost ? ` stroke-dasharray="6 4"` : "";
  const ar = Math.min(17, h / 2 - 12);
  const ax = r.minX + 14 + ar;
  const tx = ax + ar + 8;
  const maxChars = Math.max(6, Math.floor((r.maxX - 8 - tx) / 6.2));
  const op = n.ghost ? ` opacity="0.6"` : "";
  return (
    `<g${op}>` +
    `<rect x="${num(r.minX)}" y="${num(r.minY)}" width="${num(w)}" height="${num(h)}" rx="14" fill="${pal.card}" stroke="${isFocus ? pal.focus : color}" stroke-width="${isFocus ? 2.5 : 1.25}"${dash}/>` +
    `<circle cx="${num(ax)}" cy="${num(n.y)}" r="${num(ar)}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5"/>` +
    `<text x="${num(ax)}" y="${num(n.y + 5)}" text-anchor="middle" font-size="13" font-weight="700" fill="${color}">${xmlEscape(card.initials)}</text>` +
    `<text x="${num(tx)}" y="${num(n.y - 3)}" font-size="13" font-weight="600" fill="${pal.text}">${xmlEscape(clip((n.ghost ? "↺ " : "") + card.name, maxChars))}</text>` +
    `<text x="${num(tx)}" y="${num(n.y + 13)}" font-size="12" fill="${pal.textDim}">${xmlEscape(clip(card.dates, maxChars))}</text>` +
    `</g>`
  );
}

function badgeSvg(card: SceneCard, dir: "up" | "down", count: number, pal: Palette): string {
  const b = badgeRect(card, dir);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return (
    `<rect x="${num(b.minX)}" y="${num(b.minY)}" width="${num(w)}" height="${num(h)}" rx="9" fill="${pal.badge}" stroke="${pal.tone(card.color)}" stroke-width="1"/>` +
    `<text x="${num(b.minX + w / 2)}" y="${num(b.minY + h / 2 + 4)}" text-anchor="middle" font-size="11" fill="${pal.badgeText}">${dir === "up" ? "↑" : "↓"}+${count}</text>`
  );
}

/** Ergebnis: SVG-Text plus Größe (für die Seitenausrichtung beim Druck). */
export interface SvgExport {
  svg: string;
  width: number;
  height: number;
}

/** Baut das SVG der ganzen Szene (nicht nur des sichtbaren Ausschnitts). */
export function sceneToSvg(scene: Scene, options: SvgExportOptions = {}): SvgExport {
  const pal = PALETTES[options.theme ?? "light"];
  const margin = options.margin ?? 40;
  const title = options.title?.trim() ?? "";
  const titleH = title ? 44 : 0;
  const b = scene.bounds;
  const empty = scene.cards.length === 0 || !Number.isFinite(b.minX);
  const bx = empty ? 0 : b.minX;
  const by = empty ? 0 : b.minY;
  const bw = empty ? 200 : b.maxX - b.minX;
  const bh = empty ? 100 : b.maxY - b.minY;
  const width = Math.round(bw + margin * 2);
  const height = Math.round(bh + margin * 2 + titleH);
  const ox = margin - bx;
  const oy = margin + titleH - by;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${pal.background}"/>`);
  if (title) parts.push(`<text x="${margin}" y="${margin + 4}" font-size="22" font-weight="700" fill="${pal.text}">${xmlEscape(title)}</text>`);
  parts.push(`<g transform="translate(${num(ox)} ${num(oy)})">`);

  // Linien: nach Stil und Farbe in einem Pfad zusammengefasst (kleinere Datei)
  const groups = new Map<string, { e: SceneEdge; d: string[] }>();
  for (const e of scene.edges) {
    const key = `${e.color}|${e.style}|${e.ghost ? 1 : 0}|${e.width}`;
    const g = groups.get(key);
    if (g) g.d.push(edgePath(e));
    else groups.set(key, { e, d: [edgePath(e)] });
  }
  for (const { e, d } of groups.values()) {
    const dash = e.style === "dashed" ? ` stroke-dasharray="8 6"` : e.style === "dotted" ? ` stroke-dasharray="2 5"` : "";
    const op = e.ghost ? ` stroke-opacity="0.45"` : "";
    parts.push(`<path d="${d.join("")}" fill="none" stroke="${pal.tone(e.color)}" stroke-width="${e.width}"${dash}${op}/>`);
  }
  for (const card of scene.cards) {
    parts.push(cardSvg(card, scene, pal));
    if (card.node.hiddenParents > 0) parts.push(badgeSvg(card, "up", card.node.hiddenParents, pal));
    if (card.node.hiddenChildren > 0) parts.push(badgeSvg(card, "down", card.node.hiddenChildren, pal));
  }
  parts.push(`</g></svg>`);
  return { svg: parts.join("\n"), width, height };
}
