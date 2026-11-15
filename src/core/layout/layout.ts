/**
 * Schritt 4 und 5: Positionen berechnen und das Ergebnis zusammenbauen.
 * Reines TypeScript. Siehe docs/DECISIONS.md D20.
 *
 * Ablauf:
 * 1. Teilbaumbreiten bestimmen und jedes Band mittig über/unter seinen Teilbaum setzen (Ahnen nach oben,
 *    Nachkommen nach unten, Fokus bei x = 0).
 * 2. Pro Schicht Überlappungen auflösen (Isotone Regression / „pool adjacent violators“): die Reihenfolge
 *    bleibt, die Verschiebung der Bänder ist insgesamt minimal.
 * 3. Inkrementell: schon platzierte Bänder (gleiche ID, Schicht und Karten) behalten ihre Position.
 *    Neue Bänder suchen die nächste freie Lücke ihrer Schicht.
 */
import { FamilyGraph } from "../graph";
import type { PersonId, ViewRequest } from "../types";
import { buildOccurrences, type Occ } from "./build";
import { assignLayers, buildGroups } from "./layers";
import { selectView } from "./select";
import {
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutBand,
  type LayoutNode,
  type LayoutOptions,
  type LayoutResult,
  type LayoutUnion,
} from "./types";

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Breite des Teilbaums eines Bandes (Näherung: größte Breite über alle Schichten des Teilbaums). */
function extent(o: Occ, gap: number): number {
  if (o.ext >= 0) return o.ext;
  const sum = (list: Occ[]): number => list.reduce((acc, k, i) => acc + extent(k, gap) + (i > 0 ? gap : 0), 0);
  const sideSum = (list: Occ[]): number => list.reduce((acc, k) => acc + extent(k, gap) + gap, 0);
  const row = o.width + 2 * Math.max(sideSum(o.sibL), sideSum(o.sibR));
  o.ext = Math.max(row, sum(o.upKids), sum(o.downKids));
  return o.ext;
}

/**
 * Setzt die Breiten aller Teilbäume im Voraus, von den zuletzt angelegten Bändern an: Kinder und Geschwister
 * entstehen immer nach ihrem Band, `extent` muss dadurch nie tief rekursiv absteigen (DECISIONS D22).
 */
function computeExtents(occs: Occ[], gap: number): void {
  for (let i = occs.length - 1; i >= 0; i--) extent(occs[i] as Occ, gap);
}

/** Verteilt die Positionen von der Wurzel abwärts mit eigenem Stapel statt Rekursion (große Ansichten). */
function place(root: Occ, rootX: number, gap: number): void {
  const stack: [Occ, number][] = [[root, rootX]];
  while (stack.length > 0) {
    const [o, x] = stack.pop() as [Occ, number];
    o.x = x;
    let cursor = x - o.width / 2 - gap;
    for (let i = o.sibL.length - 1; i >= 0; i--) {
      const s = o.sibL[i] as Occ;
      const e = extent(s, gap);
      stack.push([s, cursor - e / 2]);
      cursor -= e + gap;
    }
    cursor = x + o.width / 2 + gap;
    for (const s of o.sibR) {
      const e = extent(s, gap);
      stack.push([s, cursor + e / 2]);
      cursor += e + gap;
    }
    for (const kids of [o.upKids, o.downKids]) {
      const total = kids.reduce((acc, k, i) => acc + extent(k, gap) + (i > 0 ? gap : 0), 0);
      let start = x - total / 2;
      for (const k of kids) {
        const e = extent(k, gap);
        stack.push([k, start + e / 2]);
        start += e + gap;
      }
    }
  }
}

/** Löst Überlappungen einer Schicht auf (Reihenfolge nach `x`), minimale quadratische Verschiebung. */
function packLayer(items: Occ[], gap: number): void {
  items.sort((a, b) => a.x - b.x || a.index - b.index);
  const n = items.length;
  if (n < 2) return;
  const off: number[] = [0];
  for (let i = 1; i < n; i++) {
    off.push((off[i - 1] as number) + ((items[i - 1] as Occ).width + (items[i] as Occ).width) / 2 + gap);
  }
  const blocks: { sum: number; count: number; first: number }[] = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: (items[i] as Occ).x - (off[i] as number), count: 1, first: i });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1] as { sum: number; count: number; first: number };
      const a = blocks[blocks.length - 2] as { sum: number; count: number; first: number };
      if (a.sum / a.count <= b.sum / b.count) break;
      a.sum += b.sum;
      a.count += b.count;
      blocks.pop();
    }
  }
  for (const b of blocks) {
    const mean = b.sum / b.count;
    for (let i = b.first; i < b.first + b.count; i++) (items[i] as Occ).x = mean + (off[i] as number);
  }
}

/**
 * Keine Überkreuzung bei Geschwistern (D43): Stehen nach `packLayer` zwischen den Kindern einer Verbindung
 * fremde Karten (z. B. die Kinder des Geschwisters ihres Elternteils), wandert diese Fremdgruppe samt ihren
 * Geschwistern auf die näher liegende Seite. `packLayer` erhält die Reihenfolge, löst danach Überlappungen.
 */
function uncross(byLayer: Map<number, Occ[]>, unions: { children: { occ: Occ }[] }[], gap: number): void {
  const groupsOf = new Map<Occ, Occ[][]>();
  const groups: Occ[][] = [];
  for (const u of unions) {
    const members = [...new Set(u.children.map((c) => c.occ))];
    if (members.length < 2) continue;
    const layer = (members[0] as Occ).layer;
    const same = members.filter((m) => m.layer === layer);
    if (same.length < 2) continue;
    groups.push(same);
    for (const m of same) {
      const list = groupsOf.get(m);
      if (list) list.push(same);
      else groupsOf.set(m, [same]);
    }
  }
  if (groups.length === 0) return;
  const budget = new Map<number, number>();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const G of groups) {
      const layer = (G[0] as Occ).layer;
      const items = byLayer.get(layer) as Occ[];
      const inG = new Set(G);
      const lo = Math.min(...G.map((o) => o.x));
      const hi = Math.max(...G.map((o) => o.x));
      // erster Eintrag mit x >= lo (items ist nach x sortiert)
      let a = 0;
      let b = items.length;
      while (a < b) {
        const mid = (a + b) >> 1;
        if ((items[mid] as Occ).x < lo) a = mid + 1;
        else b = mid;
      }
      const intruders: Occ[] = [];
      for (let i = a; i < items.length && (items[i] as Occ).x <= hi; i++) {
        const o = items[i] as Occ;
        if (!inG.has(o)) intruders.push(o);
      }
      if (intruders.length === 0) continue;
      if ((budget.get(layer) ?? 0) >= 200) continue;
      budget.set(layer, (budget.get(layer) ?? 0) + 1);
      // Fremdblock: die Eindringlinge samt allen Geschwistern ihrer Gruppen (ohne Mitglieder von G)
      const block = new Set<Occ>();
      for (const o of intruders) {
        block.add(o);
        for (const grp of groupsOf.get(o) ?? []) for (const m of grp) if (!inG.has(m)) block.add(m);
      }
      const gLeft = Math.min(...G.map((o) => o.x - o.width / 2));
      const gRight = Math.max(...G.map((o) => o.x + o.width / 2));
      const bLeft = Math.min(...[...block].map((o) => o.x - o.width / 2));
      const bRight = Math.max(...[...block].map((o) => o.x + o.width / 2));
      const goLeft = (bLeft + bRight) / 2 < (gLeft + gRight) / 2;
      const shift = goLeft ? gLeft - gap - bRight : gRight + gap - bLeft;
      for (const o of block) o.x += shift;
      packLayer(items, gap);
      changed = true;
    }
    if (!changed) break;
  }
}

/** Mittelpunkt der nächsten freien Lücke zu `desired`; `taken` ist nach linker Kante sortiert. */
function findSlot(taken: [number, number][], desired: number, width: number, gap: number): number {
  let best = desired;
  let bestDist = Infinity;
  let prevRight = -Infinity;
  for (let i = 0; i <= taken.length; i++) {
    const next = taken[i];
    const freeL = prevRight + gap;
    const freeR = (next ? next[0] : Infinity) - gap;
    if (freeR - freeL >= width) {
      const c = Math.min(Math.max(desired, freeL + width / 2), freeR - width / 2);
      const d = Math.abs(c - desired);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (next) prevRight = Math.max(prevRight, next[1]);
  }
  return best;
}

function insertTaken(taken: [number, number][], interval: [number, number]): void {
  let i = taken.length;
  while (i > 0 && (taken[i - 1] as [number, number])[0] > interval[0]) i--;
  taken.splice(i, 0, interval);
}

export function layoutView(
  g: FamilyGraph,
  request: ViewRequest,
  options: Partial<LayoutOptions> = {},
  previous?: LayoutResult,
): LayoutResult {
  const t0 = now();
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const gap = opts.bandGap;
  const sel = selectView(g, request);

  if (sel.persons.size === 0) {
    return {
      request,
      focusKey: null,
      nodes: [],
      bands: [],
      unions: [],
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      added: [],
      stats: { persons: 0, ghosts: 0, layers: 0, ms: now() - t0 },
      conflicts: [],
    };
  }

  // Schon platzierte Karten des vorigen Ergebnisses
  const prevBands = new Map<string, LayoutBand>();
  const pinnedLayer = new Map<PersonId, number>();
  const prevKeys = new Set<string>();
  if (previous) {
    for (const b of previous.bands) prevBands.set(b.id, b);
    for (const n of previous.nodes) {
      prevKeys.add(n.key);
      if (!n.ghost) pinnedLayer.set(n.personId, n.layer);
    }
  }

  const grouping = buildGroups(g, sel.persons);
  const { layerOf, conflicts } = assignLayers(g, sel.persons, sel.focusId, grouping, previous ? pinnedLayer : undefined);
  const built = buildOccurrences({
    g, sel, grouping, layerOf, cardWidth: opts.cardWidth, memberGap: opts.memberGap,
  });

  // 1. Teilbaumbreiten und Grundpositionen
  computeExtents(built.occs, gap);
  let rootStart = 0;
  built.roots.forEach((root, i) => {
    const e = extent(root, gap);
    if (i === 0) {
      place(root, 0, gap);
      rootStart = e / 2 + gap;
    } else {
      place(root, rootStart + e / 2, gap);
      rootStart += e + gap;
    }
  });

  // 2. Überlappungen je Schicht auflösen
  const byLayer = new Map<number, Occ[]>();
  for (const o of built.occs) {
    const list = byLayer.get(o.layer);
    if (list) list.push(o);
    else byLayer.set(o.layer, [o]);
  }
  for (const list of byLayer.values()) packLayer(list, gap);
  uncross(byLayer, built.unions, gap);

  // 3. Inkrementell: schon platzierte Bänder festhalten, neue in freie Lücken setzen
  const sameBand = (o: Occ): LayoutBand | undefined => {
    const pb = prevBands.get(o.id);
    return pb && pb.layer === o.layer && pb.nodeKeys.length === o.keys.length && pb.nodeKeys.every((k, i) => k === o.keys[i])
      ? pb
      : undefined;
  };
  if (previous) {
    const pinned = built.occs.filter((o) => sameBand(o));
    if (pinned.length > 0) {
      const shift = pinned.reduce((acc, o) => acc + ((sameBand(o) as LayoutBand).x - o.x), 0) / pinned.length;
      const taken = new Map<number, [number, number][]>();
      for (const o of pinned) {
        o.x = (sameBand(o) as LayoutBand).x;
        let list = taken.get(o.layer);
        if (!list) taken.set(o.layer, (list = []));
        insertTaken(list, [o.x - o.width / 2, o.x + o.width / 2]);
      }
      for (const o of built.occs) {
        if (sameBand(o)) continue;
        let list = taken.get(o.layer);
        if (!list) taken.set(o.layer, (list = []));
        o.x = findSlot(list, o.x + shift, o.width, gap);
        insertTaken(list, [o.x - o.width / 2, o.x + o.width / 2]);
      }
    }
  } else {
    const dx = built.focus.x;
    for (const o of built.occs) o.x -= dx;
  }

  // 4. Ergebnis
  const rowH = opts.cardHeight + opts.layerGap;
  const nodes: LayoutNode[] = [];
  const bands: LayoutBand[] = [];
  const nodeByKey = new Map<string, LayoutNode>();
  let ghosts = 0;
  for (const o of built.occs) {
    const y = o.layer * rowH;
    const left = o.x - o.width / 2;
    const keys: string[] = [];
    o.persons.forEach((personId, i) => {
      const key = o.keys[i] as string;
      keys.push(key);
      let hiddenParents = 0;
      let hiddenChildren = 0;
      if (o.ghost) ghosts++;
      else {
        if (o.layer <= 0) hiddenParents = g.parents(personId).filter((p) => !sel.persons.has(p)).length;
        if (o.layer >= 0) hiddenChildren = g.children(personId).filter((c) => !sel.persons.has(c)).length;
      }
      const node: LayoutNode = {
        key, personId, ghost: o.ghost, layer: o.layer,
        x: left + i * (opts.cardWidth + opts.memberGap) + opts.cardWidth / 2,
        y, width: opts.cardWidth, height: opts.cardHeight,
        bandId: o.id, bandIndex: i, hiddenParents, hiddenChildren,
      };
      nodes.push(node);
      nodeByKey.set(key, node);
    });
    bands.push({ id: o.id, layer: o.layer, x: o.x, y, width: o.width, height: opts.cardHeight, nodeKeys: keys, ghost: o.ghost });
  }

  const unions: LayoutUnion[] = built.unions.map((uo) => {
    const partnerKeys: string[] = [];
    uo.owner.persons.forEach((p, i) => {
      if (uo.union.partnerIds.includes(p)) partnerKeys.push(uo.owner.keys[i] as string);
    });
    const xs = partnerKeys.map((k) => (nodeByKey.get(k) as LayoutNode).x);
    const x = xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : uo.owner.x;
    return {
      key: uo.key,
      unionId: uo.union.id,
      ghost: uo.ghost,
      kind: uo.union.kind,
      ...(uo.union.order !== undefined ? { order: uo.union.order } : {}),
      ...(uo.union.status !== undefined ? { status: uo.union.status } : {}),
      bandId: uo.owner.id,
      layer: uo.owner.layer,
      x,
      y: uo.owner.layer * rowH,
      partnerKeys,
      children: uo.children.map((c) => ({
        key: c.occ.keys[c.occ.persons.indexOf(c.personId)] as string,
        kind: c.link.kind,
        ...(c.link.status !== undefined ? { status: c.link.status } : {}),
      })),
    };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }

  return {
    request,
    focusKey: sel.focusId,
    nodes,
    bands,
    unions,
    bounds: { minX, maxX, minY, maxY },
    added: nodes.filter((n) => !prevKeys.has(n.key)).map((n) => n.key),
    stats: { persons: sel.persons.size, ghosts, layers: byLayer.size, ms: now() - t0 },
    conflicts,
  };
}
