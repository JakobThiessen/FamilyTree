<script lang="ts">
  // Minimale Oberfläche für M2/M3 (Import, Export, gespeicherte Bäume).
  // Die echte Oberfläche und der Import-Dialog kommen in M7.
  import { FamilyGraph, serializeTreeData } from "../core";
  import type { TreeData } from "../core";
  import { exportGedcom } from "../import/gedcomExport";
  import type { ImportWarning } from "../import/gedcomImport";
  import { importFileInWorker } from "../workers/importClient";
  import { TreeStore } from "../storage";
  import type { TreeMeta } from "../storage";
  import { onMount } from "svelte";

  // Speicher (IndexedDB). Wird beim Start geöffnet; fehlt IndexedDB, läuft die App ohne Speicherung.
  let store = $state.raw<TreeStore | null>(null);
  let saved = $state<TreeMeta[]>([]);
  let storageError = $state("");

  async function refresh() {
    if (store) saved = await store.listTrees();
  }

  onMount(async () => {
    try {
      store = await TreeStore.open();
      await refresh();
    } catch (e) {
      storageError = "Speicher nicht verfügbar: " + (e instanceof Error ? e.message : String(e));
    }
  });

  /** Zeigt Daten an (nach Import oder Laden) und meldet inhaltliche Probleme des Graphen. */
  function show(d: TreeData, name: string) {
    data = d;
    fileName = name;
    issues = new FamilyGraph(d).validate().map((i) => `${i.code}: ${i.message}`);
  }

  async function saveCurrent() {
    if (!store || !data) return;
    try {
      await store.saveTree(baseName(), data);
      await refresh();
    } catch (e) {
      storageError = "Speichern fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
    }
  }

  async function openSaved(t: TreeMeta) {
    if (!store) return;
    busy = true;
    try {
      warnings = [];
      charset = "";
      show(await store.loadTree(t.id), t.name);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function renameSaved(t: TreeMeta) {
    const name = prompt("Neuer Name:", t.name);
    if (!store || name === null) return;
    await store.renameTree(t.id, name);
    await refresh();
  }

  async function deleteSaved(t: TreeMeta) {
    if (!store || !confirm(`"${t.name}" endgültig löschen?`)) return;
    await store.deleteTree(t.id);
    await refresh();
  }

  // $state.raw: kein Proxy, denn IndexedDB kann Proxy-Objekte nicht speichern (und große Bäume brauchen keine Tiefenreaktivität).
  let data = $state.raw<TreeData | null>(null);
  let fileName = $state("");
  let charset = $state("");
  let warnings = $state<ImportWarning[]>([]);
  let issues = $state<string[]>([]);
  let error = $state("");
  let busy = $state(false);
  let dragging = $state(false);

  async function load(file: File | undefined) {
    if (!file) return;
    busy = true;
    error = "";
    try {
      const result = await importFileInWorker(file);
      charset = result.charset ?? "";
      warnings = result.warnings;
      show(result.data, file.name);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    load(e.dataTransfer?.files[0]);
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

  const baseName = () => fileName.replace(/\.[^.]+$/, "") || "stammbaum";
</script>

<main>
  <h1>FamilyTree</h1>
  <p>Meilenstein M3: GEDCOM- oder JSON-Datei laden, speichern (IndexedDB) und exportieren.</p>

  <label
    class="drop"
    class:dragging
    ondragover={(e) => { e.preventDefault(); dragging = true; }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
  >
    <input type="file" accept=".ged,.gedcom,.json" onchange={(e) => load(e.currentTarget.files?.[0])} />
    {busy ? "Lese Datei …" : "Datei hierher ziehen oder klicken"}
  </label>

  {#if error}<p class="error">Fehler: {error}</p>{/if}

  {#if storageError}<p class="error">{storageError}</p>{/if}

  {#if saved.length}
    <section>
      <h2>Gespeicherte Bäume</h2>
      <ul>
        {#each saved as t (t.id)}
          <li>
            <strong>{t.name}</strong> ({t.personCount} Personen)
            <button onclick={() => openSaved(t)}>Laden</button>
            <button onclick={() => renameSaved(t)}>Umbenennen</button>
            <button onclick={() => deleteSaved(t)}>Löschen</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if data}
    <section>
      <h2>{fileName}</h2>
      <p>
        {data.persons.length} Personen, {data.unions.length} Partnerschaften, {data.sources.length} Quellen
        {#if charset}(Zeichensatz: {charset}){/if}
      </p>
      <button onclick={saveCurrent} disabled={!store}>Im Browser speichern</button>
      <button onclick={() => download(exportGedcom(data!), `${baseName()}.ged`, "text/plain;charset=utf-8")}>
        Als GEDCOM exportieren
      </button>
      <button onclick={() => download(serializeTreeData(data!), `${baseName()}.json`, "application/json")}>
        Als JSON exportieren
      </button>

      {#if warnings.length}
        <h3>Hinweise beim Import ({warnings.length})</h3>
        <ul>
          {#each warnings.slice(0, 50) as w}<li>{w.line ? `Zeile ${w.line}: ` : ""}{w.message}</li>{/each}
        </ul>
      {/if}
      {#if issues.length}
        <h3>Probleme im Baum ({issues.length})</h3>
        <ul>{#each issues.slice(0, 50) as i}<li>{i}</li>{/each}</ul>
      {/if}
    </section>
  {/if}
</main>

<style>
  main { padding: 2rem; max-width: 50rem; }
  .drop {
    display: block; padding: 2rem; border: 2px dashed #888; border-radius: 8px;
    text-align: center; cursor: pointer;
  }
  .drop.dragging { border-color: #4a9; background: rgba(70, 170, 150, 0.1); }
  .drop input { display: none; }
  .error { color: #d55; }
  button { margin-right: 0.5rem; }
</style>
