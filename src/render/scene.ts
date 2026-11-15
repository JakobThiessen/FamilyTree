/**
 * Szene: aus dem `LayoutResult` und den Personendaten werden zeichenfertige Karten und Linien.
 * Reines TypeScript (ohne DOM), damit der Aufbau in Node getestet und gemessen werden kann.
 *
 * Linienführung (D28): Standard sind weiche S-Kurven (Bézier) vom Union-Anker zu jedem Kind. Alternativ
 * „rechtwinklig“ (D23): Stamm nach unten zu einer waagerechten „Sammelschiene“, von dort senkrecht zu jedem
 * Kind; überlappen sich die Schienen derselben Schicht, bekommen sie versetzte Spuren (Lanes).
 * Filter (`SceneOptions`) blenden unbestätigte Verbindungen und unbekannte Personen aus, ohne das Layout zu ändern.
 */
import type { LayoutNode, LayoutResult, LayoutUnion } from "../core/layout";
import type { Person, PersonId } from "../core/types";
import type { Rect } from "./camera";
import { GridIndex } from "./gridIndex";
import { COLORS, displayName, initials, isUnknownPerson, lifeSpan, lineColor } from "./style";

export type LineStyle = "solid" | "dashed" | "dotted";

export type LineMode = "curved" | "orthogonal";

export interface SceneOptions {
  /** Linienführung, Standard `curved` */
  lineMode?: LineMode;
  /** Unbestätigte (gestrichelte) Verbindungen zeigen, Standard `true` */
  showUnconfirmed?: boolean;
  /** Unbekannte Personen (ohne Namen oder Status „unknown“) zeigen, Standard `true` */
  showUnknown?: boolean;
}

export interface SceneCard {
  node: LayoutNode;
  name: string;
  /** Ein bis zwei Buchstaben für den Avatar-Kreis */
  initials: string;
  dates: string;
  /** Farbe der Familienlinie */
  color: string;
  /** Person ist als vermutet/unbekannt markiert (gestrichelter Rahmen) */
  unconfirmed: boolean;
  rect: Rect;
}

export interface SceneEdge {
  /** Linienzug als x0,y0,x1,y1,…; bei `curve` genau vier Punkte einer kubischen Bézierkurve (Start, 2 Stützpunkte, Ende) */
  points: number[];
  /** Als S-Kurve zeichnen (bei starkem Herauszoomen genügt die Gerade Start–Ende) */
  curve?: boolean;
  style: LineStyle;
  color: string;
  width: number;
  /** Linie gehört zu einem Geisterknoten (blasser gezeichnet) */
  ghost: boolean;
  /** Karten-Schlüssel der Eltern der Verbindung (nur Eltern-Kind-Linien); für die Hervorhebung */
  parents?: string[];
  /** Karten-Schlüssel der Kinder, zu denen die Linie führt (Stamm: alle Kinder der Verbindung) */
  kids?: string[];
}

/** Richtung einer Linie von einer Karte aus: `up` führt zu ihren Eltern, `down` zu ihren Kindern. */
export function edgeDirection(e: SceneEdge, cardKey: string): "up" | "down" | null {
  if (e.kids?.includes(cardKey)) return "up";
  if (e.parents?.includes(cardKey)) return "down";
  return null;
}

export interface Scene {
  cards: SceneCard[];
  edges: SceneEdge[];
  cardIndex: GridIndex;
  edgeIndex: GridIndex;
  /** Rahmen aller Karten samt „+n“-Knöpfen */
  bounds: Rect;
  focusKey: string | null;
  lineMode: LineMode;
  /** Personen (ohne Geister) nach dem Filter und vor dem Filter */
  visiblePersons: number;
  totalPersons: number;
}

/** Größe und Abstand des „+n“-Knopfes (Weltmaß). */
export const BADGE = { w: 40, h: 18, gap: 4 };

export type BadgeDirection = "up" | "down";

/** Rechteck des „+n“-Knopfes einer Karte (über der Karte = Eltern, darunter = Kinder). */
export function badgeRect(card: SceneCard, dir: BadgeDirection): Rect {
  const n = card.node;
  const cx = n.x;
  if (dir === "up") {
    const maxY = n.y - n.height / 2 - BADGE.gap;
    return { minX: cx - BADGE.w / 2, maxX: cx + BADGE.w / 2, minY: maxY - BADGE.h, maxY };
  }
  const minY = n.y + n.height / 2 + BADGE.gap;
  return { minX: cx - BADGE.w / 2, maxX: cx + BADGE.w / 2, minY, maxY: minY + BADGE.h };
}

const MAX_LANES = 4;
const LANE_PAD = 8;

const unconfirmed = (s: string | undefined): boolean => s === "assumed" || s === "unknown";

function boundsOf(points: number[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i] as number, y = points[i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function buildScene(result: LayoutResult, persons: ReadonlyMap<PersonId, Person>, options: SceneOptions = {}): Scene {
  const lineMode = options.lineMode ?? "curved";
  const showUnconfirmed = options.showUnconfirmed ?? true;
  const showUnknown = options.showUnknown ?? true;
  const cardIndex = new GridIndex();
  const edgeIndex = new GridIndex();
  const cards: SceneCard[] = [];
  const byKey = new Map<string, SceneCard>();
  const bounds: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  let totalPersons = 0;
  let visiblePersons = 0;
  for (const node of result.nodes) {
    const person = persons.get(node.personId);
    if (!node.ghost) totalPersons++;
    // Die Fokuskarte bleibt immer stehen, auch wenn sie „unbekannt“ wäre.
    if (!showUnknown && node.key !== result.focusKey && isUnknownPerson(person)) continue;
    if (!node.ghost) visiblePersons++;
    const rect: Rect = {
      minX: node.x - node.width / 2,
      maxX: node.x + node.width / 2,
      minY: node.y - node.height / 2,
      maxY: node.y + node.height / 2,
    };
    const card: SceneCard = {
      node,
      name: displayName(person),
      initials: initials(person),
      dates: lifeSpan(person),
      color: lineColor(person?.surname),
      unconfirmed: unconfirmed(person?.status),
      rect,
    };
    const pad = BADGE.h + BADGE.gap; // „+n“-Knöpfe gehören zum Platzbedarf
    const padded = { minX: rect.minX, maxX: rect.maxX, minY: rect.minY - pad, maxY: rect.maxY + pad };
    cardIndex.insert(cards.length, padded);
    cards.push(card);
    byKey.set(node.key, card);
    bounds.minX = Math.min(bounds.minX, padded.minX);
    bounds.maxX = Math.max(bounds.maxX, padded.maxX);
    bounds.minY = Math.min(bounds.minY, padded.minY);
    bounds.maxY = Math.max(bounds.maxY, padded.maxY);
  }
  if (cards.length === 0) {
    bounds.minX = bounds.minY = bounds.maxX = bounds.maxY = 0;
  }

  const edges: SceneEdge[] = [];
  const addEdge = (e: SceneEdge): void => {
    if (!showUnconfirmed && e.style === "dashed") return;
    edgeIndex.insert(edges.length, boundsOf(e.points));
    edges.push(e);
  };

  if (lineMode === "curved") addCurvedEdges(result, byKey, addEdge);
  else addOrthogonalEdges(result, byKey, addEdge);

  // Partnerlinien zwischen benachbarten Partnern einer Union (waagerecht auf Kartenmitte).
  for (const u of result.unions) {
    const partners = u.partnerKeys
      .map((k) => byKey.get(k))
      .filter((c): c is SceneCard => !!c)
      .sort((a, b) => a.node.x - b.node.x);
    for (let i = 1; i < partners.length; i++) {
      const a = partners[i - 1] as SceneCard;
      const b = partners[i] as SceneCard;
      addEdge({
        points: [a.rect.maxX, a.node.y, b.rect.minX, b.node.y],
        style: unconfirmed(u.status) ? "dashed" : "solid",
        color: COLORS.edgeNeutral,
        width: u.kind === "marriage" ? 3 : 1.5,
        ghost: u.ghost,
      });
    }
  }

  return { cards, edges, cardIndex, edgeIndex, bounds, focusKey: result.focusKey, lineMode, visiblePersons, totalPersons };
}

type AddEdge = (e: SceneEdge) => void;

const childStyle = (kind: string, childStatus: string | undefined, unionStatus: string | undefined): LineStyle =>
  unconfirmed(childStatus) || unconfirmed(unionStatus) ? "dashed" : kind === "adopted" || kind === "foster" ? "dotted" : "solid";

/** S-Kurven: vom Union-Anker senkrecht los, in der Mitte zwischen Anker und Kind waagerecht, senkrecht am Kind an. */
function addCurvedEdges(result: LayoutResult, byKey: Map<string, SceneCard>, addEdge: AddEdge): void {
  for (const u of result.unions) {
    const partners = u.partnerKeys.map((k) => byKey.get(k)).filter((c): c is SceneCard => !!c);
    const half = (partners[0]?.node.height ?? 72) / 2;
    const startY = partners.length >= 2 ? u.y : u.y + half;
    for (const c of u.children) {
      const card = byKey.get(c.key);
      if (!card) continue;
      const x1 = card.node.x;
      const y1 = card.rect.minY;
      const mid = startY + (y1 - startY) / 2;
      addEdge({
        points: [u.x, startY, u.x, mid, x1, mid, x1, y1],
        curve: true,
        style: childStyle(c.kind, c.status, u.status),
        color: card.color,
        width: 1.6,
        ghost: u.ghost || card.node.ghost,
        parents: u.partnerKeys,
        kids: [c.key],
      });
    }
  }
}

/** Rechtwinklig (D23): Stamm, Sammelschiene mit Spuren, senkrechte Äste. */
function addOrthogonalEdges(result: LayoutResult, byKey: Map<string, SceneCard>, addEdge: AddEdge): void {
  // Unions je Schicht, damit sich Sammelschienen auf Spuren verteilen lassen.
  const byLayer = new Map<number, LayoutUnion[]>();
  for (const u of result.unions) {
    const list = byLayer.get(u.layer);
    if (list) list.push(u);
    else byLayer.set(u.layer, [u]);
  }

  for (const [, unions] of byLayer) {
    interface Plan {
      u: LayoutUnion;
      startY: number;
      childTop: number;
      children: { card: SceneCard; kind: string; status?: string }[];
      minX: number;
      maxX: number;
      lane: number;
    }
    const plans: Plan[] = [];
    for (const u of unions) {
      const partners = u.partnerKeys.map((k) => byKey.get(k)).filter((c): c is SceneCard => !!c);
      const half = (partners[0]?.node.height ?? 72) / 2;
      // Zwei Partner: der Anker liegt zwischen den Karten, einer: unter der Karte.
      const startY = partners.length >= 2 ? u.y : u.y + half;
      const children: { card: SceneCard; kind: string; status?: string }[] = [];
      for (const c of u.children) {
        const card = byKey.get(c.key);
        if (card) children.push({ card, kind: c.kind, status: c.status });
      }
      if (children.length === 0) continue;
      const childTop = Math.min(...children.map((c) => c.card.rect.minY));
      let minX = u.x, maxX = u.x;
      for (const c of children) {
        minX = Math.min(minX, c.card.node.x);
        maxX = Math.max(maxX, c.card.node.x);
      }
      plans.push({ u, startY, childTop, children, minX, maxX, lane: 0 });
    }
    // Spuren: von links nach rechts, jede Union in die erste Spur, in der ihre Schiene nicht anstößt.
    plans.sort((a, b) => a.minX - b.minX);
    const laneEnd: number[] = [];
    for (const p of plans) {
      let lane = laneEnd.findIndex((end) => end + LANE_PAD < p.minX);
      if (lane < 0) lane = laneEnd.length < MAX_LANES ? laneEnd.length : laneEnd.indexOf(Math.min(...laneEnd));
      laneEnd[lane] = p.maxX;
      p.lane = lane;
    }
    const lanes = Math.max(1, laneEnd.length);

    for (const p of plans) {
      const { u } = p;
      const gap = p.childTop - p.startY;
      const busY = gap > 0 ? p.startY + (gap * (p.lane + 1)) / (lanes + 1) : p.startY;
      // Stamm: von der Partnerschaft zur Sammelschiene (neutral, immer durchgezogen, außer die Union ist vermutet).
      addEdge({
        points: [u.x, p.startY, u.x, busY],
        style: unconfirmed(u.status) ? "dashed" : "solid",
        color: COLORS.edgeNeutral,
        width: 1.5,
        ghost: u.ghost,
        parents: u.partnerKeys,
        kids: p.children.map((c) => c.card.node.key),
      });
      for (const c of p.children) {
        const cx = c.card.node.x;
        const style = childStyle(c.kind, c.status, u.status);
        addEdge({
          points: [u.x, busY, cx, busY, cx, c.card.rect.minY],
          style,
          color: c.card.color,
          width: 1.5,
          ghost: u.ghost || c.card.node.ghost,
          parents: u.partnerKeys,
          kids: [c.card.node.key],
        });
      }
    }
  }
}
