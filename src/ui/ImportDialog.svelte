<script lang="ts">
  // Import-Dialog: Datei wählen (oder irgendwo im Fenster ablegen), Ergebnis mit Warnungen prüfen,
  // anzeigen und/oder speichern; außerdem die gespeicherten Bäume verwalten.
  // Der Dialog liest die Datei selbst (im Worker) und meldet nur das Endergebnis über `onShow`.
  import { FamilyGraph } from "../core";
  import type { TreeData } from "../core";
  import type { ImportResult } from "../import/gedcomImport";
  import { parseBackup, serializeBackup } from "../import/backup";
  import { fmt, i18n, t, tn } from "./lang.svelte";
  import { errorText, issueText, warningText } from "./messages";
  import { importFileInWorker } from "../workers/importClient";
  import { matchMedia } from "../import/mediaMatch";
  import { isImageFile, makeThumb } from "./mediaThumbs";
  import { memoryLookup, storeLookup } from "./mediaLookup";
  import type { MediaLookup, MediaThumb } from "./mediaLookup";
  import type { TreeMeta, TreeStore } from "../storage";

  let {
    store,
    saved,
    storageError,
    dragging,
    canClose,
    onShow,
    onSaved,
    onBackup,
  }: {
    store: TreeStore | null;
    saved: TreeMeta[];
    storageError: string;
    /** Wird gerade eine Datei über das Fenster gezogen? (Hervorhebung der Ablagefläche) */
    dragging: boolean;
    /** Nur schließbar, wenn schon ein Baum angezeigt wird */
    canClose: boolean;
    /** Baum anzeigen; `savedId` ist gesetzt, wenn er schon gespeichert ist. */
    onShow: (data: TreeData, name: string, savedId: string | null, media: MediaLookup | null) => void;
    /** Die Liste der gespeicherten Bäume hat sich geändert. */
    onSaved: () => void | Promise<void>;
    /** Ein Backup aller gespeicherten Bäume wurde heruntergeladen. */
    onBackup?: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let busy = $state(false);
  let error = $state("");
  let result = $state.raw<ImportResult | null>(null);
  let fileName = $state("");
  let saveName = $state("");
  let issues = $state<{ code: string; message: string; params?: Record<string, string | number> }[]>([]);
  let info = $state("");

  // Fotos (M11, D45): Verweise aus der Datei, vom Nutzer gewählter Ordner, erzeugte Vorschauen
  let thumbs = $state.raw(new Map<string, MediaThumb>());
  let mediaRefs = $state.raw<string[]>([]);
  let mediaProgress = $state<{ done: number; total: number } | null>(null);
  let mediaResult = $state<{ found: number; missing: number; ambiguous: number; failed: number } | null>(null);

  function resetMedia(r: ImportResult | null) {
    thumbs = new Map();
    mediaProgress = null;
    mediaResult = null;
    mediaRefs = r ? [...new Set(r.data.persons.flatMap((p) => (p.media ?? []).map((m) => m.file)))] : [];
  }

  /** Fotoordner gewählt: Dateien zuordnen und Vorschauen erzeugen (vier gleichzeitig, bleibt bedienbar). */
  async function pickPhotos(files: FileList | null) {
    if (!files || !mediaRefs.length) return;
    const list = [...files].filter((f) => isImageFile(f.name));
    const byPath = new Map(list.map((f) => [f.webkitRelativePath || f.name, f]));
    const m = matchMedia(mediaRefs, [...byPath.keys()]);
    const todo = [...m.matched];
    const out = new Map<string, MediaThumb>();
    let failed = 0;
    let done = 0;
    mediaResult = null;
    mediaProgress = { done, total: todo.length };
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const [ref, path] = todo[next++]!;
        try {
          out.set(ref, await makeThumb(byPath.get(path)!));
        } catch {
          failed++;
        }
        mediaProgress = { done: ++done, total: todo.length };
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    thumbs = out;
    mediaProgress = null;
    mediaResult = { found: out.size, missing: m.missing.length, ambiguous: m.ambiguous.length, failed };
  }

  export function open() {
    if (!dialog.open) dialog.showModal();
  }
  export function close() {
    dialog.close();
  }

  /** Liest eine Datei (Dateiauswahl oder Ablegen) und zeigt das Ergebnis im Dialog. */
  export async function importFile(file: File | undefined) {
    if (!file) return;
    open();
    busy = true;
    error = "";
    result = null;
    try {
      const r = await importFileInWorker(file);
      fileName = file.name;
      saveName = file.name.replace(/\.[^.]+$/, "") || t("import.defaultName");
      issues = new FamilyGraph(r.data).validate().map((i) => ({ code: i.code, message: i.message, params: i.params }));
      resetMedia(r);
      result = r;
    } catch (e) {
      error = errorText(e, i18n.lang);
    } finally {
      busy = false;
    }
  }

  const errText = (e: unknown) => errorText(e, i18n.lang);

  function showUnsaved() {
    if (!result) return;
    onShow(result.data, fileName, null, thumbs.size ? memoryLookup(thumbs) : null);
    reset();
  }

  async function saveAndShow() {
    if (!result || !store) return;
    busy = true;
    try {
      const meta = await store.saveTree(saveName.trim() || fileName, result.data);
      if (thumbs.size) await store.saveMedia(meta.id, [...thumbs].map(([file, th]) => ({ file, ...th })));
      await onSaved();
      onShow(result.data, meta.name, meta.id, store ? storeLookup(store, meta.id) : null);
      reset();
    } catch (e) {
      error = t("import.saveFailed", { error: errText(e) });
    } finally {
      busy = false;
    }
  }

  function reset() {
    result = null;
    resetMedia(null);
    error = "";
    dialog.close();
  }

  async function openSaved(tree: TreeMeta) {
    if (!store) return;
    busy = true;
    error = "";
    try {
      onShow(await store.loadTree(tree.id), tree.name, tree.id, storeLookup(store, tree.id));
      dialog.close();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }

  /** Backup: alle gespeicherten Bäume als eine Datei herunterladen. */
  async function backupAll() {
    if (!store) return;
    busy = true;
    error = info = "";
    try {
      const trees = await store.exportAll();
      const url = URL.createObjectURL(new Blob([serializeBackup(trees)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `familytree-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      info = tn("import.backupDone", trees.length);
      onBackup?.();
    } catch (e) {
      error = t("import.backupFailed", { error: errText(e) });
    } finally {
      busy = false;
    }
  }

  /** Restore: Backup-Datei lesen, Bäume zusätzlich anlegen (Bestehendes bleibt). */
  async function restoreBackup(file: File | undefined) {
    if (!file || !store) return;
    busy = true;
    error = info = "";
    try {
      const trees = parseBackup(await file.text());
      await store.restoreAll(trees);
      await onSaved();
      info = tn("import.restoreDone", trees.length);
    } catch (e) {
      error = t("import.restoreFailed", { error: errText(e) });
    } finally {
      busy = false;
    }
  }

  async function renameSaved(tree: TreeMeta) {
    const name = prompt(t("import.newName"), tree.name);
    if (!store || name === null) return;
    await store.renameTree(tree.id, name);
    await onSaved();
  }

  async function deleteSaved(tree: TreeMeta) {
    if (!store || !confirm(t("import.confirmDelete", { name: tree.name }))) return;
    await store.deleteTree(tree.id);
    await onSaved();
  }
</script>

<dialog bind:this={dialog} oncancel={(e) => { if (!canClose) e.preventDefault(); }} aria-labelledby="import-title">
  <header>
    <h2 id="import-title">{result ? t("import.title.check") : t("import.title.open")}</h2>
    {#if canClose}<button onclick={() => dialog.close()} aria-label={t("import.close")}>✕</button>{/if}
  </header>

  {#if error}<p class="error" role="alert">{t("import.error", { error })}</p>{/if}
  {#if storageError}<p class="error" role="alert">{storageError}</p>{/if}

  {#if result}
    {@const d = result.data}
    <p>
      <strong>{fileName}</strong>: {t("import.summary", { persons: d.persons.length, unions: d.unions.length, sources: d.sources.length })}
      {#if result.charset}<small>{t("import.charset", { charset: result.charset })}</small>{/if}
    </p>

    {#if result.warnings.length}
      <details open={result.warnings.length <= 10}>
        <summary class="warn">{tn("import.warnings", result.warnings.length)}</summary>
        <ul class="list">
          {#each result.warnings.slice(0, 200) as w}<li>{w.line ? t("import.line", { line: w.line }) : ""}{warningText(w, i18n.lang)}</li>{/each}
        </ul>
        {#if result.warnings.length > 200}<p class="dim">{t("import.moreWarnings", { n: result.warnings.length - 200 })}</p>{/if}
      </details>
    {:else}
      <p class="ok">{t("import.noWarnings")}</p>
    {/if}

    {#if issues.length}
      <details>
        <summary class="warn">{tn("import.issues", issues.length)}</summary>
        <ul class="list">{#each issues.slice(0, 200) as i}<li>{i.code}: {issueText(i, i18n.lang)}</li>{/each}</ul>
      </details>
    {/if}

    {#if mediaRefs.length}
      <section class="photos">
        <h3>{t("import.media.title")}</h3>
        <p>{t("import.media.refs", { n: mediaRefs.length })} <small>{t("import.media.hint")}</small></p>
        <label class="button" class:disabled={busy || !!mediaProgress}>
          {t("import.media.pick")}
          <input type="file" multiple webkitdirectory disabled={busy || !!mediaProgress} onchange={(e) => { pickPhotos(e.currentTarget.files); e.currentTarget.value = ""; }} />
        </label>
        {#if mediaProgress}<p role="status">{t("import.media.progress", mediaProgress)}</p>{/if}
        {#if mediaResult}<p class="ok" role="status">{t("import.media.result", mediaResult)}</p>{/if}
      </section>
    {/if}

    <label class="name">
      {t("import.saveName")}
      <input bind:value={saveName} disabled={!store} />
    </label>
    <footer>
      <button onclick={() => (result = null)} disabled={busy}>{t("import.otherFile")}</button>
      <span class="grow"></span>
      <button onclick={showUnsaved} disabled={busy}>{t("import.showOnly")}</button>
      <button class="primary" onclick={saveAndShow} disabled={busy || !store}>{t("import.saveShow")}</button>
    </footer>
  {:else}
    <label class="drop" class:dragging>
      <input type="file" accept=".ged,.gedcom,.json" onchange={(e) => { importFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
      {busy ? t("import.reading") : t("import.drop")}
    </label>

    <h3>{t("import.saved")}</h3>
    {#if saved.length}
      <ul class="trees">
        {#each saved as tree (tree.id)}
          <li>
            <span><strong>{tree.name}</strong> <small>{t("import.persons", { n: fmt(tree.personCount) })}</small></span>
            <span class="actions">
              <button class="primary" onclick={() => openSaved(tree)} disabled={busy}>{t("import.openTree")}</button>
              <button onclick={() => renameSaved(tree)}>{t("import.rename")}</button>
              <button onclick={() => deleteSaved(tree)}>{t("import.delete")}</button>
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dim">{t("import.noneSaved")}</p>
    {/if}
    <div class="backup">
      <button onclick={backupAll} disabled={busy || !store || !saved.length} title={t("import.backupAll.title")}>{t("import.backupAll")}</button>
      <label class="button" class:disabled={busy || !store} title={t("import.restore.title")}>
        {t("import.restore")}
        <input type="file" accept=".json" disabled={busy || !store} onchange={(e) => { restoreBackup(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
      </label>
    </div>
    {#if info}<p class="ok" role="status">{info}</p>{/if}
  {/if}
</dialog>

<style>
  dialog {
    width: min(42rem, calc(100vw - 2rem)); max-height: calc(100vh - 3rem); box-sizing: border-box;
    background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.25rem;
  }
  dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font-size: 1.2rem; }
  h3 { margin: 1.2rem 0 0.4rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  .drop {
    display: block; margin-top: 0.75rem; padding: 2rem 1rem; border: 2px dashed var(--line); border-radius: 8px;
    text-align: center; cursor: pointer; color: var(--dim);
  }
  .drop:hover, .drop.dragging { border-color: var(--accent); background: rgba(77, 208, 200, 0.08); color: var(--text); }
  .drop input { display: none; }
  .trees { list-style: none; padding: 0; margin: 0; }
  .trees li { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.4rem 0; border-top: 1px solid var(--line); }
  .actions { display: flex; gap: 0.4rem; }
  .list { max-height: 14rem; overflow: auto; margin: 0.3rem 0; padding-left: 1.2rem; font-size: 0.85rem; }
  .photos h3 { margin-top: 1rem; }
  .name { display: block; margin-top: 1rem; }
  .name input { display: block; width: 100%; box-sizing: border-box; margin-top: 0.2rem; }
  footer { display: flex; gap: 0.5rem; margin-top: 1rem; }
  .grow { flex: 1; }
  .backup { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }
  .button { display: inline-block; padding: 0.4rem 0.8rem; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
  .button:hover { border-color: var(--accent); }
  .button.disabled { opacity: 0.5; pointer-events: none; }
  .button input { display: none; }
  .error { color: var(--bad); }
  .warn { color: var(--warn); cursor: pointer; }
  .ok { color: #7bd88f; }
  .dim, small { color: var(--dim); }
</style>
