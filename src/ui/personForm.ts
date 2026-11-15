/**
 * Formular „Person bearbeiten“ (M10, Schritt 4, D40): reines TypeScript ohne Svelte, in Node testbar.
 *
 * Das Formular arbeitet mit Texten (`PersonForm`). `personToForm` füllt es aus einer Person,
 * `buildEdit` prüft die Eingaben und baut daraus EINE Operation für `edit(op)` in `App.svelte`:
 * `updatePerson`, bei neu angelegten Quellen ein `patch` (Quellen + Person), damit es ein Undo-Schritt bleibt.
 * Leere Felder werden entfernt statt als "" gespeichert. Nicht im Formular stehende Felder
 * (`externalRefs`, weitere Zitate-Felder) bleiben unverändert.
 */
import { formatFuzzyDate, IdSource, parseFuzzyDate } from "../core";
import type { Citation, EditOp, FuzzyDate, LifeEvent, Person, Place, Sex, Source, Status } from "../core";
import type { MessageKey } from "./i18n";

/** Auswahlwert „neue Quelle anlegen“ in der Quellenliste. */
export const NEW_SOURCE = "__new";

export interface CitationForm {
  /** "" = nichts gewählt, `NEW_SOURCE` = neue Quelle (dann `newTitle`), sonst eine Quellen-ID */
  sourceId: string;
  newTitle: string;
  newUrl: string;
  detail: string;
}

export interface EventForm {
  date: string;
  place: string;
  lat: string;
  lon: string;
  status: Status;
  citations: CitationForm[];
}

export interface PersonForm {
  givenNames: string;
  surname: string;
  sex: Sex;
  status: Status;
  birth: EventForm;
  death: EventForm;
  /** ein Absatz je Notiz, getrennt durch eine Leerzeile */
  notes: string;
}

/** Fehler eines Feldes: Schlüssel im Wörterbuch plus Parameter. Feldnamen wie `birth.date`, `death.cite.0`. */
export interface FieldError {
  key: MessageKey;
  vars?: Record<string, string | number>;
}
export type FormErrors = Record<string, FieldError>;

export const emptyCitation = (): CitationForm => ({ sourceId: "", newTitle: "", newUrl: "", detail: "" });

const num = (n: number | undefined) => (n === undefined ? "" : String(n));

/** Datum als Text: der Originaltext, sonst die deutsche Schreibweise (nur die versteht `parseFuzzyDate`). */
const dateText = (d: FuzzyDate | undefined): string => (d ? (d.text ?? formatFuzzyDate(d, "de")) : "");

function eventToForm(ev: LifeEvent | undefined): EventForm {
  return {
    date: dateText(ev?.date),
    place: ev?.place?.name ?? "",
    lat: num(ev?.place?.lat),
    lon: num(ev?.place?.lon),
    status: ev?.status ?? "proven",
    citations: (ev?.citations ?? []).map((c) => ({ sourceId: c.sourceId, newTitle: "", newUrl: "", detail: c.detail ?? "" })),
  };
}

export function personToForm(p: Person): PersonForm {
  return {
    givenNames: p.givenNames ?? "",
    surname: p.surname ?? "",
    sex: p.sex,
    status: p.status ?? "proven",
    birth: eventToForm(p.birth),
    death: eventToForm(p.death),
    notes: (p.notes ?? []).join("\n\n"),
  };
}

/** Zahl mit Punkt oder Komma; `undefined` = leer, `null` = keine Zahl. */
function parseNumber(raw: string): number | undefined | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return undefined;
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const clean = (s: string): string | undefined => s.trim() || undefined;

interface EventResult {
  event: LifeEvent | undefined;
  newSources: Omit<Source, "id">[];
}

/**
 * Prüft ein Ereignis und baut es. `origin` ist das bisherige Ereignis (unbekannte Felder bleiben).
 * Neue Quellen werden als Liste zurückgegeben; ihre Zitate tragen vorläufig `new:<Nr>` als Quellen-ID.
 */
function buildEvent(
  key: "birth" | "death",
  f: EventForm,
  origin: LifeEvent | undefined,
  sources: readonly Source[],
  errors: FormErrors,
  pending: Omit<Source, "id">[],
): LifeEvent | undefined {
  const ev: LifeEvent = { ...origin };
  delete ev.date;
  delete ev.place;
  delete ev.citations;
  delete ev.status;

  // Datum: unveränderter Text behält das bisherige Datum (auch unlesbare Altdaten)
  const dText = f.date.trim();
  if (dText) {
    if (origin?.date && dText === dateText(origin.date).trim()) ev.date = origin.date;
    else {
      const d = parseFuzzyDate(dText);
      if (d) ev.date = d;
      else errors[`${key}.date`] = { key: "edit.err.date" };
    }
  }

  // Ort: Name, optional Koordinaten (beide oder keine)
  const name = clean(f.place);
  const lat = parseNumber(f.lat);
  const lon = parseNumber(f.lon);
  if (lat === null || (lat !== undefined && (lat < -90 || lat > 90))) errors[`${key}.lat`] = { key: "edit.err.lat" };
  if (lon === null || (lon !== undefined && (lon < -180 || lon > 180))) errors[`${key}.lon`] = { key: "edit.err.lon" };
  if (lat !== null && lon !== null && (lat === undefined) !== (lon === undefined))
    errors[lat === undefined ? `${key}.lat` : `${key}.lon`] = { key: "edit.err.coordPair" };
  if (!name && (lat !== undefined || lon !== undefined) && !errors[`${key}.lat`] && !errors[`${key}.lon`])
    errors[`${key}.place`] = { key: "edit.err.placeName" };
  if (name) {
    const place: Place = { name };
    if (typeof lat === "number" && typeof lon === "number") {
      place.lat = lat;
      place.lon = lon;
    }
    ev.place = place;
  }

  // Quellen
  const known = new Set(sources.map((s) => s.id));
  const cites: Citation[] = [];
  f.citations.forEach((c, i) => {
    const detail = clean(c.detail);
    if (!c.sourceId) {
      if (detail) errors[`${key}.cite.${i}`] = { key: "edit.err.sourcePick" };
      return;
    }
    let sourceId = c.sourceId;
    if (sourceId === NEW_SOURCE) {
      const title = clean(c.newTitle);
      if (!title) {
        errors[`${key}.cite.${i}`] = { key: "edit.err.sourceTitle" };
        return;
      }
      const url = clean(c.newUrl);
      if (url && !/^https?:\/\//i.test(url)) {
        errors[`${key}.cite.${i}`] = { key: "edit.err.sourceUrl" };
        return;
      }
      pending.push(url ? { title, url } : { title });
      sourceId = `new:${pending.length - 1}`;
    } else if (!known.has(sourceId)) {
      errors[`${key}.cite.${i}`] = { key: "edit.err.sourceGone" };
      return;
    }
    cites.push(detail ? { sourceId, detail } : { sourceId });
  });
  if (cites.length) ev.citations = cites;

  // Ein Ereignis gibt es nur mit Datum, Ort oder Quelle; Status allein ergibt keins.
  if (!ev.date && !ev.place && !ev.citations) return undefined;
  if (f.status !== "proven" || origin?.status !== undefined) ev.status = f.status;
  return ev;
}

export type BuildResult = { ok: true; op: EditOp } | { ok: false; errors: FormErrors };

/** Prüft das Formular. Bei Fehlern wird nichts gebaut (`errors` je Feld), sonst die Operation zum Speichern. */
export function buildEdit(base: Person, form: PersonForm, sources: readonly Source[]): BuildResult {
  const errors: FormErrors = {};
  const pending: Omit<Source, "id">[] = [];
  const birth = buildEvent("birth", form.birth, base.birth, sources, errors, pending);
  const death = buildEvent("death", form.death, base.death, sources, errors, pending);
  if (Object.keys(errors).length) return { ok: false, errors };

  const p: Person = { ...base, sex: form.sex };
  for (const k of ["givenNames", "surname"] as const) {
    const v = clean(form[k]);
    if (v) p[k] = v;
    else delete p[k];
  }
  if (form.status !== "proven" || base.status !== undefined) p.status = form.status;
  else delete p.status;
  if (birth) p.birth = birth;
  else delete p.birth;
  if (death) p.death = death;
  else delete p.death;

  // Notizen: unverändert = bisherige Liste, sonst ein Eintrag je Absatz
  if (form.notes === (base.notes ?? []).join("\n\n")) {
    // unverändert
  } else {
    const notes = form.notes.split(/\n\s*\n/).map((n) => n.trim()).filter(Boolean);
    if (notes.length) p.notes = notes;
    else delete p.notes;
  }

  if (!pending.length) return { ok: true, op: { type: "updatePerson", person: p } };

  // Neue Quellen: eine Operation (patch), damit Quellen und Person zusammen ein Undo-Schritt sind.
  const ids = new IdSource("s", sources.map((s) => s.id));
  const created: Source[] = pending.map((s) => ({ ...s, id: ids.take() }));
  const fix = (ev: LifeEvent | undefined): LifeEvent | undefined =>
    ev?.citations
      ? { ...ev, citations: ev.citations.map((c) => (c.sourceId.startsWith("new:") ? { ...c, sourceId: created[Number(c.sourceId.slice(4))]!.id } : c)) }
      : ev;
  const fixed: Person = { ...p };
  const b = fix(p.birth);
  const d = fix(p.death);
  if (b) fixed.birth = b;
  if (d) fixed.death = d;
  return { ok: true, op: { type: "patch", changes: { putSources: created, putPersons: [fixed] } } };
}

/** Gleicht Eingabe und Ausgangsstand: gibt es ungespeicherte Änderungen? */
export const formChanged = (a: PersonForm, b: PersonForm): boolean => JSON.stringify(a) !== JSON.stringify(b);
