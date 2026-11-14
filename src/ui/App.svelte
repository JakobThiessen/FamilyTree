<script lang="ts">
  // Oberfläche: Kopfleiste mit Reitern und Suche, Zeichenfläche mit Filterpanel, rechts Personendetails, Import-Dialog.
  // Baumdaten mit $state.raw: kein Proxy (IndexedDB kann Proxys nicht speichern, D13).
  import { onMount } from "svelte";
  import { FamilyGraph, serializeTreeData } from "../core";
  import type { Person, PersonId, Source, TreeData } from "../core";
  import { exportGedcom } from "../import/gedcomExport";
  import { TreeStore } from "../storage";
  import type { TreeMeta } from "../storage";
  import ImportDialog from "./ImportDialog.svelte";
  import OnlineDialog from "./OnlineDialog.svelte";
  import type { AdoptResult } from "../providers";
  import PersonDetails from "./PersonDetails.svelte";
  import SearchBox from "./SearchBox.svelte";
  import TreeViewer from "./TreeViewer.svelte";
  import { describePerson } from "./personInfo";

  // Speicher (IndexedDB). Wird beim Start geöffnet; fehlt IndexedDB, läuft die App ohne Speicherung.
  let store = $state.raw<TreeStore | null>(null);
  let saved = $state<TreeMeta[]>([]);
  let storageError = $state("");

  let data = $state.raw<TreeData | null>(null);
  let treeName = $state("");
  let savedId = $state<string | null>(null);
  let focusId = $state<PersonId>("");
  let panelOpen = $state(true);
  let dragging = $state(false);

  // Reiter: ein einfaches $state-Feld statt Router-Paket (UI-KONZEPT, M7b). Noch ohne Inhalt: „folgt“.
  type Tab = "tree" | "ancestors" | "timeline" | "map";
  let tab = $state<Tab>("tree");
  const TABS: { id: Tab; label: string }[] = [
    { id: "tree", label: "Stammbaum" },
    { id: "ancestors", label: "Ahnen" },
    { id: "timeline", label: "Zeitleiste" },
    { id: "map", label: "Karte" },
  ];
  const SOON: Record<Exclude<Tab, "tree">, string> = {
    ancestors: "Ahnentafel mit Sosa-Nummern, Ahnenschwund und Inzuchtkoeffizient",
    timeline: "Lebensbalken mit unscharfen Daten",
    map: "Orte und Lebenswege",
  };

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
  const info = $derived(graph && focusId ? describePerson(graph, sources, focusId) : null);

  async function refresh() {
    if (store) saved = await store.listTrees();
  }

  onMount(async () => {
    dialog.open(); // Startbild: Datei laden oder gespeicherten Baum öffnen
    try {
      store = await TreeStore.open();
      await refresh();
    } catch (e) {
      storageError = "Speicher nicht verfügbar: " + (e instanceof Error ? e.message : String(e));
    }
  });

  function showTree(d: TreeData, name: string, id: string | null) {
    focusId = "";
    startId = undefined;
    notice = "";
    data = d; // {#key data} unten baut die Ansicht neu auf
    treeName = name;
    savedId = id;
  }

  async function saveCurrent() {
    if (!store || !data) return;
    try {
      const meta = await store.saveTree(treeName, data);
      savedId = meta.id;
      await refresh();
    } catch (e) {
      storageError = "Speichern fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
    }
  }

  /** Suche in der Kopfleiste: immer zur Stammbaum-Ansicht wechseln und dort die Person fokussieren. */
  function pick(id: PersonId) {
    tab = "tree";
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
        storageError = "Speichern fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
      }
    }
    startId = res.rootId;
    data = res.data; // {#key data} baut die Ansicht neu auf
    notice = summary + (savedId ? "" : " Noch nicht gespeichert.");
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
  ondragover={(e) => { if (hasFiles(e)) { e.preventDefault(); dragging = true; } }}
  ondragleave={(e) => { if (!e.relatedTarget) dragging = false; }}
  ondrop={onDrop}
/>

<div class="app">
  <header>
    <div class="brand"><strong>FamilyTree</strong><small>Stammbaum im Browser</small></div>
    {#if data}<span class="name" title={treeName}>{treeName}</span>{/if}
    <nav class="tabs" aria-label="Rubriken">
      {#each TABS as t (t.id)}
        <button class="tab" class:on={tab === t.id} aria-current={tab === t.id ? "page" : undefined} onclick={() => (tab = t.id)}>{t.label}</button>
      {/each}
      <!-- Optionale Rubriken, später (nach M8): Dublettenvorschläge, Treffer, Quellenliste -->
      <button class="tab" disabled title="Folgt: Aufgabenliste (fehlende Daten, Dubletten)">Forschung</button>
      <button class="tab" disabled title="Folgt: Quellenliste">Quellen</button>
    </nav>
    <span class="grow"></span>
    {#if data}<div class="search-slot"><SearchBox {persons} onPick={pick} /></div>{/if}
    <select class="lang" disabled aria-label="Sprache (folgt mit M9)" title="Sprachumschalter folgt mit M9">
      <option>DE</option><option>EN</option>
    </select>
    {#if data}
      {#if !savedId}<button onclick={saveCurrent} disabled={!store} title="Im Browser speichern (IndexedDB)">Speichern</button>{/if}
      <button onclick={() => download(exportGedcom(data!), `${baseName()}.ged`, "text/plain;charset=utf-8")}>GEDCOM</button>
      <button onclick={() => download(serializeTreeData(data!), `${baseName()}.json`, "application/json")}>JSON</button>
      <button onclick={() => online.open()} title="Personen in offenen Quellen suchen (Wikidata, WikiTree)">Online suchen …</button>
      {#if tab === "tree"}<button class="panel-toggle" onclick={() => (panelOpen = !panelOpen)} aria-pressed={panelOpen}>Details</button>{/if}
    {/if}
    <button class="primary" onclick={() => dialog.open()}>Öffnen / Import …</button>
  </header>

  {#if notice}
    <p class="notice" role="status">{notice} <button class="link" onclick={() => (notice = "")}>Schließen</button></p>
  {/if}
  {#if storageError && data}<p class="notice bad" role="alert">{storageError}</p>{/if}

  <div class="body" class:with-panel={data && tab === "tree" && panelOpen}>
    <!-- Der Stammbaum bleibt beim Reiterwechsel erhalten (nur versteckt), damit Fokus und Kamera nicht verloren gehen. -->
    <div class="stage" class:hidden={tab !== "tree"}>
      {#if data}
        <!-- {#key}: bei anderen Daten wird die Ansicht komplett neu aufgebaut -->
        {#key data}<TreeViewer bind:this={viewer} {data} {graph} {startId} onFocusChange={(id) => (focusId = id)} />{/key}
      {:else}
        <p class="empty">Noch kein Stammbaum geöffnet.</p>
      {/if}
    </div>
    {#if tab !== "tree"}
      <div class="stage soon">
        <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
        <p>Folgt: {SOON[tab]}.</p>
      </div>
    {/if}
    {#if data && tab === "tree" && panelOpen}
      <aside>
        <div class="details"><PersonDetails {info} onPick={pick} /></div>
      </aside>
    {/if}
  </div>
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
  .tab { background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 0.4rem 0.7rem; color: var(--dim); }
  .tab.on { color: var(--text); border-bottom-color: var(--accent); }
  .tab:hover:not(:disabled) { color: var(--text); }
  .search-slot { width: 14rem; }
  .lang { padding: 0.3rem 0.4rem; }
  .stage.hidden { display: none; }
  .stage.soon { padding: 3rem 1.5rem; text-align: center; color: var(--dim); grid-column: 1 / -1; }
  .stage.soon h2 { color: var(--text); margin: 0 0 0.5rem; }
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
    .search-slot { width: 10rem; }
  }
</style>
