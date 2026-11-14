/**
 * Schritt 2: Partnergruppen (Bänder) bilden und Schichten zuweisen.
 * Reines TypeScript. Siehe docs/DECISIONS.md D18.
 *
 * - Eine **Gruppe** sind alle Personen, die über Unions miteinander verbunden sind (ein Band).
 *   Alle Mitglieder einer Gruppe stehen in derselben Schicht.
 * - Schicht der Linie = **längster Weg** vom Fokus (Vorfahren negativ, Nachfahren positiv). Bei Schleifen
 *   (Ahn auf mehreren Wegen unterschiedlicher Länge) landet die Gruppe also in der tiefsten benötigten Schicht.
 * - Zusatzpersonen (Geschwister, Partner-Eltern ...) bekommen ihre Schicht aus ihren Nachbargruppen:
 *   Kinder eine unter den Eltern, Eltern eine über den Kindern.
 */
import type { FamilyGraph } from "../graph";
import type { PersonId } from "../types";

export interface Grouping {
  /** Person -> Gruppen-ID (`b:<kleinste Personen-ID der Gruppe>`) */
  groupOf: Map<PersonId, string>;
  /** Gruppen-ID -> Mitglieder in Bandreihenfolge (siehe `orderBand`) */
  members: Map<string, PersonId[]>;
}

/**
 * Reihenfolge im Band: Wer die meisten Partnerschaften hat (Mehrfach-Ehen), steht links, danach seine
 * Partner in Ehe-Reihenfolge (`Union.order`), deren weitere Partner jeweils direkt dahinter.
 * Bei genau zwei Personen steht der Mann links.
 */
export function orderBand(g: FamilyGraph, members: PersonId[]): PersonId[] {
  if (members.length <= 1) return [...members];
  const sorted = [...members].sort();
  const set = new Set(sorted);
  const count = (p: PersonId): number =>
    g.unionsOf(p).filter((u) => u.partnerIds.some((q) => q !== p && set.has(q))).length;
  let hub = sorted[0] as PersonId;
  for (const m of sorted) if (count(m) > count(hub)) hub = m;

  const result: PersonId[] = [hub];
  const seen = new Set<PersonId>([hub]);
  const add = (p: PersonId): void => {
    for (const u of g.unionsOf(p)) {
      for (const q of u.partnerIds) {
        if (q === p || !set.has(q) || seen.has(q)) continue;
        seen.add(q);
        result.push(q);
        add(q);
      }
    }
  };
  add(hub);
  for (const m of sorted) if (!seen.has(m)) result.push(m);

  if (result.length === 2) {
    const [a, b] = result as [PersonId, PersonId];
    if (g.getPerson(b)?.sex === "M" && g.getPerson(a)?.sex !== "M") return [b, a];
  }
  return result;
}

/** Fasst Personen, die über Unions (mit mindestens zwei Partnern in der Ansicht) verbunden sind, zu Gruppen zusammen. */
export function buildGroups(g: FamilyGraph, persons: Set<PersonId>): Grouping {
  const parent = new Map<PersonId, PersonId>();
  const find = (p: PersonId): PersonId => {
    let root = p;
    while (parent.get(root) !== root) root = parent.get(root) as PersonId;
    let cur = p;
    while (cur !== root) {
      const next = parent.get(cur) as PersonId;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const p of persons) parent.set(p, p);
  for (const p of persons) {
    for (const u of g.unionsOf(p)) {
      for (const q of u.partnerIds) {
        if (q === p || !persons.has(q)) continue;
        const a = find(p);
        const b = find(q);
        if (a !== b) parent.set(a, b);
      }
    }
  }

  const raw = new Map<PersonId, PersonId[]>();
  for (const p of persons) {
    const r = find(p);
    const list = raw.get(r);
    if (list) list.push(p);
    else raw.set(r, [p]);
  }

  const groupOf = new Map<PersonId, string>();
  const members = new Map<string, PersonId[]>();
  for (const list of raw.values()) {
    const id = `b:${list.reduce((min, p) => (p < min ? p : min))}`;
    members.set(id, orderBand(g, list));
    for (const p of list) groupOf.set(p, id);
  }
  return { groupOf, members };
}

export interface LayerAssignment {
  /** Gruppen-ID -> Schicht */
  layerOf: Map<string, number>;
  conflicts: string[];
}

/**
 * Weist jeder Gruppe eine Schicht zu.
 * @param pinned bereits platzierte Personen mit ihrer Schicht (inkrementelles Layout): sie behalten sie.
 */
export function assignLayers(
  g: FamilyGraph,
  persons: Set<PersonId>,
  focusId: PersonId,
  grouping: Grouping,
  pinned?: Map<PersonId, number>,
): LayerAssignment {
  const { groupOf, members } = grouping;
  const layerOf = new Map<string, number>();
  const conflicts: string[] = [];
  const focusGroup = groupOf.get(focusId) as string;

  const neighbors = (gr: string, next: (p: PersonId) => PersonId[]): string[] => {
    const out = new Set<string>();
    for (const m of members.get(gr) ?? []) {
      for (const q of next(m)) {
        if (!persons.has(q)) continue;
        const qg = groupOf.get(q) as string;
        if (qg !== gr) out.add(qg);
      }
    }
    return [...out];
  };
  const parentGroups = (gr: string): string[] => neighbors(gr, (p) => g.parents(p));
  const childGroups = (gr: string): string[] => neighbors(gr, (p) => g.children(p));

  /** Längster Weg vom Fokus (Kahn-Verfahren auf dem Gruppengraphen). */
  const longest = (next: (gr: string) => string[], sign: 1 | -1): void => {
    const edges = new Map<string, string[]>();
    const indeg = new Map<string, number>();
    const stack = [focusGroup];
    const seen = new Set(stack);
    while (stack.length > 0) {
      const a = stack.pop() as string;
      const out = next(a);
      edges.set(a, out);
      for (const b of out) {
        indeg.set(b, (indeg.get(b) ?? 0) + 1);
        if (!seen.has(b)) {
          seen.add(b);
          stack.push(b);
        }
      }
    }
    const depth = new Map<string, number>([[focusGroup, 0]]);
    const queue = [focusGroup];
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i] as string;
      for (const b of edges.get(a) ?? []) {
        depth.set(b, Math.max(depth.get(b) ?? 0, (depth.get(a) as number) + 1));
        const left = (indeg.get(b) as number) - 1;
        indeg.set(b, left);
        if (left === 0) queue.push(b);
      }
    }
    for (const [b, left] of indeg) {
      if (left > 0) conflicts.push(`Zyklus bei Gruppe ${b}: Schicht ungenau.`);
    }
    for (const [gr, d] of depth) {
      if (gr === focusGroup) continue;
      if (layerOf.has(gr)) conflicts.push(`Gruppe ${gr} ist Vorfahr und Nachfahr zugleich.`);
      else layerOf.set(gr, sign * d);
    }
  };

  layerOf.set(focusGroup, 0);
  longest(parentGroups, -1);
  longest(childGroups, 1);

  if (pinned) {
    for (const [p, layer] of pinned) {
      const gr = groupOf.get(p);
      if (gr !== undefined) layerOf.set(gr, layer);
    }
  }

  // Zusatzgruppen aus den Nachbarn ableiten (Breitensuche von den bekannten Schichten aus).
  const queue = [...layerOf.keys()];
  const evaluate = (gr: string): boolean => {
    const ups = parentGroups(gr).map((x) => layerOf.get(x));
    const knownUp = ups.filter((x): x is number => x !== undefined);
    if (knownUp.length > 0) {
      layerOf.set(gr, Math.max(...knownUp) + 1);
      return true;
    }
    const downs = childGroups(gr).map((x) => layerOf.get(x));
    const knownDown = downs.filter((x): x is number => x !== undefined);
    if (knownDown.length > 0) {
      layerOf.set(gr, Math.min(...knownDown) - 1);
      return true;
    }
    return false;
  };
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i] as string;
    for (const b of [...parentGroups(a), ...childGroups(a)]) {
      if (layerOf.has(b)) continue;
      if (evaluate(b)) queue.push(b);
    }
  }
  for (const gr of members.keys()) {
    if (!layerOf.has(gr)) {
      layerOf.set(gr, 0);
      conflicts.push(`Gruppe ${gr} ist nicht mit dem Fokus verbunden (Schicht 0 angenommen).`);
    }
  }
  return { layerOf, conflicts };
}
