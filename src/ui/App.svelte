<script lang="ts">
  // Minimale Import-/Export-Oberfläche für M2. Die echte Oberfläche kommt in M7,
  // die Speicherung (IndexedDB) in M3: Der Baum liegt hier nur im Arbeitsspeicher.
  import { FamilyGraph, serializeTreeData } from "../core";
  import type { TreeData } from "../core";
  import { exportGedcom } from "../import/gedcomExport";
  import type { ImportWarning } from "../import/gedcomImport";
  import { importFileInWorker } from "../workers/importClient";

  let data = $state<TreeData | null>(null);
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
      data = result.data;
      fileName = file.name;
      charset = result.charset ?? "";
      warnings = result.warnings;
      // Der Graph meldet inhaltliche Probleme (Zyklen, hängende Verweise) statt zu werfen.
      issues = new FamilyGraph(result.data).validate().map((i) => `${i.code}: ${i.message}`);
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
  <p>Meilenstein M2: GEDCOM- oder JSON-Datei laden und wieder exportieren.</p>

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

  {#if data}
    <section>
      <h2>{fileName}</h2>
      <p>
        {data.persons.length} Personen, {data.unions.length} Partnerschaften, {data.sources.length} Quellen
        {#if charset}(Zeichensatz: {charset}){/if}
      </p>
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
