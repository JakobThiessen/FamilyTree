<script lang="ts">
  // Detailfenster der Fokusperson: Ereignisse mit Quellen, Notizen, Status, Familie (anklickbar).
  // Umschalter „Bearbeiten“: Formular für die Person (M10, Schritt 4, D40); Speichern = eine Operation über `onEdit`.
  import { tick } from "svelte";
  import type { EditOp, Person, PersonId, PersonSearchIndex, RelativeKind, SessionResult, Source, Status, TreeData } from "../core";
  import { displayName, lifeSpan } from "../render/style";
  import { STATUS_KEY } from "./personInfo";
  import { buildEdit, emptyCitation, formChanged, NEW_SOURCE, personToForm } from "./personForm";
  import type { EventForm, FormErrors, PersonForm } from "./personForm";
  import { i18n, t } from "./lang.svelte";
  import { editText } from "./messages";
  import { buildRelative, deleteConsequences, emptyRelativeForm, unionChoices } from "./relativeForm";
  import type { RelativeErrors, RelativeForm } from "./relativeForm";
  import type { PersonInfo, RelativeRef } from "./personInfo";
  import MediaGallery from "./MediaGallery.svelte";
  import type { MediaLookup } from "./mediaHub";

  let {
    info,
    data,
    index,
    rev,
    persons,
    sources,
    media,
    onPick,
    onEdit,
  }: {
    info: PersonInfo | null;
    data: TreeData;
    /** Suchindex für „vorhandene Person verknüpfen“; `rev` zählt seine Änderungen */
    index: PersonSearchIndex;
    rev: number;
    persons: ReadonlyMap<PersonId, Person>;
    sources: readonly Source[];
    /** Vorschaubilder des Baums (D45); `null` = keine geladen */
    media: MediaLookup | null;
    onPick: (id: PersonId) => void;
    onEdit: (op: EditOp) => Promise<SessionResult>;
  } = $props();

  const uid = $props.id();
  const STATUSES: Status[] = ["proven", "assumed", "unknown"];

  // Formularzustand. `editId` ist die Person, die das Formular bearbeitet (kann nach einem Fokuswechsel von `info` abweichen).
  let editing = $state(false);
  let editId = $state<PersonId>("");
  let form = $state<PersonForm | null>(null);
  let initial = $state<PersonForm | null>(null);
  let errors = $state<FormErrors>({});
  let rejected = $state("");
  let busy = $state(false);
  let editButton: HTMLButtonElement | undefined = $state();

  const dirty = $derived(!!form && !!initial && formChanged(form, initial));
  /** Fokus ist weitergewandert, das Formular hat aber ungespeicherte Eingaben: Hinweis statt stilles Verwerfen. */
  const pending = $derived(editing && !!info && info.id !== editId && dirty);
  const editName = $derived(displayName(persons.get(editId)));

  // Wechselt die Fokusperson, ohne dass etwas eingegeben wurde, geht es zurück zur Anzeige.
  $effect(() => {
    if (editing && info?.id !== editId && !dirty) editing = false;
  });
  // Verschwindet die bearbeitete Person (z. B. Undo einer Neuanlage), endet das Bearbeiten.
  $effect(() => {
    if (editing && !persons.has(editId)) editing = false;
  });

  async function startEdit() {
    const p = info ? persons.get(info.id) : undefined;
    if (!p) return;
    editId = p.id;
    form = personToForm(p);
    initial = personToForm(p);
    errors = {};
    rejected = "";
    editing = true;
    await tick();
    document.getElementById(`${uid}-givenNames`)?.focus();
  }

  async function stopEdit() {
    editing = false;
    form = initial = null;
    errors = {};
    rejected = "";
    await tick();
    editButton?.focus();
  }

  /** Prüfen und speichern. Bei Fehlern bleibt alles stehen und das erste fehlerhafte Feld bekommt den Fokus. */
  async function save(): Promise<boolean> {
    const base = persons.get(editId);
    if (!form || !base || busy) return false;
    const built = buildEdit(base, form, sources);
    if (!built.ok) {
      errors = built.errors;
      rejected = "";
      await tick();
      const first = Object.keys(built.errors)[0];
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return false;
    }
    errors = {};
    busy = true;
    try {
      const res = await onEdit(built.op);
      if (!res.ok) {
        rejected = editText(res.reject, i18n.lang);
        return false;
      }
    } finally {
      busy = false;
    }
    await stopEdit();
    return true;
  }

  // ---- Verwandte hinzufügen und Person löschen (Schritt 5/6, D41) ----
  const KINDS: RelativeKind[] = ["parent", "partner", "child", "sibling"];
  let adding = $state<RelativeKind | null>(null);
  /** Person, für die `adding`/`deleting` gilt; wechselt der Fokus, endet beides */
  let relFor = $state<PersonId>("");
  let rf = $state<RelativeForm | null>(null);
  let rerrors = $state<RelativeErrors>({});
  let rrejected = $state("");
  let rquery = $state("");
  let deleting = $state(false);
  let flashText = $state("");
  /** Stand des Baums beim Setzen der Meldung: nach einer weiteren Änderung (z. B. Rückgängig) ist sie veraltet */
  let flashAt = $state.raw<TreeData | null>(null);
  const flash = $derived(flashAt === data ? flashText : "");
  function setFlash(text: string) {
    flashText = text;
    flashAt = data;
  }

  $effect(() => {
    if ((adding || deleting) && info?.id !== relFor) {
      adding = null;
      deleting = false;
    }
  });

  /** Meldungen des Kerns nennen Kennungen (p_1); hier stehen stattdessen die Namen. */
  const named = (ref: { code: string; params?: Record<string, string | number> }) => {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(ref.params ?? {})) {
      const p = typeof v === "string" ? persons.get(v) : undefined;
      params[k] = p ? displayName(p) : v;
    }
    return editText({ code: ref.code, params }, i18n.lang);
  };

  const focusName = $derived(info ? info.name : "");
  const choices = $derived(adding && info ? unionChoices(data, adding, info.id, t("person.partnerUnknown")) : []);
  const hits = $derived(
    adding && rf?.mode === "existing" && rquery.trim()
      ? (void rev, index.search(rquery, 10).filter((h) => h.id !== relFor && persons.has(h.id)))
      : [],
  );
  const consequences = $derived(deleting && info ? deleteConsequences(data, info.id) : undefined);

  async function startAdd(kind: RelativeKind) {
    if (!info) return;
    relFor = info.id;
    adding = kind;
    rf = emptyRelativeForm(data, kind, info.id);
    rerrors = {};
    rrejected = "";
    rquery = "";
    flashText = "";
    await tick();
    document.getElementById(`${uid}-rel-given`)?.focus();
  }

  async function stopAdd() {
    const kind = adding;
    adding = null;
    rf = null;
    await tick();
    if (kind) document.getElementById(`${uid}-add-${kind}`)?.focus();
  }

  async function submitAdd() {
    if (!adding || !rf || !info || busy) return;
    const kind = adding;
    const built = buildRelative(data, kind, relFor, rf);
    if ("errors" in built) {
      rerrors = built.errors;
      rrejected = "";
      await tick();
      const first = Object.keys(built.errors)[0];
      document.getElementById(`${uid}-rel-${first === "givenNames" ? "given" : first}`)?.focus();
      return;
    }
    if ("reject" in built) {
      rerrors = {};
      rrejected = named(built.reject);
      return;
    }
    rerrors = {};
    busy = true;
    let res: SessionResult;
    try {
      res = await onEdit(built.plan.op);
    } finally {
      busy = false;
    }
    if (!res.ok) {
      rrejected = named(res.reject);
      return;
    }
    const added = persons.get(built.plan.personId);
    setFlash([
      t("rel.added", { name: displayName(added) }),
      ...built.plan.notes.map((n) => named(n)),
    ].join(" "));
    await stopAdd();
  }

  async function startDelete() {
    if (!info) return;
    relFor = info.id;
    deleting = true;
    rrejected = "";
    flashText = "";
    await tick();
    document.getElementById(`${uid}-del-cancel`)?.focus();
  }

  async function confirmDelete() {
    if (!info || busy) return;
    const name = info.name;
    busy = true;
    let res: SessionResult;
    try {
      res = await onEdit({ type: "deletePerson", id: info.id });
    } finally {
      busy = false;
    }
    if (!res.ok) {
      rrejected = named(res.reject);
      return;
    }
    deleting = false;
    setFlash(t("rel.deleted", { name }) + " " + t("rel.delete.undo"));
  }

  async function cancelDelete() {
    deleting = false;
    await tick();
    document.getElementById(`${uid}-delete`)?.focus();
  }

  const addCitation = (ev: EventForm) => ev.citations.push(emptyCitation());
  const removeCitation = (ev: EventForm, i: number) => ev.citations.splice(i, 1);
</script>

{#snippet rel(r: RelativeRef)}
  <button class="link" onclick={() => onPick(r.id)}>{r.name}</button>
  {#if r.span}<small>{r.span}</small>{/if}
  {#if r.note}<small class="tag">{r.note}</small>{/if}
{/snippet}

{#snippet badge(s: keyof typeof STATUS_KEY)}
  <span class="badge {s}">{t(STATUS_KEY[s])}</span>
{/snippet}

<!-- Fehlertext eines Feldes; das Feld verweist per aria-describedby darauf -->
{#snippet err(name: string)}
  {#if errors[name]}<p class="err" id="{uid}-{name}-err">{t(errors[name].key, errors[name].vars)}</p>{/if}
{/snippet}

{#snippet statusSelect(id: string, label: string, value: Status, set: (s: Status) => void)}
  <label for={id}>{label}</label>
  <select {id} {value} onchange={(e) => set(e.currentTarget.value as Status)}>
    {#each STATUSES as s (s)}<option value={s}>{t(STATUS_KEY[s])}</option>{/each}
  </select>
{/snippet}

{#snippet eventFields(key: "birth" | "death", title: string, ev: EventForm)}
  <fieldset>
    <legend>{title}</legend>

    <label for="{uid}-{key}.date">{t("edit.form.date")}</label>
    <input
      id="{uid}-{key}.date"
      bind:value={ev.date}
      autocomplete="off"
      aria-invalid={errors[`${key}.date`] ? "true" : undefined}
      aria-describedby="{uid}-{key}.date-hint{errors[`${key}.date`] ? ` ${uid}-${key}.date-err` : ''}"
    />
    <small class="hint" id="{uid}-{key}.date-hint">{t("edit.form.dateHint")}</small>
    {@render err(`${key}.date`)}

    <label for="{uid}-{key}.place">{t("edit.form.place")}</label>
    <input
      id="{uid}-{key}.place"
      bind:value={ev.place}
      autocomplete="off"
      aria-invalid={errors[`${key}.place`] ? "true" : undefined}
      aria-describedby={errors[`${key}.place`] ? `${uid}-${key}.place-err` : undefined}
    />
    {@render err(`${key}.place`)}

    <div class="pair">
      <div>
        <label for="{uid}-{key}.lat">{t("edit.form.lat")}</label>
        <input
          id="{uid}-{key}.lat"
          bind:value={ev.lat}
          inputmode="decimal"
          autocomplete="off"
          aria-invalid={errors[`${key}.lat`] ? "true" : undefined}
          aria-describedby="{uid}-{key}.coord-hint{errors[`${key}.lat`] ? ` ${uid}-${key}.lat-err` : ''}"
        />
        {@render err(`${key}.lat`)}
      </div>
      <div>
        <label for="{uid}-{key}.lon">{t("edit.form.lon")}</label>
        <input
          id="{uid}-{key}.lon"
          bind:value={ev.lon}
          inputmode="decimal"
          autocomplete="off"
          aria-invalid={errors[`${key}.lon`] ? "true" : undefined}
          aria-describedby="{uid}-{key}.coord-hint{errors[`${key}.lon`] ? ` ${uid}-${key}.lon-err` : ''}"
        />
        {@render err(`${key}.lon`)}
      </div>
    </div>
    <small class="hint" id="{uid}-{key}.coord-hint">{t("edit.form.coordHint")}</small>

    {@render statusSelect(`${uid}-${key}.status`, t("edit.form.eventStatus"), ev.status, (s) => (ev.status = s))}

    <div class="cites" role="group" aria-label={t("edit.form.sources")}>
      {#each ev.citations as c, i (i)}
        {@const cid = `${key}.cite.${i}`}
        <div class="cite">
          <label for="{uid}-{cid}">{t("edit.form.source")}</label>
          <select
            id="{uid}-{cid}"
            bind:value={c.sourceId}
            aria-invalid={errors[cid] ? "true" : undefined}
            aria-describedby={errors[cid] ? `${uid}-${cid}-err` : undefined}
          >
            <option value="">{t("edit.form.sourcePick")}</option>
            {#each sources as s (s.id)}<option value={s.id}>{s.title}</option>{/each}
            <option value={NEW_SOURCE}>{t("edit.form.sourceNew")}</option>
          </select>
          {#if c.sourceId === NEW_SOURCE}
            <label for="{uid}-{cid}.title">{t("edit.form.newTitle")}</label>
            <input id="{uid}-{cid}.title" bind:value={c.newTitle} autocomplete="off" />
            <label for="{uid}-{cid}.url">{t("edit.form.newUrl")}</label>
            <input id="{uid}-{cid}.url" bind:value={c.newUrl} type="url" autocomplete="off" />
          {/if}
          <label for="{uid}-{cid}.detail">{t("edit.form.detail")}</label>
          <input id="{uid}-{cid}.detail" bind:value={c.detail} autocomplete="off" />
          {@render err(cid)}
          <button type="button" class="link" onclick={() => removeCitation(ev, i)}>{t("edit.form.removeSource")}</button>
        </div>
      {/each}
      <button type="button" onclick={() => addCitation(ev)}>{t("edit.form.addSource")}</button>
    </div>
  </fieldset>
{/snippet}

{#if !info}
  <p class="dim">{t("person.none")}</p>
{:else}
  {#if pending}
    <div class="pending" role="alert">
      <p>{t("edit.form.pending", { name: editName })}</p>
      <button type="button" onclick={save} disabled={busy}>{t("edit.form.pending.save")}</button>
      <button type="button" onclick={stopEdit}>{t("edit.form.pending.discard")}</button>
    </div>
  {/if}

  {#if flash}
    <p class="flash" role="status">{flash} <button type="button" class="link" onclick={() => (flashText = "")}>{t("app.close")}</button></p>
  {/if}

  {#if adding && rf}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void submitAdd();
      }}
      novalidate
    >
      <h2>{t(`rel.title.${adding}`, { name: focusName })}</h2>
      {#if Object.keys(rerrors).length}<p class="err" role="alert">{t("edit.form.invalid")}</p>{/if}
      {#if rrejected}<p class="err" role="alert">{rrejected}</p>{/if}

      <fieldset>
        <legend>{t("rel.mode")}</legend>
        <label class="radio"><input type="radio" name="{uid}-mode" value="new" bind:group={rf.mode} />{t("rel.mode.new")}</label>
        <label class="radio"><input type="radio" name="{uid}-mode" value="existing" bind:group={rf.mode} />{t("rel.mode.existing")}</label>
      </fieldset>

      {#if rf.mode === "new"}
        <label for="{uid}-rel-given">{t("edit.form.givenNames")}</label>
        <input id="{uid}-rel-given" bind:value={rf.givenNames} autocomplete="off" aria-invalid={rerrors.givenNames ? "true" : undefined} aria-describedby={rerrors.givenNames ? `${uid}-rel-given-err` : undefined} />
        {#if rerrors.givenNames}<p class="err" id="{uid}-rel-given-err">{t(rerrors.givenNames.key, rerrors.givenNames.vars)}</p>{/if}
        <label for="{uid}-rel-surname">{t("edit.form.surname")}</label>
        <input id="{uid}-rel-surname" bind:value={rf.surname} autocomplete="off" />
        <label for="{uid}-rel-sex">{t("edit.form.sex")}</label>
        <select id="{uid}-rel-sex" bind:value={rf.sex}>
          <option value="M">{t("person.sex.M")}</option>
          <option value="F">{t("person.sex.F")}</option>
          <option value="U">{t("person.sex.U")}</option>
        </select>
        <label for="{uid}-rel-birth">{t("person.event.birth")} – {t("edit.form.date")}</label>
        <input id="{uid}-rel-birth" bind:value={rf.birth} autocomplete="off" aria-invalid={rerrors.birth ? "true" : undefined} aria-describedby={`${uid}-rel-birth-hint${rerrors.birth ? ` ${uid}-rel-birth-err` : ""}`} />
        <small class="hint" id="{uid}-rel-birth-hint">{t("edit.form.dateHint")}</small>
        {#if rerrors.birth}<p class="err" id="{uid}-rel-birth-err">{t(rerrors.birth.key, rerrors.birth.vars)}</p>{/if}
      {:else}
        <label for="{uid}-rel-query">{t("rel.existing.search")}</label>
        <input id="{uid}-rel-query" bind:value={rquery} type="search" autocomplete="off" aria-describedby="{uid}-rel-query-hint" />
        <small class="hint" id="{uid}-rel-query-hint">{t("rel.existing.hint")}</small>
        <label for="{uid}-rel-existing">{t("rel.mode.existing")}</label>
        <select id="{uid}-rel-existing" bind:value={rf.existingId} aria-invalid={rerrors.existing ? "true" : undefined} aria-describedby={rerrors.existing ? `${uid}-rel-existing-err` : undefined}>
          <option value="">{hits.length || !rquery.trim() ? t("rel.existing.pick") : t("rel.existing.none")}</option>
          {#each hits as h (h.id)}
            {@const p = persons.get(h.id)}
            <option value={h.id}>{displayName(p)}{lifeSpan(p) ? ` (${lifeSpan(p)})` : ""}</option>
          {/each}
        </select>
        {#if rerrors.existing}<p class="err" id="{uid}-rel-existing-err">{t(rerrors.existing.key, rerrors.existing.vars)}</p>{/if}
      {/if}

      {#if choices.length > 1}
        <label for="{uid}-rel-union">{t("rel.union")}</label>
        <select id="{uid}-rel-union" bind:value={rf.unionId}>
          {#each choices as c (c.value)}<option value={c.value}>{t(c.key, c.vars)}</option>{/each}
        </select>
      {:else if adding === "sibling" && choices[0]?.value === "new"}
        <p class="hint">{t("rel.union.noParents")}</p>
      {/if}

      <div class="buttons">
        <button type="submit" class="primary" disabled={busy}>{t("rel.add")}</button>
        <button type="button" onclick={stopAdd}>{t("rel.cancel")}</button>
      </div>
    </form>
  {:else if editing && form}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      novalidate
    >
      <h2>{t("edit.form.title")}: {editName}</h2>
      {#if Object.keys(errors).length}<p class="err" role="alert">{t("edit.form.invalid")}</p>{/if}
      {#if rejected}<p class="err" role="alert">{rejected}</p>{/if}

      <label for="{uid}-givenNames">{t("edit.form.givenNames")}</label>
      <input id="{uid}-givenNames" bind:value={form.givenNames} autocomplete="off" />
      <label for="{uid}-surname">{t("edit.form.surname")}</label>
      <input id="{uid}-surname" bind:value={form.surname} autocomplete="off" />

      <label for="{uid}-sex">{t("edit.form.sex")}</label>
      <select id="{uid}-sex" bind:value={form.sex}>
        <option value="M">{t("person.sex.M")}</option>
        <option value="F">{t("person.sex.F")}</option>
        <option value="U">{t("person.sex.U")}</option>
      </select>

      {@render statusSelect(`${uid}-status`, t("edit.form.status"), form.status, (s) => (form!.status = s))}

      {@render eventFields("birth", t("person.event.birth"), form.birth)}
      {@render eventFields("death", t("person.event.death"), form.death)}

      <label for="{uid}-notes">{t("edit.form.notes")}</label>
      <textarea id="{uid}-notes" rows="5" bind:value={form.notes} aria-describedby="{uid}-notes-hint"></textarea>
      <small class="hint" id="{uid}-notes-hint">{t("edit.form.notesHint")}</small>

      <div class="buttons">
        <button type="submit" class="primary" disabled={busy}>{t("edit.form.save")}</button>
        <button type="button" onclick={stopEdit}>{t("edit.form.cancel")}</button>
      </div>
    </form>
  {:else}
  <article>
    <div class="head">
      <h2>{info.name}</h2>
      <button type="button" bind:this={editButton} onclick={startEdit} disabled={!persons.has(info.id)}>{t("edit.form.edit")}</button>
    </div>
    <p class="dim">{info.sex}{#if info.span}{" · " + info.span}{/if}{" "}{@render badge(info.status)}</p>

    {#each info.events as ev (ev.label)}
      <section>
        <h3>{ev.label} {@render badge(ev.status)}</h3>
        <p>{ev.date}{#if ev.place}, {ev.place}{/if}</p>
        {#if ev.citations.length}
          <ul class="plain">
            {#each ev.citations as c}
              <li>
                {t("person.source")}
                {#if c.url}<a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a>{:else}{c.title}{/if}
                {#if c.detail}<small>({c.detail})</small>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}

    {#if persons.get(info.id)?.media?.length}
      <MediaGallery refs={persons.get(info.id)?.media ?? []} name={info.name} lookup={media} />
    {/if}

    {#if info.notes.length}
      <section>
        <h3>{t("person.notes")}</h3>
        {#each info.notes as n}<p class="note">{n}</p>{/each}
      </section>
    {/if}

    {#if info.parentFamilies.length}
      <section>
        <h3>{t("person.parents")}</h3>
        {#each info.parentFamilies as f}
          <p>
            {#each f.parents as r, i}{#if i}<span class="dim amp">&amp;</span>{/if}{@render rel(r)}{:else}<span class="dim">{t("person.parentsUnknown")}</span>{/each}
            {#if f.note}<small class="tag">{f.note}</small>{/if}
          </p>
        {/each}
      </section>
    {/if}

    {#each info.unions as u (u.id)}
      <section>
        <h3>{u.title} {@render badge(u.status)}</h3>
        <p>
          {#if u.partner}{@render rel(u.partner)}{:else}<span class="dim">{t("person.partnerUnknown")}</span>{/if}
          {#if u.period}<small>{u.period}</small>{/if}
        </p>
        {#if u.children.length}
          <ul class="plain">
            {#each u.children as c}<li>{t("person.child")}{@render rel(c)}</li>{/each}
          </ul>
        {/if}
      </section>
    {/each}

    {#if info.siblings.full.length || info.siblings.half.length}
      <section>
        <h3>{t("person.siblings")}</h3>
        <ul class="plain">
          {#each info.siblings.full as r}<li>{@render rel(r)}</li>{/each}
          {#each info.siblings.half as r}<li>{@render rel(r)} <small class="tag">{t("person.halfSibling")}</small></li>{/each}
        </ul>
      </section>
    {/if}

    {#if info.externalRefs.length}
      <section>
        <h3>{t("person.ids")}</h3>
        <p class="dim">{info.externalRefs.join(" · ")}</p>
      </section>
    {/if}

    <section class="actions">
      <h3 id="{uid}-rel-h">{t("rel.heading")}</h3>
      <div class="buttons-row" role="group" aria-labelledby="{uid}-rel-h">
        {#each KINDS as k (k)}
          <button type="button" id="{uid}-add-{k}" onclick={() => startAdd(k)} disabled={!persons.has(info.id)}>{t(`rel.add.${k}`)}</button>
        {/each}
      </div>
      {#if rrejected && deleting}<p class="err" role="alert">{rrejected}</p>{/if}
      {#if deleting && consequences}
        <div class="confirm" role="alertdialog" aria-labelledby="{uid}-del-h" aria-describedby="{uid}-del-d" tabindex="-1" onkeydown={(e) => { if (e.key === "Escape") void cancelDelete(); }}>
          <h3 id="{uid}-del-h">{t("rel.delete.title", { name: info.name })}</h3>
          <div id="{uid}-del-d">
            <p>{t("rel.delete.only")}</p>
            <ul>
              {#each consequences.notes as n}<li>{named(n)}</li>{/each}
              {#if consequences.orphans}<li>{t("rel.delete.orphans", { n: consequences.orphans })}</li>{/if}
            </ul>
            <p class="dim">{t("rel.delete.undo")}</p>
          </div>
          <div class="buttons-row">
            <button type="button" class="danger" onclick={confirmDelete} disabled={busy}>{t("rel.delete.confirm")}</button>
            <button type="button" id="{uid}-del-cancel" onclick={cancelDelete}>{t("rel.delete.cancel")}</button>
          </div>
        </div>
      {:else}
        <div class="buttons-row">
          <button type="button" id="{uid}-delete" class="danger-link" onclick={startDelete} disabled={!persons.has(info.id)}>{t("rel.delete")}</button>
        </div>
      {/if}
    </section>
  </article>
  {/if}
{/if}

<style>
  h2 { margin: 0 0 0.2rem; font-size: 1.25rem; }
  h3 { margin: 1rem 0 0.2rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  p { margin: 0.15rem 0; }
  .dim, small { color: var(--dim); }
  small { margin-left: 0.3rem; }
  .amp { margin: 0 0.3rem; }
  .note { white-space: pre-wrap; }
  ul.plain { list-style: none; padding: 0; margin: 0.2rem 0; }
  a { color: #8ab4ff; }
  .tag { border: 1px solid var(--line); border-radius: 4px; padding: 0 0.3rem; font-size: 0.72rem; }
  .badge { font-size: 0.7rem; border-radius: 4px; padding: 0 0.35rem; text-transform: none; letter-spacing: 0; border: 1px solid var(--line); }
  .badge.proven { color: #7bd88f; }
  .badge.assumed { color: var(--warn); border-style: dashed; }
  .badge.unknown { color: var(--dim); border-style: dashed; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
  /* Formular */
  form { display: flex; flex-direction: column; gap: 0.25rem; }
  label { margin-top: 0.5rem; font-size: 0.85rem; color: var(--dim); }
  input, select, textarea { width: 100%; box-sizing: border-box; }
  textarea { font: inherit; color: var(--text); background: #1a2038; border: 1px solid var(--line); border-radius: 6px; padding: 0.3rem 0.65rem; resize: vertical; }
  fieldset { border: 1px solid var(--line); border-radius: 6px; margin: 0.75rem 0 0; padding: 0.25rem 0.6rem 0.6rem; display: flex; flex-direction: column; gap: 0.25rem; }
  legend { padding: 0 0.3rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  .hint { margin-left: 0; font-size: 0.75rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .cites { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.6rem; }
  .cite { display: flex; flex-direction: column; gap: 0.2rem; border-top: 1px dashed var(--line); padding-top: 0.3rem; }
  .cite button.link { align-self: flex-start; }
  .err { color: var(--bad); font-size: 0.85rem; margin: 0.1rem 0; }
  [aria-invalid="true"] { border-color: var(--bad); }
  .buttons { display: flex; gap: 0.5rem; margin-top: 1rem; position: sticky; bottom: 0; background: var(--panel); padding: 0.5rem 0; }
  .flash { border: 1px solid var(--line); background: #16302c; border-radius: 6px; padding: 0.3rem 0.6rem; margin: 0 0 0.6rem; font-size: 0.9rem; }
  .radio { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.2rem; color: var(--text); }
  .radio input { width: auto; }
  .buttons-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.3rem 0; }
  .actions { margin-top: 1.2rem; border-top: 1px solid var(--line); }
  .confirm { border: 1px solid var(--bad); border-radius: 6px; padding: 0.4rem 0.7rem; margin-top: 0.6rem; }
  .confirm h3 { margin-top: 0.2rem; color: var(--text); text-transform: none; font-size: 1rem; }
  .confirm ul { margin: 0.2rem 0; padding-left: 1.1rem; }
  .danger { background: #5a2323; border-color: var(--bad); }
  .danger-link { color: var(--bad); }
  .pending { border: 1px solid var(--warn); border-radius: 6px; padding: 0.4rem 0.6rem; margin-bottom: 0.6rem; }
</style>
