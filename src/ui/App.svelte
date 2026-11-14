<script lang="ts">
  // Oberfläche: Kopfleiste, Zeichenfläche mit Filter, rechts Suche und Personendetails, Import-Dialog.
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
    <strong class="brand">FamilyTree</strong>
    {#if data}<span class="name" title={treeName}>{treeName}</span>{/if}
    <span class="grow"></span>
    {#if data}
      {#if !savedId}<button onclick={saveCurrent} disabled={!store} title="Im Browser speichern (IndexedDB)">Speichern</button>{/if}
      <button onclick={() => download(exportGedcom(data!), `${baseName()}.ged`, "text/plain;charset=utf-8")}>GEDCOM</button>
      <button onclick={() => download(serializeTreeData(data!), `${baseName()}.json`, "application/json")}>JSON</button>
      <button onclick={() => online.open()} title="Personen in offenen Quellen suchen (Wikidata, WikiTree)">Online suchen …</button>
      <button class="panel-toggle" onclick={() => (panelOpen = !panelOpen)} aria-pressed={panelOpen}>Details</button>
    {/if}
    <button class="primary" onclick={() => dialog.open()}>Öffnen / Import …</button>
  </header>

  {#if notice}
    <p class="notice" role="status">{notice} <button class="link" onclick={() => (notice = "")}>Schließen</button></p>
  {/if}
  {#if storageError && data}<p class="notice bad" role="alert">{storageError}</p>{/if}

  <div class="body" class:with-panel={data && panelOpen}>
    <div class="stage">
      {#if data}
        <!-- {#key}: bei anderen Daten wird die Ansicht komplett neu aufgebaut -->
        {#key data}<TreeViewer bind:this={viewer} {data} {startId} onFocusChange={(id) => (focusId = id)} />{/key}
      {:else}
        <p class="empty">Noch kein Stammbaum geöffnet.</p>
      {/if}
    </div>
    {#if data && panelOpen}
      <aside>
        <SearchBox {persons} onPick={(id) => viewer?.focusOn(id)} />
        <div class="details"><PersonDetails {info} onPick={(id) => viewer?.focusOn(id)} /></div>
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
  .brand { letter-spacing: 0.02em; }
  .name { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 30vw; }
  .grow { flex: 1; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
  .body.with-panel { grid-template-columns: minmax(0, 1fr) 22rem; }
  .stage { min-height: 0; min-width: 0; }
  aside { display: flex; flex-direction: column; gap: 0.75rem; min-height: 0; padding: 0.75rem; border-left: 1px solid var(--line); background: var(--panel); }
  .details { flex: 1; min-height: 0; overflow: auto; }
  .notice { margin: 0; padding: 0.35rem 0.75rem; background: #16302c; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
  .notice.bad { background: #3a1c1c; color: var(--bad); }
  .empty { color: var(--dim); text-align: center; margin-top: 4rem; }
  /* Schmale Fenster: Details unter die Zeichenfläche */
  @media (max-width: 800px) {
    .body.with-panel { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(12rem, 1fr) 38%; }
    aside { border-left: 0; border-top: 1px solid var(--line); }
    .name { display: none; }
  }
</style>
