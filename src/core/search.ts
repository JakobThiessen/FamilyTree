/**
 * Namenssuche (reines TypeScript).
 *
 * Der Index normalisiert jeden Namen einmal (klein, ohne Akzente, ß = ss). Eine Anfrage besteht aus
 * Wörtern; jedes Wort muss irgendwo im Namen oder in den Lebensjahren vorkommen.
 * Treffer am Wortanfang zählen besser als Treffer mitten im Wort.
 */
import type { Person, PersonId } from "./types";

/** Kleinbuchstaben, ohne Akzente/Umlaut-Punkte, „ß“ als „ss“. „Müller“ findet damit „muller“ und „mueller“ nicht, aber „Muller“. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export interface SearchHit {
  id: PersonId;
  /** kleiner = besser (0 = alle Wörter am Wortanfang) */
  score: number;
}

interface Entry {
  id: PersonId;
  /** normalisierter Text: Vorname, Nachname, Geburts- und Sterbejahr */
  text: string;
  /** Sortierschlüssel (Nachname, Vorname) */
  sortKey: string;
}

export class PersonSearchIndex {
  private readonly entries: Entry[];

  constructor(persons: Iterable<Person>) {
    this.entries = [];
    for (const p of persons) {
      const parts = [p.givenNames, p.surname, p.birth?.date?.year, p.death?.date?.year];
      const text = normalizeText(parts.filter((x) => x !== undefined && x !== "").join(" "));
      const sortKey = normalizeText(`${p.surname ?? ""} ${p.givenNames ?? ""}`);
      this.entries.push({ id: p.id, text, sortKey });
    }
  }

  get size(): number {
    return this.entries.length;
  }

  /** Beste Treffer (höchstens `limit`), sortiert nach Güte, dann nach Nachname und Vorname. */
  search(query: string, limit = 20): SearchHit[] {
    const words = normalizeText(query).split(/\s+/).filter(Boolean);
    if (words.length === 0 || limit <= 0) return [];

    // Nur die besten `limit` Treffer halten (Einfügen in eine kurze, sortierte Liste): spart das Sortieren aller Treffer.
    const best: { hit: SearchHit; sortKey: string }[] = [];
    const worse = (a: { hit: SearchHit; sortKey: string }, b: { hit: SearchHit; sortKey: string }) =>
      a.hit.score !== b.hit.score ? a.hit.score > b.hit.score : a.sortKey > b.sortKey;

    for (const e of this.entries) {
      let score = 0;
      for (const w of words) {
        const at = e.text.indexOf(w);
        if (at < 0) {
          score = -1;
          break;
        }
        // Wortanfang: am Textanfang oder nach einem Leerzeichen. Sonst ein weiter Treffer im Wort.
        const startsWord = at === 0 || e.text[at - 1] === " " || e.text.indexOf(" " + w) >= 0;
        if (!startsWord) score += 1;
      }
      if (score < 0) continue;

      const item = { hit: { id: e.id, score }, sortKey: e.sortKey };
      if (best.length === limit && !worse(best[limit - 1]!, item)) continue;
      let i = best.length;
      while (i > 0 && worse(best[i - 1]!, item)) i--;
      best.splice(i, 0, item);
      if (best.length > limit) best.pop();
    }
    return best.map((b) => b.hit);
  }
}
