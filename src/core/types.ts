/**
 * Datenmodell (siehe docs/DATA-MODEL.md).
 * Reines TypeScript, kein DOM, kein Framework.
 */

export type PersonId = string; // "p_..."
export type UnionId = string; // "u_..."
export type SourceId = string; // "s_..."

/** Wie sicher ist eine Aussage? */
export type Status = "proven" | "assumed" | "unknown";

/** Unscharfes Datum, z. B. "um 1750" oder "zwischen 1700 und 1710". */
export interface FuzzyDate {
  kind: "exact" | "about" | "before" | "after" | "between";
  year?: number;
  month?: number;
  day?: number;
  /** nur bei kind = "between" */
  yearTo?: number;
  /** Originaltext aus der Quelle */
  text?: string;
}

export interface Place {
  name: string;
  lat?: number;
  lon?: number;
}

export interface Citation {
  sourceId: SourceId;
  /** Fundstelle, z. B. Seite im Kirchenbuch */
  detail?: string;
}

export interface Source {
  id: SourceId;
  title: string;
  url?: string;
  note?: string;
  externalRefs?: ExternalRef[];
}

export interface LifeEvent {
  date?: FuzzyDate;
  place?: Place;
  status?: Status;
  citations?: Citation[];
}

/** Verweis auf externe Systeme (GEDCOM-ID, WikiTree, Wikidata ...). */
export interface ExternalRef {
  system: string; // "gedcom" | "wikitree" | "wikidata" | ...
  id: string;
}

export type Sex = "M" | "F" | "U";

export interface Person {
  id: PersonId;
  givenNames?: string;
  surname?: string;
  sex: Sex;
  birth?: LifeEvent;
  death?: LifeEvent;
  notes?: string[];
  externalRefs?: ExternalRef[];
  status?: Status;
}

export type UnionKind = "marriage" | "partnership" | "unknown";
export type ChildLinkKind = "biological" | "adopted" | "foster" | "unknown";

/** Kind-Verknüpfung an einer Union. */
export interface ChildLink {
  personId: PersonId;
  kind: ChildLinkKind;
  status?: Status;
}

/**
 * Partnerschaft. Kinder hängen an der Union, nicht an einem Partner.
 * Mehrere Ehen einer Person = mehrere Unions mit `order`.
 */
export interface Union {
  id: UnionId;
  /** 0 bis 2 Partner (unbekannter Partner = nur einer) */
  partnerIds: PersonId[];
  kind: UnionKind;
  /** Reihenfolge der Union aus Sicht der Partner (1 = erste Ehe) */
  order?: number;
  start?: LifeEvent;
  end?: LifeEvent;
  endReason?: "death" | "divorce" | "unknown";
  children: ChildLink[];
  status?: Status;
  /** z. B. GEDCOM-ID der Familie (`FAM`) */
  externalRefs?: ExternalRef[];
}

/** Vollständiger Stammbaum im JSON-Austauschformat. */
export interface TreeData {
  version: 1;
  persons: Person[];
  unions: Union[];
  sources: Source[];
}

/** Anfrage für eine Ansicht: Fokus plus Tiefe in beide Richtungen. */
export interface ViewRequest {
  focusId: PersonId;
  up: number;
  down: number;
  mode: "direct" | "family" | "all";
}
