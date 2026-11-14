/**
 * Aufbereitung einer Person für das Detailfenster (reines TypeScript, ohne Svelte; in Node testbar).
 * Die Svelte-Komponente zeigt das Ergebnis nur an.
 */
import { formatFuzzyDate } from "../core";
import type { ChildLinkKind, FamilyGraph, LifeEvent, PersonId, Sex, Source, Status, Union } from "../core";
import { displayName, lifeSpan } from "../render/style";
import { translate } from "./i18n";
import type { Lang, MessageKey } from "./i18n";

/** Schlüssel der Statusbezeichnungen (Text je Sprache über `translate`). */
export const STATUS_KEY: Record<Status, MessageKey> = {
  proven: "person.status.proven",
  assumed: "person.status.assumed",
  unknown: "person.status.unknown",
};

const KIND_KEY: Record<Exclude<ChildLinkKind, "biological">, MessageKey> = {
  adopted: "person.link.adopted",
  foster: "person.link.foster",
  unknown: "person.link.unknown",
};

export interface RelativeRef {
  id: PersonId;
  name: string;
  span: string;
  /** Hinweis wie „adoptiert“ oder „vermutet“; leer bei leiblich und belegt */
  note: string;
}

export interface CitationInfo {
  title: string;
  detail?: string;
  /** nur http(s)-Adressen, damit keine `javascript:`-Links entstehen */
  url?: string;
}

export interface EventInfo {
  label: string;
  date: string;
  place?: string;
  status: Status;
  citations: CitationInfo[];
}

export interface UnionInfo {
  id: string;
  title: string;
  status: Status;
  partner?: RelativeRef;
  period: string;
  children: RelativeRef[];
}

export interface ParentsInfo {
  /** z. B. „adoptiert, vermutet“; leer bei leiblich und belegt */
  note: string;
  parents: RelativeRef[];
}

export interface PersonInfo {
  id: PersonId;
  name: string;
  sex: string;
  span: string;
  status: Status;
  events: EventInfo[];
  notes: string[];
  externalRefs: string[];
  parentFamilies: ParentsInfo[];
  unions: UnionInfo[];
  siblings: { full: RelativeRef[]; half: RelativeRef[] };
}

const safeUrl = (u: string | undefined): string | undefined => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** „adoptiert, vermutet“ aus Art und Status einer Verknüpfung; leer bei leiblich und belegt. */
function linkNote(kind: ChildLinkKind, status: Status | undefined, lang: Lang): string {
  return [
    kind === "biological" ? "" : translate(lang, KIND_KEY[kind]),
    status && status !== "proven" ? translate(lang, STATUS_KEY[status]) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function eventInfo(label: string, ev: LifeEvent | undefined, sources: ReadonlyMap<string, Source>, lang: Lang): EventInfo | null {
  if (!ev) return null;
  return {
    label,
    date: formatFuzzyDate(ev.date, lang),
    place: ev.place?.name,
    status: ev.status ?? "proven",
    citations: (ev.citations ?? []).map((c) => {
      const s = sources.get(c.sourceId);
      return { title: s?.title ?? translate(lang, "person.sourceUnnamed", { id: c.sourceId }), detail: c.detail, url: safeUrl(s?.url) };
    }),
  };
}

function unionPeriod(u: Union, lang: Lang): string {
  const start = u.start ? formatFuzzyDate(u.start.date, lang) : "";
  const end = u.end ? formatFuzzyDate(u.end.date, lang) : "";
  const reason = u.endReason === "divorce" ? translate(lang, "person.union.divorced") : u.endReason === "death" ? translate(lang, "person.union.death") : "";
  if (start && end) return `${start} – ${end}${reason ? ` (${reason})` : ""}`;
  if (start) return start;
  if (end) return `${translate(lang, "person.union.until", { date: end })}${reason ? ` (${reason})` : ""}`;
  return reason;
}

/** Baut die Anzeigedaten. Gibt `null` zurück, wenn es die Person nicht gibt. */
export function describePerson(
  graph: FamilyGraph,
  sources: ReadonlyMap<string, Source>,
  id: PersonId,
  lang: Lang = "de",
): PersonInfo | null {
  const p = graph.getPerson(id);
  if (!p) return null;

  const ref = (pid: PersonId, note = ""): RelativeRef => {
    const q = graph.getPerson(pid);
    return { id: pid, name: displayName(q), span: lifeSpan(q), note };
  };

  const parentFamilies = graph.parentLinks(id).map(({ union, link }) => ({
    note: linkNote(link.kind, link.status, lang),
    parents: union.partnerIds.filter((x) => graph.hasPerson(x)).map((x) => ref(x)),
  }));

  const unions = graph.unionsOf(id).map((u) => {
    const kindLabel = translate(lang, u.kind === "marriage" ? "person.union.marriage" : u.kind === "partnership" ? "person.union.partnership" : "person.union.other");
    const partnerId = u.partnerIds.find((x) => x !== id && graph.hasPerson(x));
    return {
      id: u.id,
      title: u.order ? translate(lang, "person.union.ordered", { order: u.order, kind: kindLabel }) : kindLabel,
      status: u.status ?? "proven",
      partner: partnerId ? ref(partnerId) : undefined,
      period: unionPeriod(u, lang),
      children: u.children
        .filter((c) => graph.hasPerson(c.personId))
        .map((c) => ref(c.personId, linkNote(c.kind, c.status, lang))),
    };
  });

  const sib = graph.siblings(id);
  const events = [eventInfo(translate(lang, "person.event.birth"), p.birth, sources, lang), eventInfo(translate(lang, "person.event.death"), p.death, sources, lang)].filter(
    (e): e is EventInfo => e !== null,
  );

  return {
    id,
    name: displayName(p),
    sex: translate(lang, `person.sex.${p.sex}` as MessageKey),
    span: lifeSpan(p),
    status: p.status ?? "proven",
    events,
    notes: p.notes ?? [],
    externalRefs: (p.externalRefs ?? []).map((r) => `${r.system}: ${r.id}`),
    parentFamilies,
    unions,
    siblings: { full: sib.full.map((x) => ref(x)), half: sib.half.map((x) => ref(x)) },
  };
}
