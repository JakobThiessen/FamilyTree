/**
 * Provider-Schnittstelle (M8, D25): Anbieter für Personen aus offenen Quellen.
 * Reines TypeScript. Ein Anbieter holt Daten nur, wenn der Nutzer die Abfrage bewusst auslöst,
 * und liefert sie im Format unten; `adopt.ts` macht daraus (vermutete) Personen im Baum.
 */
import type { ExternalRef, FuzzyDate, Sex } from "../core/types";

/** Suchanfrage. Alles optional, aber ein Nachname ist praktisch nötig. */
export interface PersonQuery {
  givenNames?: string;
  surname?: string;
  birthYear?: number;
  deathYear?: number;
}

/** Ereignis einer externen Person (Datum und Ort als Text). */
export interface ExternalEvent {
  date?: FuzzyDate;
  place?: string;
}

/** Eine Person, wie sie die Quelle liefert (noch ohne Bezug zum eigenen Baum). */
export interface ExternalPerson {
  /** Kennung in der Quelle, z. B. `{ system: "wikidata", id: "Q42" }` */
  ref: ExternalRef;
  /** Link zur Seite der Quelle (wird als Quelle gespeichert) */
  url: string;
  givenNames?: string;
  surname?: string;
  sex: Sex;
  birth?: ExternalEvent;
  death?: ExternalEvent;
  /** Kurzbeschreibung der Quelle (z. B. Wikidata-Beschreibung) für die Trefferliste */
  summary?: string;
}

/** Partnerschaft samt Kindern, alles über `ExternalRef` statt über eigene IDs. */
export interface ExternalUnion {
  /** 0 bis 2 Partner */
  partners: ExternalRef[];
  children: ExternalRef[];
  marriage?: ExternalEvent;
  /** Ende der Partnerschaft (Datum), falls die Quelle es nennt */
  end?: ExternalEvent;
}

/** Eine Person mit ihrer nächsten Familie (Eltern, Partner, Kinder). */
export interface ImportBatch {
  provider: string;
  root: ExternalRef;
  /** enthält auch die Wurzelperson */
  people: ExternalPerson[];
  unions: ExternalUnion[];
}

/** Gemeinsame Einstellungen für Abfragen (alles optional, nützlich in Tests und im Browser). */
export interface ProviderContext {
  /** Ersatz für `fetch` (Tests; im Browser das globale `fetch`) */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface Provider {
  id: string;
  label: string;
  /** Braucht der Anbieter einen Zugangsschlüssel? (FamilySearch) */
  needsKey: boolean;
  /** Kurzer Hinweis, was an wen gesendet wird (für die Anzeige vor der Abfrage) */
  disclosure: string;
  search(query: PersonQuery, ctx?: ProviderContext): Promise<ExternalPerson[]>;
  /** Eltern, Partner und Kinder einer Person (eine Generation, tiefer durch erneutes Abfragen). */
  fetchRelatives(ref: ExternalRef, ctx?: ProviderContext): Promise<ImportBatch>;
}

export type ProviderErrorKind =
  /** Verbindung gescheitert: offline, blockiert oder CORS (Browser verbietet den Abruf) */
  | "network"
  /** Server antwortet mit Fehlercode (z. B. 429 = zu viele Anfragen, 401 = Schlüssel) */
  | "http"
  /** Antwort hat nicht das erwartete Format */
  | "format"
  /** Einstellung fehlt (z. B. Schlüssel) */
  | "config"
  /** Funktion ist für diesen Anbieter nicht umgesetzt */
  | "unsupported";

export class ProviderError extends Error {
  /**
   * @param message deutscher Text (Rückfall, Tests)
   * @param detail  Code und Parameter für die Übersetzung in der Oberfläche (`provider.error.<code>`, D37)
   */
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    readonly detail?: { code: string; params?: Record<string, string | number> },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Schlüssel für Vergleiche und Karten: `system:id`. */
export const refKey = (r: ExternalRef): string => `${r.system}:${r.id}`;
