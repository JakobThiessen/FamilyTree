/**
 * Aufbereitung einer Person für das Detailfenster (reines TypeScript, ohne Svelte; in Node testbar).
 * Die Svelte-Komponente zeigt das Ergebnis nur an.
 */
import { formatFuzzyDate } from "../core";
import type { ChildLinkKind, FamilyGraph, LifeEvent, PersonId, Sex, Source, Status, Union } from "../core";
import { displayName, lifeSpan } from "../render/style";

export const STATUS_LABEL: Record<Status, string> = {
  proven: "belegt",
  assumed: "vermutet",
  unknown: "unbekannt",
};

const SEX_LABEL: Record<Sex, string> = { M: "männlich", F: "weiblich", U: "unbekannt" };
const KIND_LABEL: Record<ChildLinkKind, string> = {
  biological: "leiblich",
  adopted: "adoptiert",
  foster: "Pflegekind",
  unknown: "Art unbekannt",
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
function linkNote(kind: ChildLinkKind, status: Status | undefined): string {
  return [kind === "biological" ? "" : KIND_LABEL[kind], status && status !== "proven" ? STATUS_LABEL[status] : ""]
    .filter(Boolean)
    .join(", ");
}

function eventInfo(label: string, ev: LifeEvent | undefined, sources: ReadonlyMap<string, Source>): EventInfo | null {
  if (!ev) return null;
  return {
    label,
    date: formatFuzzyDate(ev.date),
    place: ev.place?.name,
    status: ev.status ?? "proven",
    citations: (ev.citations ?? []).map((c) => {
      const s = sources.get(c.sourceId);
      return { title: s?.title ?? `Quelle ${c.sourceId}`, detail: c.detail, url: safeUrl(s?.url) };
    }),
  };
}

function unionPeriod(u: Union): string {
  const start = u.start ? formatFuzzyDate(u.start.date) : "";
  const end = u.end ? formatFuzzyDate(u.end.date) : "";
  const reason = u.endReason === "divorce" ? "geschieden" : u.endReason === "death" ? "Tod" : "";
  if (start && end) return `${start} – ${end}${reason ? ` (${reason})` : ""}`;
  if (start) return start;
  if (end) return `bis ${end}${reason ? ` (${reason})` : ""}`;
  return reason;
}

/** Baut die Anzeigedaten. Gibt `null` zurück, wenn es die Person nicht gibt. */
export function describePerson(
  graph: FamilyGraph,
  sources: ReadonlyMap<string, Source>,
  id: PersonId,
): PersonInfo | null {
  const p = graph.getPerson(id);
  if (!p) return null;

  const ref = (pid: PersonId, note = ""): RelativeRef => {
    const q = graph.getPerson(pid);
    return { id: pid, name: displayName(q), span: lifeSpan(q), note };
  };

  const parentFamilies = graph.parentLinks(id).map(({ union, link }) => ({
    note: linkNote(link.kind, link.status),
    parents: union.partnerIds.filter((x) => graph.hasPerson(x)).map((x) => ref(x)),
  }));

  const unions = graph.unionsOf(id).map((u) => {
    const kindLabel = u.kind === "marriage" ? "Ehe" : u.kind === "partnership" ? "Partnerschaft" : "Verbindung";
    const partnerId = u.partnerIds.find((x) => x !== id && graph.hasPerson(x));
    return {
      id: u.id,
      title: u.order ? `${u.order}. ${kindLabel}` : kindLabel,
      status: u.status ?? "proven",
      partner: partnerId ? ref(partnerId) : undefined,
      period: unionPeriod(u),
      children: u.children
        .filter((c) => graph.hasPerson(c.personId))
        .map((c) => ref(c.personId, linkNote(c.kind, c.status))),
    };
  });

  const sib = graph.siblings(id);
  const events = [eventInfo("Geburt", p.birth, sources), eventInfo("Tod", p.death, sources)].filter(
    (e): e is EventInfo => e !== null,
  );

  return {
    id,
    name: displayName(p),
    sex: SEX_LABEL[p.sex],
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
