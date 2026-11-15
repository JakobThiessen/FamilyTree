/**
 * GEDCOM 5.5.1 -> TreeData (Personen, Unions, Quellen).
 * Reines TypeScript ohne DOM. Fehlerhafte Stellen werden übersprungen und als Warnung gemeldet,
 * der Import bricht nicht ab (Prinzip wie bei FamilyGraph, siehe DECISIONS.md D9).
 *
 * Abbildung: INDI -> Person, FAM -> Union (HUSB/WIFE = partnerIds, CHIL = children, MARR = start,
 * DIV = end), SOUR-Datensatz -> Source, NOTE -> Person.notes. GEDCOM-IDs landen in `externalRefs`.
 */

import { compareFuzzyDate } from "../core/fuzzyDate";
import type {
  ChildLink,
  ChildLinkKind,
  Citation,
  ExternalRef,
  LifeEvent,
  Person,
  Place,
  Sex,
  Source,
  TreeData,
  Union,
} from "../core/types";
import { decodeGedcom, type GedcomCharset } from "./gedcomCharset";
import { parseGedcomDate } from "./gedcomDate";
import { child, childrenOf, childValue, parseGedcomText, pointer, type GedcomNode } from "./gedcomParser";

export interface ImportWarning {
  /** deutscher Text (Rückfall) */
  message: string;
  /** Code und Parameter für die Übersetzung (UI: `warn.<code>`) */
  code?: string;
  params?: Record<string, string | number>;
  /** Zeilennummer in der GEDCOM-Datei, falls bekannt */
  line?: number;
}

export interface ImportResult {
  data: TreeData;
  warnings: ImportWarning[];
  /** Erkannter Zeichensatz (bei Text-Eingabe nicht gesetzt) */
  charset?: GedcomCharset;
}

/** `externalRefs`-System für GEDCOM-Kennungen (ohne @, z. B. "I12"). */
export const GEDCOM_SYSTEM = "gedcom";

function gedcomRef(xref: string): ExternalRef[] {
  return [{ system: GEDCOM_SYSTEM, id: xref }];
}

/** "Johann Georg /Beispiel/ Jr." -> { given, surname }. Ein Namenszusatz hinter dem Nachnamen entfällt. */
export function parseGedcomName(value: string): { givenNames?: string; surname?: string } {
  const m = value.match(/^(.*?)\/([^/]*)\/?/);
  const given = (m ? m[1]! : value).trim();
  const surname = (m ? m[2]! : "").trim();
  const out: { givenNames?: string; surname?: string } = {};
  if (given) out.givenNames = given;
  if (surname) out.surname = surname;
  return out;
}

class Importer {
  readonly warnings: ImportWarning[] = [];
  readonly persons: Person[] = [];
  readonly unions: Union[] = [];
  readonly sources: Source[] = [];

  private personByXref = new Map<string, Person>();
  private sourceByXref = new Map<string, Source>();
  private sourceByTitle = new Map<string, Source>();
  private notesByXref = new Map<string, string>();
  private unionByXref = new Map<string, Union>();

  warn(code: string, params: Record<string, string | number>, message: string, node?: GedcomNode): void {
    this.warnings.push(node ? { message, code, params, line: node.line } : { message, code, params });
  }

  run(records: GedcomNode[]): void {
    // Erst alle Zielobjekte anlegen, damit Zeiger in beliebiger Reihenfolge aufgelöst werden.
    for (const r of records) if (r.tag === "NOTE" && r.xref) this.notesByXref.set(r.xref, r.value);
    for (const r of records) if (r.tag === "SOUR" && r.xref) this.addSourceRecord(r);
    for (const r of records) if (r.tag === "INDI") this.addPerson(r);
    for (const r of records) if (r.tag === "FAM") this.addUnion(r);
    this.linkFamc(records);
    this.assignOrder();
  }

  // ---- Quellen ----

  private addSourceRecord(r: GedcomNode): void {
    const id = `s_${this.sources.length + 1}`;
    const src: Source = { id, title: childValue(r, "TITL") ?? childValue(r, "ABBR") ?? "(ohne Titel)" };
    const url = childValue(r, "WWW");
    if (url) src.url = url;
    const note = [childValue(r, "PUBL"), childValue(r, "TEXT"), this.noteText(child(r, "NOTE"))].filter(Boolean).join("\n");
    if (note) src.note = note;
    src.externalRefs = gedcomRef(r.xref!);
    this.sources.push(src);
    this.sourceByXref.set(r.xref!, src);
  }

  private citations(event: GedcomNode): Citation[] {
    const result: Citation[] = [];
    for (const s of childrenOf(event, "SOUR")) {
      const ptr = pointer(s.value);
      let src: Source | undefined;
      if (ptr) {
        src = this.sourceByXref.get(ptr);
        if (!src) {
          this.warn("source-missing", { ptr }, `Quelle @${ptr}@ nicht gefunden.`, s);
          continue;
        }
      } else if (s.value.trim()) {
        // Quelle als Freitext: gleiche Titel teilen sich eine Quelle.
        const title = s.value.trim();
        src = this.sourceByTitle.get(title);
        if (!src) {
          src = { id: `s_${this.sources.length + 1}`, title };
          this.sources.push(src);
          this.sourceByTitle.set(title, src);
        }
      } else continue;
      const c: Citation = { sourceId: src.id };
      const page = childValue(s, "PAGE");
      if (page) c.detail = page;
      result.push(c);
    }
    return result;
  }

  // ---- Ereignisse ----

  private place(node: GedcomNode): Place | undefined {
    const plac = child(node, "PLAC");
    const name = plac?.value.trim();
    if (!plac || !name) return undefined;
    const place: Place = { name };
    const map = child(plac, "MAP");
    if (map) {
      const coord = (v: string | undefined, neg: string): number | undefined => {
        const m = v?.match(/^([NSEW])?\s*(-?\d+(?:\.\d+)?)$/i);
        if (!m) return undefined;
        const n = Number(m[2]);
        return m[1]?.toUpperCase() === neg ? -n : n;
      };
      const lat = coord(childValue(map, "LATI"), "S");
      const lon = coord(childValue(map, "LONG"), "W");
      if (lat !== undefined) place.lat = lat;
      if (lon !== undefined) place.lon = lon;
    }
    return place;
  }

  private event(node: GedcomNode): LifeEvent {
    const ev: LifeEvent = {};
    const dateText = childValue(node, "DATE");
    if (dateText) {
      // Unlesbare Daten bleiben als Freitext erhalten (kind "about" ohne Jahr, siehe formatFuzzyDate).
      const parsed = parseGedcomDate(dateText);
      if (!parsed) this.warn("date-unreadable", { text: dateText }, `Datum nicht lesbar, als Text übernommen: "${dateText}"`, node);
      ev.date = parsed ?? { kind: "about", text: dateText };
    }
    const place = this.place(node);
    if (place) ev.place = place;
    const cits = this.citations(node);
    if (cits.length) ev.citations = cits;
    return ev;
  }

  private noteText(n: GedcomNode | undefined): string | undefined {
    if (!n) return undefined;
    const ptr = pointer(n.value);
    if (ptr) {
      const t = this.notesByXref.get(ptr);
      if (t === undefined) this.warn("note-missing", { ptr }, `Notiz @${ptr}@ nicht gefunden.`, n);
      return t?.trim() || undefined;
    }
    return n.value.trim() || undefined;
  }

  // ---- Personen ----

  private addPerson(r: GedcomNode): void {
    if (!r.xref) return this.warn("indi-no-id", {}, "INDI ohne Kennung übersprungen.", r);
    if (this.personByXref.has(r.xref)) return this.warn("indi-duplicate", { xref: r.xref }, `Doppelte Personen-Kennung @${r.xref}@, zweite ignoriert.`, r);

    const sexValue = childValue(r, "SEX")?.toUpperCase();
    const sex: Sex = sexValue === "M" ? "M" : sexValue === "F" ? "F" : "U";
    const person: Person = { id: `p_${this.persons.length + 1}`, sex };

    const names = childrenOf(r, "NAME");
    const main = names[0];
    if (main) {
      const parsed = parseGedcomName(main.value);
      // Teilfelder GIVN/SURN sind genauer als der Text in Schrägstrichen.
      const given = childValue(main, "GIVN") ?? parsed.givenNames;
      const surname = childValue(main, "SURN") ?? parsed.surname;
      if (given) person.givenNames = given;
      if (surname) person.surname = surname;
    }
    const notes: string[] = [];
    for (const extra of names.slice(1)) {
      if (extra.value.trim()) notes.push(`Weiterer Name: ${extra.value.replace(/\//g, "").replace(/\s+/g, " ").trim()}`);
    }
    for (const n of childrenOf(r, "NOTE")) {
      const t = this.noteText(n);
      if (t) notes.push(t);
    }
    if (notes.length) person.notes = notes;

    const birt = child(r, "BIRT");
    if (birt) person.birth = this.event(birt);
    const deat = child(r, "DEAT");
    if (deat) person.death = this.event(deat);
    person.externalRefs = gedcomRef(r.xref);

    this.persons.push(person);
    this.personByXref.set(r.xref, person);
  }

  // ---- Familien / Unions ----

  private addUnion(r: GedcomNode): void {
    if (!r.xref) return this.warn("fam-no-id", {}, "FAM ohne Kennung übersprungen.", r);
    if (this.unionByXref.has(r.xref)) return this.warn("fam-duplicate", { xref: r.xref }, `Doppelte Familien-Kennung @${r.xref}@, zweite ignoriert.`, r);

    const partnerIds: string[] = [];
    for (const tag of ["HUSB", "WIFE"]) {
      const n = child(r, tag);
      if (!n) continue;
      const ptr = pointer(n.value);
      const p = ptr ? this.personByXref.get(ptr) : undefined;
      if (p) partnerIds.push(p.id);
      else this.warn("fam-unknown-person", { tag, value: n.value, xref: r.xref }, `${tag} verweist auf unbekannte Person "${n.value}" in @${r.xref}@.`, n);
    }

    const children: ChildLink[] = [];
    for (const c of childrenOf(r, "CHIL")) {
      const ptr = pointer(c.value);
      const p = ptr ? this.personByXref.get(ptr) : undefined;
      if (!p) {
        this.warn("fam-unknown-child", { value: c.value, xref: r.xref }, `CHIL verweist auf unbekannte Person "${c.value}" in @${r.xref}@.`, c);
        continue;
      }
      if (children.some((x) => x.personId === p.id)) continue;
      children.push({ personId: p.id, kind: "biological" });
    }

    if (partnerIds.length === 0 && children.length === 0) {
      return this.warn("fam-empty", { xref: r.xref }, `Familie @${r.xref}@ ohne Partner und Kinder übersprungen.`, r);
    }

    const union: Union = {
      id: `u_${this.unions.length + 1}`,
      partnerIds,
      // Ohne zweiten Partner und ohne Heiratsereignis wissen wir nicht, was es war.
      kind: partnerIds.length === 2 || child(r, "MARR") ? "marriage" : "unknown",
      children,
    };
    const marr = child(r, "MARR");
    if (marr) {
      const ev = this.event(marr);
      if (Object.keys(ev).length) union.start = ev;
    }
    const div = child(r, "DIV");
    if (div) {
      union.end = this.event(div);
      union.endReason = "divorce";
    }
    union.externalRefs = gedcomRef(r.xref);

    this.unions.push(union);
    this.unionByXref.set(r.xref, union);
  }

  /** INDI.FAMC: Art der Kindschaft (PEDI) übernehmen; fehlende CHIL-Einträge in der FAM ergänzen. */
  private linkFamc(records: GedcomNode[]): void {
    for (const r of records) {
      if (r.tag !== "INDI" || !r.xref) continue;
      const person = this.personByXref.get(r.xref);
      if (!person) continue;
      for (const famc of childrenOf(r, "FAMC")) {
        const ptr = pointer(famc.value);
        const union = ptr ? this.unionByXref.get(ptr) : undefined;
        if (!union) continue;
        let link = union.children.find((c) => c.personId === person.id);
        if (!link) {
          link = { personId: person.id, kind: "biological" };
          union.children.push(link);
          this.warn("famc-missing-chil", { xref: r.xref ?? "", ptr: ptr ?? "" }, `@${r.xref}@ nennt Familie @${ptr}@ als Eltern, dort fehlt aber CHIL. Ergänzt.`, famc);
        }
        const pedi = childValue(famc, "PEDI")?.toLowerCase();
        const kind: ChildLinkKind | undefined =
          pedi === "adopted" ? "adopted" : pedi === "foster" ? "foster" : pedi === "birth" ? "biological" : undefined;
        if (kind) link.kind = kind;
        else if (pedi) link.kind = "unknown";
      }
    }
  }

  /**
   * Ehe-Reihenfolge je Person: nach Heiratsdatum, wenn alle Unions der Person eines haben,
   * sonst in Dateireihenfolge. `Union.order` ist der höchste Rang der Partner
   * (die dritte Ehe des Mannes ist die erste der Frau: order = 3).
   */
  private assignOrder(): void {
    const byPerson = new Map<string, Union[]>();
    for (const u of this.unions) {
      for (const pid of u.partnerIds) {
        const list = byPerson.get(pid) ?? [];
        list.push(u);
        byPerson.set(pid, list);
      }
    }
    const rank = new Map<string, Map<string, number>>(); // personId -> unionId -> Rang
    for (const [pid, list] of byPerson) {
      const sorted = list.every((u) => u.start?.date?.year !== undefined)
        ? [...list].sort((a, b) => compareFuzzyDate(a.start?.date, b.start?.date)) // stabil bei Gleichstand
        : list;
      rank.set(pid, new Map(sorted.map((u, i) => [u.id, i + 1])));
    }
    for (const u of this.unions) {
      if (u.partnerIds.length === 0) continue;
      u.order = Math.max(...u.partnerIds.map((pid) => rank.get(pid)?.get(u.id) ?? 1));
    }
  }
}

/** Importiert GEDCOM aus Text oder Bytes (Bytes: Zeichensatz wird erkannt). */
export function importGedcom(input: string | Uint8Array): ImportResult {
  let text: string;
  let charset: GedcomCharset | undefined;
  if (typeof input === "string") {
    text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  } else {
    const decoded = decodeGedcom(input);
    text = decoded.text;
    charset = decoded.charset;
  }

  const { records, warnings: parseWarnings } = parseGedcomText(text);
  const imp = new Importer();
  for (const w of parseWarnings) imp.warnings.push({ message: w.message, line: w.line, code: w.code, params: w.params });
  if (!records.some((r) => r.tag === "HEAD") && records.length > 0) {
    imp.warn("head-missing", {}, "Kopfzeile (HEAD) fehlt, ist das wirklich eine GEDCOM-Datei?");
  }
  imp.run(records);

  const data: TreeData = { version: 1, persons: imp.persons, unions: imp.unions, sources: imp.sources };
  const result: ImportResult = { data, warnings: imp.warnings };
  if (charset) result.charset = charset;
  return result;
}
