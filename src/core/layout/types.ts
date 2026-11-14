/**
 * Typen des Layouts (siehe docs/ARCHITECTURE.md, Abschnitt Layout, und docs/DECISIONS.md D17–D20).
 * Reines TypeScript, alles sind einfache Objekte (lassen sich per `postMessage` an den UI-Thread schicken).
 *
 * Begriffe:
 * - **Schicht (layer):** Generationsindex. Fokus = 0, Eltern = −1, Kinder = +1.
 * - **Band (band):** Partner einer Schicht nebeneinander (bei Mehrfach-Ehen sortiert nach `Union.order`).
 * - **Geisterknoten (ghost):** zweites Auftreten einer Person, die an anderer Stelle schon steht
 *   (Ahnenschwund, Heirat unter Verwandten). Verweist per `personId` auf die echte Karte.
 */
import type { ChildLinkKind, PersonId, Status, UnionId, UnionKind, ViewRequest } from "../types";

export interface LayoutOptions {
  /** Breite einer Personenkarte */
  cardWidth: number;
  /** Höhe einer Personenkarte */
  cardHeight: number;
  /** Abstand zwischen Partnern im selben Band */
  memberGap: number;
  /** Abstand zwischen zwei Bändern derselben Schicht */
  bandGap: number;
  /** Senkrechter Abstand zwischen zwei Schichten (Kartenunterkante bis Oberkante) */
  layerGap: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  cardWidth: 160,
  cardHeight: 72,
  memberGap: 12,
  bandGap: 40,
  layerGap: 88,
};

/** Eine Karte im Layout. Koordinaten sind der Mittelpunkt der Karte. */
export interface LayoutNode {
  /** Eindeutiger Schlüssel. Echte Karte = Personen-ID, Geist = `<Personen-ID>~<Herkunft>` */
  key: string;
  personId: PersonId;
  ghost: boolean;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bandId: string;
  /** Position im Band von links (0 = ganz links) */
  bandIndex: number;
  /** Eltern, die nicht in der Ansicht sind („+n“ nach oben). Nur für Schichten ≤ 0, bei Geistern immer 0. */
  hiddenParents: number;
  /** Kinder, die nicht in der Ansicht sind („+n“ nach unten). Nur für Schichten ≥ 0, bei Geistern immer 0. */
  hiddenChildren: number;
}

/** Partnerband: Karten einer Schicht, die zusammengehören. Mitte und Breite beziehen sich auf alle Karten. */
export interface LayoutBand {
  id: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Karten von links nach rechts (bei Mehrfach-Ehen: Reihenfolge der Ehen) */
  nodeKeys: string[];
  ghost: boolean;
}

export interface LayoutUnionChild {
  /** Schlüssel der Kinderkarte (echt oder Geist) */
  key: string;
  kind: ChildLinkKind;
  status?: Status;
}

/**
 * Ankerpunkt einer Partnerschaft, von dem die Linien zu den Kindern ausgehen.
 * Dieselbe Union kann mehrmals vorkommen (einmal echt, sonst als Geist über einem Geister-Band).
 */
export interface LayoutUnion {
  /** Eindeutiger Schlüssel (echt = Union-ID) */
  key: string;
  unionId: UnionId;
  ghost: boolean;
  kind: UnionKind;
  order?: number;
  status?: Status;
  bandId: string;
  layer: number;
  /** Mitte zwischen den Partnerkarten (bei einem Partner: dessen Mitte) */
  x: number;
  y: number;
  partnerKeys: string[];
  children: LayoutUnionChild[];
}

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface LayoutStats {
  persons: number;
  ghosts: number;
  layers: number;
  /** Rechenzeit in Millisekunden */
  ms: number;
}

export interface LayoutResult {
  request: ViewRequest;
  /** Schlüssel der Fokuskarte (`null`, wenn die Person unbekannt ist) */
  focusKey: string | null;
  nodes: LayoutNode[];
  bands: LayoutBand[];
  unions: LayoutUnion[];
  bounds: LayoutBounds;
  /** Schlüssel der Karten, die gegenüber dem vorigen Ergebnis neu sind (alle, wenn es kein voriges gab) */
  added: string[];
  stats: LayoutStats;
  /** Auffälligkeiten (z. B. Schichtkonflikte bei kaputten Daten), nur zur Anzeige/Diagnose */
  conflicts: string[];
}
