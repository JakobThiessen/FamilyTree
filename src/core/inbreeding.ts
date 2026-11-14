/**
 * Verwandtschafts- und Inzuchtkoeffizient nach Wright/Malécot.
 * Reines TypeScript. Siehe docs/DECISIONS.md D16.
 *
 * Kinship φ(x, y): Wahrscheinlichkeit, dass zufällig gezogene Erbanlagen von x und y gleich
 * (vom selben Ahn) stammen. Der Inzuchtkoeffizient einer Person ist φ(Vater, Mutter).
 * Beispiele: Kind von Geschwistern 1/4, von Onkel und Nichte 1/8, von Cousins 1. Grades 1/16.
 */

import type { FamilyGraph } from "./graph";
import type { PersonId } from "./types";

export interface KinshipOptions {
  /** auch Adoptiv-/Pflegeeltern als Eltern werten (Standard: nein, nur leibliche/unbekannte Art) */
  includeAdopted?: boolean;
}

type Parents = readonly [PersonId | undefined, PersonId | undefined];

/**
 * Berechnet Kinship und Inzucht mit Zwischenspeicher. Eine Instanz für mehrere Abfragen
 * am selben Graphen wiederverwenden. Der Graph darf sich danach nicht ändern.
 *
 * Rekursion: Es wird immer die Person mit dem größeren Rang (längster Weg bis zu einem Gründer)
 * durch ihre Eltern ersetzt. Der Rang eines Nachkommen ist größer als der jedes Vorfahren,
 * deshalb ist die Reihenfolge korrekt, und jedes Paar wird nur einmal berechnet.
 */
export class KinshipCalculator {
  private readonly rankMemo = new Map<PersonId, number>();
  private readonly phiMemo = new Map<string, number>();
  private readonly parentsMemo = new Map<PersonId, Parents>();
  /** Schutz vor Endlosschleifen bei Zyklen (kaputte Daten) */
  private readonly active = new Set<string>();

  constructor(
    private readonly g: FamilyGraph,
    private readonly opts: KinshipOptions = {},
  ) {}

  /** Vater und Mutter (Partner der ersten passenden Eltern-Union; fehlende = undefined). */
  parentsOf(id: PersonId): Parents {
    const cached = this.parentsMemo.get(id);
    if (cached) return cached;
    const link = this.g
      .parentLinks(id)
      .find((l) => this.opts.includeAdopted || l.link.kind === "biological" || l.link.kind === "unknown");
    const ids = (link?.union.partnerIds ?? []).filter((p) => this.g.hasPerson(p));
    const result: Parents = [ids[0], ids[1]];
    this.parentsMemo.set(id, result);
    return result;
  }

  private rank(id: PersonId): number {
    const cached = this.rankMemo.get(id);
    if (cached !== undefined) return cached;
    const key = `rank:${id}`;
    if (this.active.has(key)) return 0; // Zyklus: nicht weiter absteigen
    this.active.add(key);
    let r = 0;
    for (const p of this.parentsOf(id)) if (p) r = Math.max(r, this.rank(p) + 1);
    this.active.delete(key);
    this.rankMemo.set(id, r);
    return r;
  }

  /** Kinship-Koeffizient φ(a, b). Unbekannte Personen: 0. */
  kinship(a: PersonId | undefined, b: PersonId | undefined): number {
    if (!a || !b || !this.g.hasPerson(a) || !this.g.hasPerson(b)) return 0;
    if (a === b) {
      const [f, m] = this.parentsOf(a);
      return (1 + (f && m ? this.kinship(f, m) : 0)) / 2;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const cached = this.phiMemo.get(key);
    if (cached !== undefined) return cached;
    if (this.active.has(key)) return 0;
    this.active.add(key);

    // die Person mit dem größeren Rang durch ihre Eltern ersetzen
    const [older, younger] = this.rank(a) >= this.rank(b) ? [b, a] : [a, b];
    const [f, m] = this.parentsOf(younger);
    const value = (this.kinship(f, older) + this.kinship(m, older)) / 2;

    this.active.delete(key);
    this.phiMemo.set(key, value);
    return value;
  }

  /** Inzuchtkoeffizient F: Kinship der Eltern. 0, wenn ein Elternteil unbekannt ist. */
  inbreeding(id: PersonId): number {
    const [f, m] = this.parentsOf(id);
    return f && m ? this.kinship(f, m) : 0;
  }
}

/** Einmalige Abfrage des Inzuchtkoeffizienten. Für viele Abfragen `KinshipCalculator` nutzen. */
export function inbreedingCoefficient(g: FamilyGraph, id: PersonId, opts: KinshipOptions = {}): number {
  return new KinshipCalculator(g, opts).inbreeding(id);
}
