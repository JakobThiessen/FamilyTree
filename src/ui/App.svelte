<script lang="ts">
  // Oberfläche: Kopfleiste mit Reitern und Suche, Zeichenfläche mit Filterpanel, rechts Personendetails, Import-Dialog.
  // Baumdaten mit $state.raw: kein Proxy (IndexedDB kann Proxys nicht speichern, D13).
  import { onMount } from "svelte";
  import { changesFromTouched, EditSession, FamilyGraph, PersonSearchIndex, serializeTreeData } from "../core";
  import type { EditOp, Person, PersonId, SessionResult, Source, TreeData } from "../core";
  import { exportGedcom } from "../import/gedcomExport";
  import { TreeStore } from "../storage";
  import type { TreeMeta } from "../storage";
  import AncestorsView from "./AncestorsView.svelte";
  import MapView from "./MapView.svelte";
  import TimelineView from "./TimelineView.svelte";
  import ImportDialog from "./ImportDialog.svelte";
  import OnlineDialog from "./OnlineDialog.svelte";
  import type { AdoptResult } from "../providers";
  import PersonDetails from "./PersonDetails.svelte";
  import SearchBox from "./SearchBox.svelte";
  import TreeViewer from "./TreeViewer.svelte";
  import { i18n, setLang, t } from "./lang.svelte";
  import { editText, errorText } from "./messages";
  import { LANGS } from "./i18n";
  import type { Lang } from "./i18n";
  import { describePerson } from "./personInfo";

  // Speicher (IndexedDB). Wird beim Start geöffnet; fehlt IndexedDB, läuft die App ohne Speicherung.
  let store = $state.raw<TreeStore | null>(null);
  let saved = $state<TreeMeta[]>([]);
  let storageError = $state("");

  let data = $state.raw<TreeData | null>(null);
  /** Zählt neu geöffnete Bäume: nur dann baut `{#key}` die Ansicht neu auf; Bearbeiten führt sie nach (`updateData`). */
  let treeKey = $state(0);
  // Bearbeiten (M10): die Sitzung hält Stand und Undo/Redo-Stapel; der Suchindex wird nachgeführt statt neu gebaut.
  let session: EditSession | null = null;
  let searchIndex = $state.raw(new PersonSearchIndex([]));
  let indexRev = $state(0);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let unsavedHint = $state(false);
  let editError = $state("");
  let treeName = $state("");
  let savedId = $state<string | null>(null);
  let focusId = $state<PersonId>("");
  // Auf schmalen Fenstern (Handy) starten die Details eingeklappt, damit die Zeichenfläche Platz hat.
  const NARROW = typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches;
  let panelOpen = $state(!NARROW);
  let dragging = $state(false);

  // Reiter: ein einfaches $state-Feld statt Router-Paket (UI-KONZEPT, M7b). Noch ohne Inhalt: „folgt“.
  type Tab = "tree" | "ancestors" | "timeline" | "map";
  let tab = $state<Tab>("tree");
  const TABS = $derived<{ id: Tab; label: string }[]>([
    { id: "tree", label: t("app.tab.tree") },
    { id: "ancestors", label: t("app.tab.ancestors") },
    { id: "timeline", label: t("app.tab.timeline") },
    { id: "map", label: t("app.tab.map") },
  ]);

  let dialog: ReturnType<typeof ImportDialog>;
  let online: ReturnType<typeof OnlineDialog>;
  /** Person, die nach dem Neuaufbau der Ansicht im Fokus stehen soll (nach „Online übernehmen“) */
  let startId = $state<PersonId | undefined>();
  let notice = $state("");
  let viewer: ReturnType<typeof TreeViewer> | undefined = $state();

  // Abgeleitete Tabellen: einmal pro Baum, nicht pro Fokuswechsel.
  const persons = $derived<Map<PersonId, Person>>(new Map((data?.persons ?? []).map((p) => [p.id, p])));
  const sources = $derived<Map<string, Source>>(new Map((data?.sources ?? []).map((s) => [s.id, s])));
  const graph = $derived(data ? new FamilyGraph(data) : null);
  const info = $derived(graph && focusId ? describePerson(graph, sources, focusId, i18n.lang) : null);

  async function refresh() {
    if (store) saved = await store.listTrees();
  }

  $effect(() => {
    document.documentElement.lang = i18n.lang; // Bildschirmleser sprechen in der richtigen Sprache
  });

  onMount(async () => {
    dialog.open(); // Startbild: Datei laden oder gespeicherten Baum öffnen
    try {
      store = await TreeStore.open();
      await refresh();
    } catch (e) {
      storageError = t("app.storageUnavailable", { error: errorText(e, i18n.lang) });
    }
  });

  /** Neuer Baum (geöffnet oder durch eine Übernahme ersetzt): Sitzung, Suchindex und Ansicht von vorn. */
  function setTree(d: TreeData) {
    if (session) session.reset(d);
    else session = new EditSession(d);
    searchIndex = new PersonSearchIndex(d.persons);
    canUndo = canRedo = false;
    unsavedHint = false;
    editError = "";
    data = d;
    treeKey++; // {#key treeKey} unten baut die Ansicht neu auf
  }

  function showTree(d: TreeData, name: string, id: string | null) {
    focusId = "";
    startId = undefined;
    notice = "";
    setTree(d);
    treeName = name;
    savedId = id;
  }

  /** Eine Person in der Nachbarschaft von `id` (Partner, Eltern, Kinder) im alten Graphen, die im neuen Baum noch steht: Ersatzfokus nach dem Löschen. */
  function neighborOf(old: FamilyGraph | null, id: PersonId, now: Map<PersonId, Person>): PersonId | undefined {
    if (!old || !old.hasPerson(id)) return undefined;
    return [...old.partners(id), ...old.parents(id), ...old.children(id)].find((x) => now.has(x));
  }

  /**
   * Ergebnis eines Schritts (Ändern, Undo, Redo) übernehmen: Daten und Suchindex nachführen, Ansicht ohne
   * Kamerasprung aktualisieren, in IndexedDB schreiben (nur wenn der Baum gespeichert ist).
   */
  async function afterStep(res: SessionResult) {
    if (!res.ok) {
      editError = editText(res.reject, i18n.lang);
      return;
    }
    editError = "";
    const oldGraph = graph;
    const oldFocus = focusId;
    const next = res.data;
    // Schreiben zuerst anstoßen (die Transaktion entsteht synchron, so bleibt die Reihenfolge bei schnellen Schritten).
    const changes = changesFromTouched(next, res.touched);
    const write = store && savedId ? store.applyChanges(savedId, changes) : null;
    data = next;
    canUndo = session?.canUndo ?? false;
    canRedo = session?.canRedo ?? false;
    const now = persons; // abgeleitet, wird nach `data = next` neu gebildet
    searchIndex.update(
      res.touched.persons.map((id) => now.get(id)).filter((p): p is Person => p !== undefined),
      res.touched.persons.filter((id) => !now.has(id)),
    );
    indexRev++;
    if (!savedId) unsavedHint = true;
    const fallback = oldFocus && !now.has(oldFocus) ? neighborOf(oldGraph, oldFocus, now) : undefined;
    const view = viewer?.updateData(next, changes, fallback);
    if (write) {
      try {
        await write;
        void refresh();
      } catch (e) {
        storageError = t("edit.saveFailed", { error: errorText(e, i18n.lang) });
      }
    }
    await view;
  }

  /** Eine Änderung anwenden (Formular und Knöpfe aus Schritt 4–6 rufen das auf). */
  async function edit(op: EditOp): Promise<SessionResult> {
    const res: SessionResult = session ? session.apply(op) : { ok: false, reject: { code: "edit.reject.no-tree" } };
    await afterStep(res);
    return res;
  }
  const undo = () => (session ? afterStep(session.undo()) : undefined);
  const redo = () => (session ? afterStep(session.redo()) : undefined);

  // Nur zur Entwicklung (Schritt 3 hat noch kein Formular): `__edit.apply({type: "...", ...})`, `__edit.undo()` in der Konsole.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__edit = { apply: edit, undo, redo, session: () => session };

  /** Strg+Z = Rückgängig, Strg+Y oder Strg+Umschalt+Z = Wiederholen; nicht in Eingabefeldern (dort gilt das Rückgängig des Feldes). */
  function onKeyDown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !data) return;
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (document.querySelector("dialog[open]")) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) void undo();
    else if (k === "y" || (k === "z" && e.shiftKey)) void redo();
    else return;
    e.preventDefault();
  }

  async function saveCurrent() {
    if (!store || !data) return;
    try {
      const meta = await store.saveTree(treeName, data);
      savedId = meta.id;
      unsavedHint = false;
      session?.markSaved();
      await refresh();
    } catch (e) {
      storageError = t("app.saveFailed", { error: errorText(e, i18n.lang) });
    }
  }

  /** Suche in der Kopfleiste: immer zur Stammbaum-Ansicht wechseln und dort die Person fokussieren. */
  function pick(id: PersonId) {
    tab = "tree";
    viewer?.focusOn(id);
  }

  /** Klick in der Ahnentafel: Fokus wechseln, aber im Reiter „Ahnen“ bleiben. */
  function pickKeepTab(id: PersonId) {
    focusId = id;
    viewer?.focusOn(id);
  }

  /** Externe Treffer übernommen (M8): Baum ersetzen, gespeicherten Baum mit aktualisieren, auf die Person springen. */
  async function adopted(res: AdoptResult, summary: string) {
    storageError = "";
    if (store && savedId) {
      try {
        await store.replaceTree(savedId, res.data);
        await refresh();
      } catch (e) {
        storageError = t("app.saveFailed", { error: errorText(e, i18n.lang) });
      }
    }
    startId = res.rootId;
    setTree(res.data);
    notice = summary + (savedId ? "" : t("app.notSaved"));
  }

  // Dateien lassen sich überall im Fenster ablegen.
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragging = false;
    dialog.importFile(e.dataTransfer?.files[0]);
  }

  /** Lädt Text als Datei herunter (Blob + temporärer Link). */
  function download(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  const baseName = () => treeName.replace(/\.[^.]+$/, "") || "stammbaum";
</script>

<svelte:window
  onkeydown={onKeyDown}
  ondragover={(e) => { if (hasFiles(e)) { e.preventDefault(); dragging = true; } }}
  ondragleave={(e) => { if (!e.relatedTarget) dragging = false; }}
  ondrop={onDrop}
/>

<a class="skip" href="#main">{t("app.skip")}</a>
<div class="app">
  <header>
    <div class="brand"><strong>FamilyTree</strong><small>{t("app.subtitle")}</small></div>
    {#if data}<span class="name" title={treeName}>{treeName}</span>{/if}
    <nav class="tabs" aria-label={t("app.tabs.label")}>
      {#each TABS as t (t.id)}
        <button class="tab" class:on={tab === t.id} aria-current={tab === t.id ? "page" : undefined} onclick={() => (tab = t.id)}>{t.label}</button>
      {/each}
    </nav>
    <span class="grow"></span>
    {#if data}<div class="search-slot"><SearchBox {persons} index={searchIndex} rev={indexRev} onPick={pick} /></div>{/if}
    <select class="lang" aria-label={t("app.lang.label")} title={t("app.lang.title")} value={i18n.lang} onchange={(e) => setLang(e.currentTarget.value as Lang)}>
      {#each LANGS as l (l)}<option value={l}>{l.toUpperCase()}</option>{/each}
    </select>
    <div class="actions">
    {#if data}
      <button onclick={undo} disabled={!canUndo} title={t("edit.undo.title")}>{t("edit.undo")}</button>
      <button onclick={redo} disabled={!canRedo} title={t("edit.redo.title")}>{t("edit.redo")}</button>
      {#if !savedId}<button onclick={saveCurrent} disabled={!store} title={t("app.save.title")}>{t("app.save")}</button>{/if}
      <button onclick={() => download(exportGedcom(data!), `${baseName()}.ged`, "text/plain;charset=utf-8")}>GEDCOM</button>
      <button onclick={() => download(serializeTreeData(data!), `${baseName()}.json`, "application/json")}>JSON</button>
      <button onclick={() => online.open()} title={t("app.online.title")}>{t("app.online")}</button>
      {#if tab === "tree"}<button class="panel-toggle" onclick={() => (panelOpen = !panelOpen)} aria-pressed={panelOpen}>{t("app.details")}</button>{/if}
    {/if}
    <button class="primary" onclick={() => dialog.open()}>{t("app.open")}</button>
    </div>
  </header>

  {#if notice}
    <p class="notice" role="status">{notice} <button class="link" onclick={() => (notice = "")}>{t("app.close")}</button></p>
  {/if}
  {#if unsavedHint && data && !savedId}
    <p class="notice" role="status">{t("edit.unsaved")} <button class="link" onclick={saveCurrent} disabled={!store}>{t("edit.unsaved.save")}</button> <button class="link" onclick={() => (unsavedHint = false)}>{t("app.close")}</button></p>
  {/if}
  {#if editError}<p class="notice bad" role="alert">{editError}</p>{/if}
  {#if storageError && data}<p class="notice bad" role="alert">{storageError}</p>{/if}

  <main id="main" tabindex="-1" class="body" class:with-panel={data && tab === "tree" && panelOpen}>
    <!-- Der Stammbaum bleibt beim Reiterwechsel erhalten (nur versteckt), damit Fokus und Kamera nicht verloren gehen. -->
    <div class="stage" class:hidden={tab !== "tree"}>
      {#if data}
        <!-- {#key}: bei einem anderen Baum wird die Ansicht komplett neu aufgebaut; Änderungen laufen über viewer.updateData -->
        {#key treeKey}<TreeViewer bind:this={viewer} {data} {graph} {startId} title={treeName} onFocusChange={(id) => (focusId = id)} />{/key}
      {:else}
        <p class="empty">{t("app.empty")}</p>
      {/if}
    </div>
    {#if tab === "ancestors"}
      {#key i18n.lang}<div class="stage"><AncestorsView {graph} {persons} {focusId} onPick={pickKeepTab} /></div>{/key}
    {:else if tab === "timeline"}
      {#key i18n.lang}<div class="stage"><TimelineView {graph} {persons} {focusId} onPick={pickKeepTab} /></div>{/key}
    {:else if tab === "map"}
      {#key i18n.lang}<div class="stage"><MapView {graph} {focusId} onPick={pickKeepTab} /></div>{/key}
    {/if}
    {#if data && tab === "tree" && panelOpen}
      <aside aria-label={t("app.details")}>
        <div class="details"><PersonDetails {info} onPick={pick} /></div>
      </aside>
    {/if}
  </main>
</div>

<OnlineDialog bind:this={online} {data} prefill={persons.get(focusId) ?? null} onAdopt={adopted} />

<ImportDialog
  bind:this={dialog}
  {store}
  {saved}
  {storageError}
  {dragging}
  canClose={data !== null}
  onShow={showTree}
  onSaved={refresh}
/>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line); background: var(--panel); }
  .brand { display: flex; flex-direction: column; line-height: 1.15; letter-spacing: 0.02em; }
  .brand small { color: var(--dim); font-size: 0.7rem; }
  .tabs { display: flex; gap: 0.2rem; margin-left: 0.5rem; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .skip { position: absolute; left: 0.5rem; top: -3rem; z-index: 50; background: var(--accent); color: #07110f; padding: 0.4rem 0.8rem; border-radius: 6px; }
  .skip:focus { top: 0.5rem; }
  main { outline: none; }
  .tab { background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 0.4rem 0.7rem; color: var(--dim); }
  .tab.on { color: var(--text); border-bottom-color: var(--accent); }
  .tab:hover:not(:disabled) { color: var(--text); }
  .search-slot { width: 14rem; }
  .lang { padding: 0.3rem 0.4rem; }
  .stage.hidden { display: none; }
  .name { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30vw; }
  .grow { flex: 1; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
  .body.with-panel { grid-template-columns: minmax(0, 1fr) 22rem; }
  .stage { min-height: 0; min-width: 0; }
  aside { display: flex; flex-direction: column; gap: 0.75rem; min-height: 0; padding: 0.75rem; border-left: 1px solid var(--line); background: var(--panel); }
  .details { flex: 1; min-height: 0; overflow: auto; }
  header :global(.search ul) { min-width: 18rem; left: auto; right: 0; }
  .notice { margin: 0; padding: 0.35rem 0.75rem; background: #16302c; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
  .notice.bad { background: #3a1c1c; color: var(--bad); }
  .empty { color: var(--dim); text-align: center; margin-top: 4rem; }
  /* Schmale Fenster: Details unter die Zeichenfläche */
  @media (max-width: 800px) {
    .body.with-panel { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(12rem, 1fr) 38%; }
    aside { border-left: 0; border-top: 1px solid var(--line); }
    .name, .brand small { display: none; }
    .search-slot { width: 100%; order: 5; }
    .search-slot :global(.search) { width: 100%; }
    /* Reiter und Aktionen laufen in einer eigenen Zeile seitlich scrollbar statt das Fenster zu verbreitern */
    .tabs { order: 4; width: 100%; margin-left: 0; overflow-x: auto; scrollbar-width: none; flex: none; }
    .tab { flex: none; white-space: nowrap; }
    .actions { order: 6; width: 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 0.1rem; }
    .actions :global(button) { flex: none; white-space: nowrap; }
    header { gap: 0.4rem; padding: 0.4rem 0.6rem; }
  }
</style>
