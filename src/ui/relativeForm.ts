/**
 * Formular „Verwandten hinzufügen“ (M10 Schritt 5, D41): reines TypeScript ohne Svelte, in Node testbar.
 *
 * Das Formular hält Texte (`RelativeForm`). `unionChoices` liefert die Auswahl der Union (bzw. des Partners),
 * `buildRelative` prüft die Eingaben und baut daraus die Operation (über `planRelative` im Kern, ein Undo-Schritt).
 * `consequenceNotes` rechnet das Löschen einer Person vorab durch (ohne zu speichern) für den Folgenhinweis.
 */
import { applyEdit, defaultUnion, parentUnionsOf, parseFuzzyDate, planRelative, unionsOfPartner } from "../core";
import type { MessageRef, Person, PersonId, RelativeKind, RelativePlan, Sex, TreeData, Union } from "../core";
import { displayName } from "../render/style";
import type { MessageKey, Vars } from "./i18n";

export interface RelativeForm {
  /** neue Person anlegen oder vorhandene verknüpfen */
  mode: "new" | "existing";
  givenNames: string;
  surname: string;
  sex: Sex;
  /** Geburtsdatum als Text (optional, `parseFuzzyDate`) */
  birth: string;
  existingId: PersonId;
  /** gewählte Union (`"new"` = neue) */
  unionId: string;
}

export interface UnionChoice {
  value: string;
  key: MessageKey;
  vars?: Vars;
}

export interface FormError {
  key: MessageKey;
  vars?: Vars;
}
export type RelativeErrors = Record<string, FormError>;

export function emptyRelativeForm(data: TreeData, kind: RelativeKind, focusId: PersonId): RelativeForm {
  return { mode: "new", givenNames: "", surname: "", sex: "U", birth: "", existingId: "", unionId: defaultUnion(data, kind, focusId) };
}

const names = (data: TreeData, ids: PersonId[], unknown: string): string => {
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const out = ids.map((id) => displayName(byId.get(id)));
  return out.length ? out.join(" & ") : unknown;
};

/**
 * Auswahl der Union je Art des Verwandten. Die Beschriftungen nennen den Partner bzw. die Eltern,
 * damit niemand Union-Kennungen lesen muss. Eine Auswahl mit nur einem Eintrag braucht die Oberfläche nicht zu zeigen.
 */
export function unionChoices(data: TreeData, kind: RelativeKind, focusId: PersonId, unknownLabel: string): UnionChoice[] {
  const label = (u: Union, others: PersonId[]) => ({ who: names(data, others, unknownLabel), n: u.children.length });
  const out: UnionChoice[] = [];
  if (kind === "parent") {
    for (const u of parentUnionsOf(data, focusId))
      if (u.partnerIds.length < 2) out.push({ value: u.id, key: "rel.union.parents", vars: label(u, u.partnerIds) });
    if (!out.length && !parentUnionsOf(data, focusId).length) out.push({ value: "new", key: "rel.union.newParents" });
    return out;
  }
  if (kind === "sibling") {
    for (const u of parentUnionsOf(data, focusId)) out.push({ value: u.id, key: "rel.union.parents", vars: label(u, u.partnerIds) });
    if (!out.length) out.push({ value: "new", key: "rel.union.noParents" });
    return out;
  }
  const mine = unionsOfPartner(data, focusId);
  for (const u of mine) {
    const others = u.partnerIds.filter((p) => p !== focusId);
    if (kind === "partner" && u.partnerIds.length >= 2) continue;
    out.push({ value: u.id, key: kind === "partner" ? "rel.union.addPartner" : "rel.union.with", vars: label(u, others) });
  }
  out.push({ value: "new", key: kind === "partner" ? "rel.union.newPartnership" : "rel.union.withoutPartner" });
  return out;
}

export type BuildRelative = { ok: true; plan: Extract<RelativePlan, { ok: true }> } | { ok: false; errors: RelativeErrors } | { ok: false; reject: MessageRef };

/** Prüft das Formular und plant die Änderung. Fehler je Feld oder die Ablehnung des Kerns. */
export function buildRelative(data: TreeData, kind: RelativeKind, focusId: PersonId, f: RelativeForm): BuildRelative {
  const errors: RelativeErrors = {};
  let target: Parameters<typeof planRelative>[1]["target"] | undefined;
  if (f.mode === "existing") {
    if (!f.existingId || !data.persons.some((p) => p.id === f.existingId)) errors.existing = { key: "rel.err.existing" };
    else target = { existingId: f.existingId };
  } else {
    const given = f.givenNames.trim();
    const surname = f.surname.trim();
    if (!given && !surname) errors.givenNames = { key: "rel.err.name" };
    const person: Omit<Person, "id"> = { sex: f.sex };
    if (given) person.givenNames = given;
    if (surname) person.surname = surname;
    const text = f.birth.trim();
    if (text) {
      const d = parseFuzzyDate(text);
      if (d) person.birth = { date: d };
      else errors.birth = { key: "edit.err.date" };
    }
    target = { person };
  }
  if (Object.keys(errors).length || !target) return { ok: false, errors };
  const plan = planRelative(data, { kind, focusId, target, unionId: f.unionId });
  return plan.ok ? { ok: true, plan } : { ok: false, reject: plan.reject };
}

/**
 * Folgen des Löschens vorab: rechnet `deletePerson` auf dem Baum durch (ohne zu speichern) und gibt die Hinweise des Kerns zurück.
 * Zusätzlich: Kinder, die danach in keiner Union mehr einen Elternteil haben.
 */
export function deleteConsequences(data: TreeData, id: PersonId): { notes: MessageRef[]; orphans: number } | undefined {
  const r = applyEdit(data, { type: "deletePerson", id });
  if (!r.ok) return undefined;
  const orphans = data.unions.filter((u) => u.partnerIds.includes(id) && u.partnerIds.length === 1).reduce((n, u) => n + u.children.filter((c) => c.personId !== id).length, 0);
  return { notes: r.notes, orphans };
}
