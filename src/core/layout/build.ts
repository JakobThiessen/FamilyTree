/**
 * Schritt 3: Bänder und Geisterknoten aufbauen (Tiefensuche vom Fokus aus).
 * Reines TypeScript. Siehe docs/DECISIONS.md D19.
 *
 * Jede Gruppe (Band) steht **genau einmal echt** im Layout (`realBand`). Jede Beziehung „Union – Kind“
 * wird genau einmal gezeichnet. Kommt man über eine zweite Beziehung zu einer Gruppe, die schon steht
 * (Ahnenschwund, Heirat unter Verwandten), entsteht dort stattdessen ein Geisterband:
 *   - Aufstieg zu den Eltern einer Union, die schon steht  -> Geisterband der Eltern über dem Kind
 *   - Abstieg zu einem Kind, dessen Gruppe schon steht     -> Geisterkarte des Kindes unter der Union
 * Geister haben keine eigenen Eltern oder Kinder.
 *
 * Ob ein Auftreten echt wird, entscheidet die Schicht: nur das Auftreten in der zugewiesenen Schicht
 * (tiefste benötigte, siehe layers.ts) ist echt.
 */
import type { FamilyGraph, ParentLink } from "../graph";
import type { PersonId, Union, UnionId } from "../types";
import type { Grouping } from "./layers";
import type { ViewSelection } from "./select";

/** Ein Auftreten eines Bandes im Layout (echt oder Geist). */
export interface Occ {
  /** Gruppen-ID (echt) bzw. `g:<Herkunft>` (Geist) */
  id: string;
  ghost: boolean;
  layer: number;
  persons: PersonId[];
  /** Kartenschlüssel, parallel zu `persons` */
  keys: string[];
  /** `up`: von einem Kind aus nach oben entstanden (Vorfahrenseite); `down`: Fokus oder von Eltern nach unten */
  dir: "up" | "down";
  /** nur bei `up`: das Kind, von dem aus aufgestiegen wurde */
  via?: { occ: Occ; unionId: UnionId; personId: PersonId };
  upKids: Occ[];
  downKids: Occ[];
  /** Zusatzgeschwister links/rechts (von links nach rechts) neben diesem Band */
  sibL: Occ[];
  sibR: Occ[];
  index: number;
  width: number;
  x: number;
  /** Breite des Teilbaums (Zwischenwert der Platzierung) */
  ext: number;
}

export interface UnionOcc {
  key: string;
  union: Union;
  ghost: boolean;
  owner: Occ;
  children: { occ: Occ; personId: PersonId; link: ParentLink["link"] }[];
}

export interface BuiltView {
  occs: Occ[];
  unions: UnionOcc[];
  roots: Occ[];
  focus: Occ;
}

export interface BuildInput {
  g: FamilyGraph;
  sel: ViewSelection;
  grouping: Grouping;
  layerOf: Map<string, number>;
  cardWidth: number;
  memberGap: number;
}

const kindRank = (k: string): number => (k === "biological" || k === "unknown" ? 0 : 1);

export function buildOccurrences(input: BuildInput): BuiltView {
  const { g, sel, grouping, layerOf, cardWidth, memberGap } = input;
  const { groupOf, members } = grouping;
  const inS = (p: PersonId): boolean => sel.persons.has(p);

  const occs: Occ[] = [];
  const unions: UnionOcc[] = [];
  const realBand = new Map<string, Occ>();
  const unionOcc = new Map<UnionId, UnionOcc>();
  const linked = new Set<string>();

  const widthOf = (n: number): number => n * cardWidth + (n - 1) * memberGap;

  const makeOcc = (id: string, ghost: boolean, layer: number, persons: PersonId[], keys: string[], dir: "up" | "down"): Occ => {
    const o: Occ = {
      id, ghost, layer, persons, keys, dir,
      upKids: [], downKids: [], sibL: [], sibR: [],
      index: occs.length, width: widthOf(persons.length), x: 0, ext: -1,
    };
    occs.push(o);
    return o;
  };
  const newReal = (group: string, dir: "up" | "down"): Occ => {
    const persons = members.get(group) as PersonId[];
    const o = makeOcc(group, false, layerOf.get(group) as number, persons, [...persons], dir);
    realBand.set(group, o);
    return o;
  };
  const newGhost = (arrival: string, persons: PersonId[], layer: number, dir: "up" | "down"): Occ =>
    makeOcc(`g:${arrival}`, true, layer, persons, persons.map((p) => `${p}~${arrival}`), dir);

  const makeUnionOcc = (union: Union, owner: Occ, key: string): UnionOcc => {
    const uo: UnionOcc = { key, union, ghost: owner.ghost, owner, children: [] };
    unions.push(uo);
    return uo;
  };

  /** Unions der Bandmitglieder in Bandreihenfolge (ohne Dubletten). */
  const unionsOfBand = (o: Occ): Union[] => {
    const seen = new Set<UnionId>();
    const out: Union[] = [];
    for (const p of o.persons) {
      for (const u of g.unionsOf(p)) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
      }
    }
    return out;
  };

  // Die Tiefensuche läuft ohne echte Rekursion (Generatoren + eigener Stapel, siehe `run` unten):
  // bei großen Ansichten (Zehntausende Karten) würde der Aufrufstapel sonst überlaufen (DECISIONS D22).
  // `yield occ` bedeutet „besuche occ jetzt, danach mach hier weiter“ – die Reihenfolge bleibt wie bei Rekursion.
  function* arriveUp(o: Occ, m: PersonId, link: ParentLink, partners: PersonId[]): Generator<Occ, void, void> {
    const u = link.union;
    linked.add(`${u.id}|${m}`);
    const pg = groupOf.get(partners[0] as PersonId) as string;
    const layer = o.layer - 1;
    if (!unionOcc.has(u.id) && !realBand.has(pg) && layerOf.get(pg) === layer) {
      const pb = newReal(pg, "up");
      pb.via = { occ: o, unionId: u.id, personId: m };
      const uo = makeUnionOcc(u, pb, u.id);
      unionOcc.set(u.id, uo);
      uo.children.push({ occ: o, personId: m, link: link.link });
      o.upKids.push(pb);
      yield pb;
    } else {
      const arrival = `up:${u.id}:${m}`;
      const gb = newGhost(arrival, partners, layer, "up");
      const uo = makeUnionOcc(u, gb, `${u.id}~${arrival}`);
      uo.children.push({ occ: o, personId: m, link: link.link });
      o.upKids.push(gb);
    }
  }

  const arriveDown = (
    o: Occ,
    uo: UnionOcc,
    u: Union,
    c: PersonId,
    link: ParentLink["link"],
    side: "L" | "R",
  ): Occ | undefined => {
    linked.add(`${u.id}|${c}`);
    const cg = groupOf.get(c) as string;
    const layer = o.layer + 1;
    let child: Occ;
    let real = false;
    if (!realBand.has(cg) && layerOf.get(cg) === layer) {
      child = newReal(cg, "down");
      real = true;
    } else {
      child = newGhost(`dn:${u.id}:${c}`, [c], layer, "down");
    }
    uo.children.push({ occ: child, personId: c, link });
    if (o.dir === "up" && o.via) (side === "L" ? o.via.occ.sibL : o.via.occ.sibR).push(child);
    else o.downKids.push(child);
    return real ? child : undefined;
  };

  function* visit(o: Occ): Generator<Occ, void, void> {
    // 1. Aufstieg: Eltern der Mitglieder (nicht die Union, über die das Mitglied schon hängt)
    for (const m of o.persons) {
      const links = [...g.parentLinks(m)].sort((a, b) => kindRank(a.link.kind) - kindRank(b.link.kind));
      for (const link of links) {
        if (linked.has(`${link.union.id}|${m}`)) continue;
        const partners = link.union.partnerIds.filter(inS);
        if (partners.length === 0) continue;
        yield* arriveUp(o, m, link, partners);
      }
    }

    // 2. Abstieg: Kinder aller Unions des Bandes. Vorfahrenbänder zeigen nur Zusatzpersonen (Geschwister),
    //    die Linie kommt über ihren eigenen Weg.
    const list = unionsOfBand(o);
    const viaIndex = o.via ? list.findIndex((u) => u.id === o.via?.unionId) : -1;
    // Echte Kinderbänder werden erst nach allen Unions besucht: so gewinnt der Abstieg vom Elternband
    // gegen einen späteren Aufstieg derselben Beziehung (der Geist steht dann beim Aufstieg).
    const pending: Occ[] = [];
    list.forEach((u, ui) => {
      const isEligible = (c: { personId: PersonId }): boolean =>
        inS(c.personId) && !linked.has(`${u.id}|${c.personId}`) && (o.dir === "down" || !sel.line.has(c.personId));
      const partnerCount = u.partnerIds.filter(inS).length;
      let uo = unionOcc.get(u.id);
      if (!uo) {
        if (partnerCount < 2 && !u.children.some(isEligible)) return;
        uo = makeUnionOcc(u, o, u.id);
        unionOcc.set(u.id, uo);
      }
      for (const c of u.children) {
        if (!isEligible(c)) continue;
        let side: "L" | "R" = "R";
        if (o.dir === "up" && o.via) {
          if (ui === viaIndex) {
            const ci = u.children.findIndex((x) => x.personId === c.personId);
            const vi = u.children.findIndex((x) => x.personId === o.via?.personId);
            side = ci < vi ? "L" : "R";
          } else side = ui < viaIndex ? "L" : "R";
        }
        const made = arriveDown(o, uo, u, c.personId, c, side);
        if (made) pending.push(made);
      }
    });
    for (const child of pending) yield child;
  }

  /** Führt `visit` mit eigenem Stapel aus (ersetzt die Rekursion). */
  const run = (start: Occ): void => {
    const stack: Generator<Occ, void, void>[] = [visit(start)];
    while (stack.length > 0) {
      const step = (stack[stack.length - 1] as Generator<Occ, void, void>).next();
      if (step.done) stack.pop();
      else stack.push(visit(step.value));
    }
  };

  const focusGroup = groupOf.get(sel.focusId) as string;
  const focus = newReal(focusGroup, "down");
  const roots: Occ[] = [focus];
  run(focus);

  // Gruppen, die nicht erreicht wurden (kaputte Daten, Schichtkonflikt): als eigene Wurzeln anhängen.
  for (const group of members.keys()) {
    if (realBand.has(group)) continue;
    const o = newReal(group, "down");
    roots.push(o);
    run(o);
  }

  return { occs, unions, roots, focus };
}
