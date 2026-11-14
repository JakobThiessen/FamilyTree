/**
 * TreeData -> GEDCOM 5.5.1 (UTF-8). Gegenstück zu `gedcomImport.ts`.
 *
 * Nicht ins GEDCOM übertragen (kein Gegenstück im Format): `status` (belegt/vermutet), Union-Ende
 * außer Scheidung, Orts-Koordinaten werden als MAP geschrieben. Eigene IDs (p_1 ...) gehen verloren,
 * dafür bleiben GEDCOM-Kennungen aus `externalRefs` erhalten.
 */

import type { ChildLink, Citation, ExternalRef, LifeEvent, Person, Source, TreeData, Union } from "../core/types";
import { formatGedcomDate } from "./gedcomDate";
import { GEDCOM_SYSTEM } from "./gedcomImport";

const MAX_LINE = 200; // GEDCOM erlaubt 255 Zeichen je Zeile; wir brechen früher mit CONC um.

/** Schreibt eine Zeile; Zeilenumbrüche im Wert werden zu CONT, lange Werte zu CONC. */
function pushValue(out: string[], level: number, tag: string, value: string, xref?: string): void {
  const prefix = xref ? `${level} @${xref}@ ${tag}` : `${level} ${tag}`;
  const parts = value.split(/\r\n|\n|\r/);
  parts.forEach((part, i) => {
    let rest = part;
    let first = true;
    do {
      let chunk = rest.slice(0, MAX_LINE);
      // Nicht mitten in einem Surrogatpaar (z. B. Emoji) trennen.
      const last = chunk.charCodeAt(chunk.length - 1);
      if (rest.length > chunk.length && last >= 0xd800 && last <= 0xdbff) chunk = chunk.slice(0, -1);
      rest = rest.slice(chunk.length);
      let head: string;
      if (i === 0 && first) head = prefix;
      else if (first) head = `${level + 1} CONT`;
      else head = `${level + 1} CONC`;
      out.push(chunk === "" ? head : `${head} ${chunk}`);
      first = false;
    } while (rest.length > 0);
  });
}

class Exporter {
  private out: string[] = [];
  private personX = new Map<string, string>();
  private unionX = new Map<string, string>();
  private sourceX = new Map<string, string>();

  constructor(private data: TreeData) {}

  /** Kennung aus externalRefs übernehmen (wenn gültig und frei), sonst Präfix + Zähler. */
  private assignIds<T extends { id: string; externalRefs?: ExternalRef[] }>(
    items: T[],
    prefix: string,
    target: Map<string, string>,
    used: Set<string>,
  ): void {
    for (const it of items) {
      const ref = it.externalRefs?.find((r) => r.system === GEDCOM_SYSTEM)?.id;
      if (ref && /^[A-Za-z0-9_]+$/.test(ref) && !used.has(ref)) {
        target.set(it.id, ref);
        used.add(ref);
      }
    }
    let n = 1;
    for (const it of items) {
      if (target.has(it.id)) continue;
      while (used.has(`${prefix}${n}`)) n++;
      target.set(it.id, `${prefix}${n}`);
      used.add(`${prefix}${n}`);
    }
  }

  private citations(level: number, cits: Citation[] | undefined): void {
    for (const c of cits ?? []) {
      const x = this.sourceX.get(c.sourceId);
      if (!x) continue;
      this.out.push(`${level} SOUR @${x}@`);
      if (c.detail) pushValue(this.out, level + 1, "PAGE", c.detail);
    }
  }

  /** Ereignis mit Datum/Ort/Quellen. Ist nichts bekannt, wird "Y" geschrieben (Ereignis fand statt). */
  private event(tag: string, ev: LifeEvent): void {
    const hasData = ev.date !== undefined || ev.place !== undefined || (ev.citations?.length ?? 0) > 0;
    this.out.push(hasData ? `1 ${tag}` : `1 ${tag} Y`);
    if (ev.date) pushValue(this.out, 2, "DATE", formatGedcomDate(ev.date));
    if (ev.place) {
      pushValue(this.out, 2, "PLAC", ev.place.name);
      if (ev.place.lat !== undefined && ev.place.lon !== undefined) {
        this.out.push("3 MAP");
        this.out.push(`4 LATI ${ev.place.lat < 0 ? "S" : "N"}${Math.abs(ev.place.lat)}`);
        this.out.push(`4 LONG ${ev.place.lon < 0 ? "W" : "E"}${Math.abs(ev.place.lon)}`);
      }
    }
    this.citations(2, ev.citations);
  }

  private person(p: Person, famc: Union[], fams: Union[]): void {
    this.out.push(`0 @${this.personX.get(p.id)}@ INDI`);
    if (p.givenNames || p.surname) {
      this.out.push(`1 NAME ${p.givenNames ? p.givenNames + " " : ""}/${p.surname ?? ""}/`);
      if (p.givenNames) this.out.push(`2 GIVN ${p.givenNames}`);
      if (p.surname) this.out.push(`2 SURN ${p.surname}`);
    }
    this.out.push(`1 SEX ${p.sex === "U" ? "U" : p.sex}`);
    if (p.birth) this.event("BIRT", p.birth);
    if (p.death) this.event("DEAT", p.death);
    for (const note of p.notes ?? []) pushValue(this.out, 1, "NOTE", note);
    for (const u of famc) {
      this.out.push(`1 FAMC @${this.unionX.get(u.id)}@`);
      const kind = u.children.find((c) => c.personId === p.id)?.kind;
      const pedi = kind === "adopted" ? "adopted" : kind === "foster" ? "foster" : undefined;
      if (pedi) this.out.push(`2 PEDI ${pedi}`);
    }
    for (const u of fams) this.out.push(`1 FAMS @${this.unionX.get(u.id)}@`);
  }

  private union(u: Union, sex: Map<string, Person["sex"]>): void {
    this.out.push(`0 @${this.unionX.get(u.id)}@ FAM`);
    let [a, b] = u.partnerIds;
    // GEDCOM 5.5.1 kennt nur HUSB/WIFE: nach Geschlecht zuordnen, sonst in Reihenfolge.
    if (a && b && sex.get(a) === "F" && sex.get(b) === "M") [a, b] = [b, a];
    const only = u.partnerIds.length === 1 ? a : undefined;
    if (only) {
      this.out.push(`1 ${sex.get(only) === "F" ? "WIFE" : "HUSB"} @${this.personX.get(only)}@`);
    } else {
      if (a) this.out.push(`1 HUSB @${this.personX.get(a)}@`);
      if (b) this.out.push(`1 WIFE @${this.personX.get(b)}@`);
    }
    for (const c of u.children) {
      const x = this.personX.get(c.personId);
      if (x) this.out.push(`1 CHIL @${x}@`);
    }
    if (u.start) this.event("MARR", u.start);
    if (u.endReason === "divorce") this.event("DIV", u.end ?? {});
  }

  private source(s: Source): void {
    this.out.push(`0 @${this.sourceX.get(s.id)}@ SOUR`);
    pushValue(this.out, 1, "TITL", s.title);
    if (s.url) pushValue(this.out, 1, "WWW", s.url);
    if (s.note) pushValue(this.out, 1, "NOTE", s.note);
  }

  run(): string {
    const { persons, unions, sources } = this.data;
    this.assignIds(persons, "I", this.personX, new Set());
    this.assignIds(unions, "F", this.unionX, new Set());
    this.assignIds(sources, "S", this.sourceX, new Set());

    this.out.push("0 HEAD", "1 SOUR FamilyTree", "2 NAME FamilyTree", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8");

    const sex = new Map(persons.map((p) => [p.id, p.sex]));
    const famcOf = new Map<string, Union[]>();
    const famsOf = new Map<string, Union[]>();
    const add = (m: Map<string, Union[]>, key: string, u: Union) => m.set(key, [...(m.get(key) ?? []), u]);
    for (const u of unions) {
      u.partnerIds.forEach((pid) => add(famsOf, pid, u));
      u.children.forEach((c: ChildLink) => add(famcOf, c.personId, u));
    }
    // Eigene Ehe-Reihenfolge je Person beibehalten (FAMS in `order`).
    for (const list of famsOf.values()) list.sort((x, y) => (x.order ?? 0) - (y.order ?? 0));

    for (const p of persons) this.person(p, famcOf.get(p.id) ?? [], famsOf.get(p.id) ?? []);
    for (const u of unions) this.union(u, sex);
    for (const s of sources) this.source(s);
    this.out.push("0 TRLR");
    return this.out.join("\n") + "\n";
  }
}

/** Erzeugt GEDCOM-Text (UTF-8, Zeilenumbruch LF). */
export function exportGedcom(data: TreeData): string {
  return new Exporter(data).run();
}
