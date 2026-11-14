/**
 * Verwandtschaft: bidirektionale Suche nach gemeinsamen Vorfahren und deutsche Bezeichnungen.
 * Reines TypeScript. Siehe docs/DECISIONS.md D14 und D15.
 *
 * Konvention der Bezeichnung: `describeRelationship(g, a, b)` sagt, **was A für B ist**
 * („A ist die Großmutter von B“). Das Geschlecht von A bestimmt die Wortform.
 */

import type { DepthOptions } from "./ancestry";
import type { FamilyGraph } from "./graph";
import type { PersonId, Sex, UnionId } from "./types";

// ------------------------------------------------------------ gemeinsame Vorfahren

export interface CommonAncestor {
  id: PersonId;
  /** kürzeste Entfernung von A zu diesem Ahn (0 = A selbst ist der Ahn) */
  distA: number;
  /** kürzeste Entfernung von B zu diesem Ahn */
  distB: number;
  /** alle Tiefen, in denen der Ahn von A bzw. B aus erreichbar ist (aufsteigend) */
  depthsA: number[];
  depthsB: number[];
  /** „Niedrigster“ gemeinsamer Vorfahr: kein anderer gemeinsamer Vorfahr stammt von ihm ab */
  lowest: boolean;
}

/** Eine Front der Suche: die Personen, die genau `depth` Schritte über A (bzw. B) entfernt sind. */
class Front {
  depth = 0;
  frontier: Set<PersonId>;
  /** Person → Tiefen, in denen sie erreicht wurde (aufsteigend) */
  readonly reached = new Map<PersonId, number[]>();

  constructor(start: PersonId) {
    this.frontier = new Set([start]);
    this.reached.set(start, [0]);
  }

  expand(g: FamilyGraph, opts: DepthOptions): void {
    const next = new Set<PersonId>();
    for (const id of this.frontier) for (const parent of g.parents(id, opts)) next.add(parent);
    this.depth += 1;
    this.frontier = next;
    for (const id of next) {
      const list = this.reached.get(id);
      if (list) list.push(this.depth);
      else this.reached.set(id, [this.depth]);
    }
  }
}

/**
 * Bidirektionale Suche: Von A und von B aus laufen zwei Fronten schrittweise nach oben,
 * jeweils die kleinere zuerst. Die Suche endet, wenn beide Fronten erschöpft sind (oder `maxDepth`
 * erreichen). So werden **alle** gemeinsamen Vorfahren gefunden, nicht nur der nächste.
 * Ist A Vorfahr von B, gilt A selbst als gemeinsamer Vorfahr (distA = 0).
 *
 * Ergebnis sortiert nach `distA + distB`, dann ID.
 */
export function findCommonAncestors(
  g: FamilyGraph,
  a: PersonId,
  b: PersonId,
  opts: DepthOptions = {},
): CommonAncestor[] {
  if (!g.hasPerson(a) || !g.hasPerson(b)) return [];
  const limit = Math.min(opts.maxDepth ?? Infinity, g.personCount);
  const fa = new Front(a);
  const fb = new Front(b);

  for (;;) {
    const canA = fa.frontier.size > 0 && fa.depth < limit;
    const canB = fb.frontier.size > 0 && fb.depth < limit;
    if (!canA && !canB) break;
    const front = canA && (!canB || fa.frontier.size <= fb.frontier.size) ? fa : fb;
    front.expand(g, opts);
  }

  const common: CommonAncestor[] = [];
  for (const [id, depthsA] of fa.reached) {
    const depthsB = fb.reached.get(id);
    if (!depthsB) continue;
    common.push({
      id,
      distA: depthsA[0] as number,
      distB: depthsB[0] as number,
      depthsA: [...depthsA],
      depthsB: [...depthsB],
      lowest: true,
    });
  }

  // Ein gemeinsamer Vorfahre, der oberhalb eines anderen gemeinsamen Vorfahren liegt, ist nicht „niedrigst“.
  const byId = new Map(common.map((c) => [c.id, c]));
  const seen = new Set<PersonId>();
  const queue: PersonId[] = [];
  for (const c of common) for (const p of g.parents(c.id, opts)) queue.push(p);
  while (queue.length > 0) {
    const id = queue.pop() as PersonId;
    if (seen.has(id)) continue;
    seen.add(id);
    const hit = byId.get(id);
    if (hit) hit.lowest = false;
    for (const p of g.parents(id, opts)) queue.push(p);
  }

  common.sort((x, y) => x.distA + x.distB - (y.distA + y.distB) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return common;
}

// ------------------------------------------------------------ Bezeichnungen (Deutsch)

type Terms = Record<Sex, string>;

const T = {
  parent: { M: "Vater", F: "Mutter", U: "Elternteil" },
  grandparentStem: { M: "vater", F: "mutter", U: "elternteil" },
  child: { M: "Sohn", F: "Tochter", U: "Kind" },
  grandchildStem: { M: "enkel", F: "enkelin", U: "enkelkind" },
  sibling: { M: "Bruder", F: "Schwester", U: "Geschwisterteil" },
  uncle: { M: "Onkel", F: "Tante", U: "Onkel/Tante" },
  nephew: { M: "Neffe", F: "Nichte", U: "Neffe/Nichte" },
  cousin: { M: "Cousin", F: "Cousine", U: "Cousin/Cousine" },
} satisfies Record<string, Terms>;

/** Weiter als „Ururururgroßvater“ wird nicht mehr ausgeschrieben. */
const MAX_NAMED_DISTANCE = 6;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const ur = (n: number): string => "ur".repeat(Math.max(n, 0));
const generations = (n: number): string => `${n} Generation${n === 1 ? "" : "en"}`;

/**
 * Deutsche Bezeichnung dessen, der `up` Schritte unter dem gemeinsamen Ahn steht, für den,
 * der `down` Schritte darunter steht („A ist … von B“). `half` setzt „Halb-“ davor.
 *
 * Beispiele: (1,0) Sohn · (2,0) Enkel · (0,2) Großvater · (1,1) Bruder · (1,2) Onkel ·
 * (2,1) Neffe · (2,2) Cousin 1. Grades · (3,2) Cousin 1. Grades, 1 Generation versetzt ·
 * (3,3) Cousin 2. Grades.
 */
export function bloodRelationLabel(up: number, down: number, sex: Sex = "U", half = false): string {
  const label = rawLabel(up, down, sex);
  return half ? `Halb${lowerFirst(label)}` : label;
}

function rawLabel(up: number, down: number, sex: Sex): string {
  if (up === 0 && down === 0) return "dieselbe Person";

  // A ist Vorfahr von B
  if (up === 0) {
    if (down === 1) return T.parent[sex];
    if (down > MAX_NAMED_DISTANCE) return `Vorfahre (${generations(down)} entfernt)`;
    return cap(`${ur(down - 2)}groß${T.grandparentStem[sex]}`);
  }
  // A ist Nachfahre von B
  if (down === 0) {
    if (up === 1) return T.child[sex];
    if (up > MAX_NAMED_DISTANCE) return `Nachfahre (${generations(up)} entfernt)`;
    return cap(`${ur(up - 2)}${T.grandchildStem[sex]}`);
  }
  // Geschwister
  if (up === 1 && down === 1) return T.sibling[sex];
  // Onkel/Tante (A ist Geschwister eines Vorfahren von B) und Neffe/Nichte
  if (up === 1 || down === 1) {
    const uncleSide = up === 1;
    const n = uncleSide ? down : up;
    const base = uncleSide ? T.uncle[sex] : T.nephew[sex];
    if (n === 2) return base;
    if (n > MAX_NAMED_DISTANCE) return `${base} (${generations(n - 1)} entfernt)`;
    return cap(`${ur(n - 3)}groß${lowerFirst(base)}`);
  }
  // Cousin n. Grades: Grad = Abstand zum gemeinsamen Ahn minus 1, „versetzt“ = Generationsunterschied
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  const text = `${T.cousin[sex]} ${degree}. Grades`;
  return removed === 0 ? text : `${text}, ${generations(removed)} versetzt`;
}

// ------------------------------------------------------------ Verwandtschaft A ↔ B

/** Eine Blutsverwandtschaftslinie über einen gemeinsamen Ahn (oder ein Ahnenpaar). */
export interface BloodLine {
  /** niedrigste gemeinsame Vorfahren dieser Linie: ein Paar (Vollverwandtschaft) oder eine Person */
  ancestors: PersonId[];
  /** Schritte von A zum Ahn */
  up: number;
  /** Schritte von B zum Ahn */
  down: number;
  /** nur ein gemeinsamer Elternteil/Ahn auf dem Weg (z. B. Halbgeschwister) */
  half: boolean;
  /** Bezeichnung von A für B, z. B. „Cousin 1. Grades“ */
  label: string;
}

/** Verwandtschaft durch Heirat (Schwager, Schwiegermutter, Stiefvater …). */
export interface InLawLink {
  /** Partner, über den die Beziehung läuft (Partner von A oder von B) */
  via: PersonId;
  label: string;
}

export interface Relationship {
  a: PersonId;
  b: PersonId;
  /** A und B sind dieselbe Person */
  same: boolean;
  /** alle Blutsverwandtschaftslinien, kürzeste zuerst; leer = nicht blutsverwandt */
  blood: BloodLine[];
  /** A und B teilen (oder teilten) eine Union */
  partner?: { unionId: UnionId; label: string };
  /** nur gefüllt, wenn weder Blutsverwandtschaft noch direkte Partnerschaft besteht */
  inLaw: InLawLink[];
  /** Gesamtbezeichnung, z. B. „Ehemann, Cousin 1. Grades“ oder „nicht verwandt“ */
  label: string;
}

/**
 * Welche Unions eines Ahnen liegen auf einem Weg von `start` nach oben?
 * (Ahn → Menge der Union-IDs.) Dient der Unterscheidung voll/halb: Wer über dieselbe Union
 * absteigt, ist voll verwandt; über verschiedene Unions desselben Ahns nur halb.
 */
function unionsToAncestors(
  g: FamilyGraph,
  start: PersonId,
  targets: ReadonlySet<PersonId>,
  opts: DepthOptions,
): Map<PersonId, Set<UnionId>> {
  const result = new Map<PersonId, Set<UnionId>>();
  const seen = new Set<PersonId>([start]);
  const queue: PersonId[] = [start];
  while (queue.length > 0) {
    const id = queue.pop() as PersonId;
    for (const { union, link } of g.parentLinks(id)) {
      if (opts.biologicalOnly && link.kind !== "biological") continue;
      for (const pid of union.partnerIds) {
        if (!g.hasPerson(pid)) continue;
        if (targets.has(pid)) {
          const set = result.get(pid);
          if (set) set.add(union.id);
          else result.set(pid, new Set([union.id]));
        }
        if (!seen.has(pid)) {
          seen.add(pid);
          queue.push(pid);
        }
      }
    }
  }
  return result;
}

/** Alle Blutsverwandtschaftslinien zwischen A und B (leer, wenn keine). */
function bloodLines(g: FamilyGraph, a: PersonId, b: PersonId, opts: DepthOptions): BloodLine[] {
  const lowest = findCommonAncestors(g, a, b, opts).filter((c) => c.lowest);
  if (lowest.length === 0) return [];

  const targets = new Set(lowest.map((c) => c.id));
  const fromA = unionsToAncestors(g, a, targets, opts);
  const fromB = unionsToAncestors(g, b, targets, opts);
  const byId = new Map(lowest.map((c) => [c.id, c]));
  const sex = g.getPerson(a)?.sex ?? "U";
  const used = new Set<PersonId>();
  const lines: BloodLine[] = [];

  for (const c of lowest) {
    if (used.has(c.id)) continue;
    used.add(c.id);

    // Unions des Ahns, über die sowohl A als auch B absteigen
    const shared = [...(fromA.get(c.id) ?? [])].filter((u) => fromB.get(c.id)?.has(u));
    const group = [c.id];
    for (const unionId of shared) {
      for (const pid of g.getUnion(unionId)?.partnerIds ?? []) {
        const other = byId.get(pid);
        if (other && !used.has(pid) && other.distA === c.distA && other.distB === c.distB) {
          used.add(pid);
          group.push(pid);
        }
      }
    }

    const direct = c.distA === 0 || c.distB === 0;
    const half = !direct && shared.length === 0;
    lines.push({
      ancestors: group,
      up: c.distA,
      down: c.distB,
      half,
      label: bloodRelationLabel(c.distA, c.distB, sex, half),
    });
  }
  return lines;
}

/** Fasst gleiche Bezeichnungen zusammen: zweimal „Cousin 1. Grades“ → „… (doppelt)“. */
function joinLabels(labels: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].map(([l, n]) => (n === 1 ? l : `${l} (${n === 2 ? "doppelt" : `${n}-fach`})`));
}

function partnerLabel(sex: Sex, married: boolean, divorced: boolean): string {
  const base = married
    ? { M: "Ehemann", F: "Ehefrau", U: "Ehepartner" }[sex]
    : { M: "Partner", F: "Partnerin", U: "Partner" }[sex];
  return divorced ? `Ex-${base}` : base;
}

const schwager = (sex: Sex): string => (sex === "F" ? "Schwägerin" : sex === "M" ? "Schwager" : "Schwager/Schwägerin");
const schwippschwager = (sex: Sex): string =>
  sex === "F" ? "Schwippschwägerin" : sex === "M" ? "Schwippschwager" : "Schwippschwager/Schwippschwägerin";
const inLawTerms = {
  childInLaw: { M: "Schwiegersohn", F: "Schwiegertochter", U: "Schwiegerkind" },
  parentInLaw: { M: "Schwiegervater", F: "Schwiegermutter", U: "Schwiegerelternteil" },
  stepParent: { M: "Stiefvater", F: "Stiefmutter", U: "Stiefelternteil" },
  stepChild: { M: "Stiefsohn", F: "Stieftochter", U: "Stiefkind" },
} satisfies Record<string, Terms>;

/** Verwandtschaft durch Heirat. Nur sinnvoll, wenn keine Blutsverwandtschaft besteht. */
function inLawLinks(g: FamilyGraph, a: PersonId, b: PersonId, opts: DepthOptions): InLawLink[] {
  const sexA = g.getPerson(a)?.sex ?? "U";
  const links: InLawLink[] = [];
  const seen = new Set<string>();
  const add = (via: PersonId, label: string): void => {
    const key = `${via}|${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ via, label });
  };

  // Über die Partner von A: A ist mit einem Blutsverwandten von B verheiratet
  for (const pa of g.partners(a)) {
    for (const line of bloodLines(g, pa, b, opts)) {
      const { up, down } = line;
      if (up === 1 && down === 1) add(pa, schwager(sexA));
      else if (up === 1 && down === 0) add(pa, inLawTerms.childInLaw[sexA]);
      else if (up === 0 && down === 1) add(pa, inLawTerms.stepParent[sexA]);
      else add(pa, `Partner von ${bloodRelationLabel(up, down, g.getPerson(pa)?.sex ?? "U")}`);
    }
  }
  // Über die Partner von B: A ist mit einem Blutsverwandten des Partners von B verwandt
  for (const pb of g.partners(b)) {
    for (const line of bloodLines(g, a, pb, opts)) {
      const { up, down } = line;
      if (up === 1 && down === 1) add(pb, schwager(sexA));
      else if (up === 0 && down === 1) add(pb, inLawTerms.parentInLaw[sexA]);
      else if (up === 1 && down === 0) add(pb, inLawTerms.stepChild[sexA]);
      else add(pb, `${bloodRelationLabel(up, down, sexA)} des Partners`);
    }
  }
  // Schwippschwager: die Partner von A und B sind Geschwister
  for (const pa of g.partners(a)) {
    for (const pb of g.partners(b)) {
      if (pa === pb) continue;
      if (bloodLines(g, pa, pb, opts).some((l) => l.up === 1 && l.down === 1)) add(pb, schwippschwager(sexA));
    }
  }
  return links;
}

/**
 * Beschreibt, was A für B ist: Blutsverwandtschaft (alle Linien, z. B. doppelte Cousins),
 * Partnerschaft und, falls keins von beiden, Verwandtschaft durch Heirat.
 */
export function describeRelationship(
  g: FamilyGraph,
  a: PersonId,
  b: PersonId,
  opts: DepthOptions = {},
): Relationship {
  const none: Relationship = { a, b, same: false, blood: [], inLaw: [], label: "nicht verwandt" };
  if (!g.hasPerson(a) || !g.hasPerson(b)) return none;
  if (a === b) return { ...none, same: true, label: "dieselbe Person" };

  const sexA = g.getPerson(a)?.sex ?? "U";
  const blood = bloodLines(g, a, b, opts);

  const union = g.unionsOf(a).find((u) => u.partnerIds.includes(b));
  const partner = union
    ? {
        unionId: union.id,
        label: partnerLabel(sexA, union.kind === "marriage", union.endReason === "divorce"),
      }
    : undefined;

  const inLaw = !partner && blood.length === 0 ? inLawLinks(g, a, b, opts) : [];

  const parts = [
    ...(partner ? [partner.label] : []),
    ...joinLabels(blood.map((l) => l.label)),
    ...inLaw.map((l) => l.label),
  ];
  const result: Relationship = { a, b, same: false, blood, inLaw, label: parts.join(", ") || none.label };
  if (partner) result.partner = partner;
  return result;
}
