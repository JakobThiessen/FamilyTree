<script lang="ts">
  // Reiter „Stammbaum“: Zeichenfläche (src/render) mit schwebendem Filterpanel links (einklappbar).
  // Die Hülle kennt Fokus und Ansicht; Suche und Details leben im Elternteil (App.svelte) und
  // wechseln den Fokus über `focusOn(id)`. Jeder Fokuswechsel meldet sich über `onFocusChange`.
  import { onDestroy, onMount } from "svelte";
  import { describeRelationship } from "../core";
  import type { FamilyGraph } from "../core";
  import type { TreeChanges } from "../core/edit";
  import type { LayoutResult } from "../core/layout";
  import type { Person, PersonId, TreeData, ViewRequest } from "../core/types";
  import { TreeView, COLORS, sceneToSvg } from "../render";
  import type { DrawStats, LineMode } from "../render";
  import { LayoutClient } from "../workers/layoutClient";
  import { fmt, i18n, t } from "./lang.svelte";
  import type { MessageKey } from "./i18n";
  import { errorText } from "./messages";

  let {
    data,
    graph,
    startId,
    onFocusChange,
    title = "",
  }: {
    data: TreeData;
    /** Verwandtschaftsgraph für die Rolle zur Fokusperson auf den Karten */
    graph: FamilyGraph | null;
    /** Fokus beim Aufbau, sonst die erste Person */
    startId?: PersonId;
    onFocusChange?: (id: PersonId) => void;
    /** Baumname, steht als Überschrift im Export */
    title?: string;
  } = $props();

  let canvas: HTMLCanvasElement;
  let view: TreeView | null = null;
  let client: LayoutClient | null = null;

  let focusId = $state("");
  let up = $state(2);
  let down = $state(2);
  let mode = $state<ViewRequest["mode"]>("family");
  let lineMode = $state<LineMode>("curved");
  let showUnconfirmed = $state(true);
  let showUnknown = $state(true);
  // Auf schmalen Fenstern startet das Filterpanel eingeklappt (sonst verdeckt es den Baum).
  let panelOpen = $state(typeof window === "undefined" || !window.matchMedia("(max-width: 800px)").matches);
  let layoutStats = $state<{ persons: number; ghosts: number; layers: number; ms: number } | null>(null);
  let error = $state("");
  let drawStats = $state<DrawStats | null>(null);
  let counts = $state({ visible: 0, total: 0 });
  let legend = $state<{ surname: string; color: string; n: number }[]>([]);
  let hasUnknownLine = $state(false);
  /** Textalternative zur Zeichenfläche: die Personen der Ansicht als Liste (nach Schicht, dann von links nach rechts) */
  let cardList = $state<{ id: string; name: string; dates: string; layer: number }[]>([]);
  let cardListMore = $state(0);
  const CARD_LIST_MAX = 60;

  const MODES: { value: ViewRequest["mode"]; label: MessageKey; hint: MessageKey }[] = [
    { value: "direct", label: "viewer.mode.direct", hint: "viewer.mode.direct.hint" },
    { value: "family", label: "viewer.mode.family", hint: "viewer.mode.family.hint" },
    { value: "all", label: "viewer.mode.all", hint: "viewer.mode.all.hint" },
  ];

  /** Nur die jüngste Anfrage zeigen (Antworten des Workers können sich überholen). */
  let ticket = 0;
  /** Letzte angezeigte Anfrage: gleicher Fokus und Modus = Kamera nicht bewegen (inkrementell). */
  let last: ViewRequest | null = null;
  let persons = new Map<string, Person>();

  /** Zähler und Familienlinien-Legende aus der aktuellen Szene (nach dem Filter). */
  function refreshPanel() {
    const scene = view?.scene;
    if (!view || !scene) return;
    counts = view.visibleCounts;
    const byColor = new Map<string, { surname: string; color: string; n: number }>();
    let unknown = false;
    for (const c of scene.cards) {
      const p = persons.get(c.node.personId);
      const surname = p?.surname?.trim();
      if (!surname) {
        unknown = true;
        continue;
      }
      const key = surname.toLowerCase();
      const e = byColor.get(key);
      if (e) e.n++;
      else byColor.set(key, { surname, color: c.color, n: 1 });
    }
    hasUnknownLine = unknown;
    legend = [...byColor.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const real = scene.cards.filter((c) => !c.node.ghost).sort((a, b) => a.node.layer - b.node.layer || a.node.x - b.node.x);
    cardList = real.slice(0, CARD_LIST_MAX).map((c) => ({ id: c.node.personId, name: c.name, dates: c.dates, layer: c.node.layer }));
    cardListMore = Math.max(0, real.length - CARD_LIST_MAX);
  }

  /** Tastatur auf der Zeichenfläche: Pfeile verschieben, + / − zoomen, 0 passt ein (WCAG 2.1.1). */
  function onCanvasKey(e: KeyboardEvent) {
    if (!view || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 240 : 80;
    let handled = true;
    switch (e.key) {
      case "ArrowLeft": view.camera.panBy(step, 0); break;
      case "ArrowRight": view.camera.panBy(-step, 0); break;
      case "ArrowUp": view.camera.panBy(0, step); break;
      case "ArrowDown": view.camera.panBy(0, -step); break;
      case "+": case "=": view.zoomBy(1.25); break;
      case "-": case "_": view.zoomBy(0.8); break;
      case "0": case "Home": view.fit(); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      view.invalidate();
    }
  }

  /** Ansage für Bildschirmleser bei Fokuswechsel und neuer Ansicht. */
  const announcement = $derived.by(() => {
    const p = persons.get(focusId);
    if (!p) return "";
    const name = [p.givenNames, p.surname].filter(Boolean).join(" ") || t("common.unknownName");
    return t("viewer.announce", { name, visible: counts.visible, total: counts.total });
  });

  async function show() {
    if (!client || !view || !focusId) return;
    const mine = ++ticket;
    const request: ViewRequest = { focusId, up, down, mode };
    try {
      const result: LayoutResult = await client.layout(request);
      if (mine !== ticket) return;
      const sameView = last !== null && last.focusId === request.focusId && last.mode === request.mode;
      last = request;
      view.setResult(result, !sameView);
      refreshPanel();
      error = "";
      layoutStats = result.stats;
    } catch (e) {
      error = errorText(e, i18n.lang);
    }
  }

  /** Setzt den Fokus (Klick, Suche, Detailfenster) und zeigt die Ansicht neu. */
  export function focusOn(id: PersonId) {
    focusId = id;
    onFocusChange?.(id);
    show();
  }

  /** Neue Baumdaten: Worker und Personentabelle füllen, Fokus auf eine sinnvolle Person setzen. */
  async function loadData(d: TreeData) {
    if (!client || !view) return;
    persons = new Map<string, Person>(d.persons.map((p) => [p.id, p]));
    view.setPersons(persons);
    await client.setData(d);
    await client.reset();
    last = null;
    const first = startId && persons.has(startId) ? startId : (d.persons[0]?.id ?? "");
    focusId = first;
    if (first) onFocusChange?.(first);
    await show();
  }

  /**
   * Geänderte Baumdaten (Bearbeiten, Undo/Redo): Worker und Personentabelle nachführen und neu zeichnen, ohne
   * die Kamera zu bewegen. Steht die Fokusperson nicht mehr im Baum, wird `fallbackId` (Nachbar) oder die erste
   * Person Fokus; dann passt sich die Ansicht neu an.
   */
  export async function updateData(d: TreeData, changes?: TreeChanges, fallbackId?: PersonId) {
    if (!client || !view) return;
    persons = new Map<string, Person>(d.persons.map((p) => [p.id, p]));
    view.setPersons(persons);
    // Nur die Änderungen an den Worker: den ganzen Baum zu kopieren dauert bei 50.000 Personen ca. 500 ms.
    if (changes) {
      try {
        await client.applyChanges(changes);
      } catch {
        await client.setData(d); // Worker-Stand passt nicht: ganzen Baum senden
      }
    } else await client.setData(d);
    await client.reset(); // Worker rechnet neu; `last` bleibt, damit setResult die Kamera nicht zurücksetzt
    if (!persons.has(focusId)) {
      focusId = fallbackId && persons.has(fallbackId) ? fallbackId : (d.persons[0]?.id ?? "");
      last = null;
      onFocusChange?.(focusId);
    }
    if (focusId) await show();
  }

  /** Rolle der Person zur Fokusperson; „nicht verwandt“ zeigen wir nicht. */
  function roleOf(personId: PersonId): string | undefined {
    if (!graph || !focusId || personId === focusId) return undefined;
    try {
      const rel = describeRelationship(graph, personId, focusId, { lang: i18n.lang });
      return rel.blood.length || rel.partner || rel.inLaw.length ? rel.label : undefined; // „nicht verwandt“ zeigen wir nicht
    } catch {
      return undefined;
    }
  }

  onMount(() => {
    client = new LayoutClient();
    view = new TreeView(canvas, {
      onFocus: (id) => focusOn(id),
      // „+n“ klappt auf, indem die Tiefe bis zu dieser Karte erweitert wird (die Ansicht bleibt stehen).
      // Reicht die Tiefe schon (Partner oder Geschwister am Rand der Ansicht, siehe D17), wird die Person stattdessen Fokus.
      onExpand: (card, dir) => {
        if (dir === "up" && -card.node.layer + 1 > up) up = -card.node.layer + 1;
        else if (dir === "down" && card.node.layer + 1 > down) down = card.node.layer + 1;
        else {
          focusOn(card.node.personId);
          return;
        }
        show();
      },
      onDraw: (s) => (drawStats = s),
      roleOf,
    });
    loadData(data);
  });

  // Sprache gewechselt: Namen und Rollen auf den Karten neu aufbauen.
  $effect(() => {
    void i18n.lang;
    view?.refreshLabels();
    refreshPanel();
  });

  // Das Panel schwebt über der Zeichenfläche: beim Einpassen den Platz links freilassen (nicht auf schmalen Fenstern).
  $effect(() => {
    view?.setInset(panelOpen && window.innerWidth > 800 ? 264 : 0);
  });

  /** Export-Titel: Baumname und Fokusperson. */
  function exportTitle(): string {
    const p = persons.get(focusId);
    const who = p ? [p.givenNames, p.surname].filter(Boolean).join(" ") : "";
    return [title, who && t("viewer.focusPrefix", { name: who })].filter(Boolean).join(" – ");
  }

  /** Die ganze aktuelle Ansicht (nicht nur den Bildschirmausschnitt) als SVG-Datei laden. */
  function exportSvg() {
    const scene = view?.scene;
    if (!scene) return;
    const { svg } = sceneToSvg(scene, { theme: "light", title: exportTitle() });
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "stammbaum").replace(/\.[^.]+$/, "")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Drucken / als PDF speichern: das SVG kommt in einen Druckbereich (#print-root, siehe app.css),
   * die Seite wird passend zum Seitenverhältnis quer oder hoch gestellt. Im Druckdialog des Browsers
   * „Als PDF speichern“ wählen.
   */
  function printView() {
    const scene = view?.scene;
    if (!scene) return;
    const { svg, width, height } = sceneToSvg(scene, { theme: "light", title: exportTitle() });
    const root = document.createElement("div");
    root.id = "print-root";
    root.innerHTML = svg;
    const style = document.createElement("style");
    style.textContent = `@page { size: A4 ${width >= height ? "landscape" : "portrait"}; margin: 10mm; }`;
    document.body.append(root, style);
    const cleanup = () => {
      root.remove();
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  onDestroy(() => {
    view?.dispose();
    client?.dispose();
  });

  const clampDepth = (v: number) => Math.max(0, Math.min(30, Math.round(v) || 0));
  const setMode = (m: ViewRequest["mode"]) => {
    mode = m;
    show();
  };
  /** Linienführung und Filter wirken nur auf die Szene, das Layout bleibt (kein neuer Worker-Aufruf). */
  function applyOptions() {
    view?.setOptions({ lineMode, showUnconfirmed, showUnknown });
    refreshPanel();
  }

  // Standardwerte des Filters; „zurücksetzen“ stellt sie wieder her, „ganzen Baum“ hebt alle Einschränkungen auf.
  const DEFAULTS = { up: 2, down: 2, mode: "family" as ViewRequest["mode"] };
  /** Ab so vielen Personen im Baum wird „ganzen Baum zeigen“ in der Tiefe begrenzt (Leistung, D22). */
  const BIG_TREE = 3000;
  const BIG_TREE_DEPTH = 6;
  let depthLimited = $state(false);

  const filterChanged = $derived(
    up !== DEFAULTS.up || down !== DEFAULTS.down || mode !== DEFAULTS.mode || !showUnconfirmed || !showUnknown,
  );

  function resetFilter() {
    up = DEFAULTS.up;
    down = DEFAULTS.down;
    mode = DEFAULTS.mode;
    showUnconfirmed = true;
    showUnknown = true;
    depthLimited = false;
    applyOptions();
    show();
  }

  /** Ansicht „alles“: alle Personen im Fenster, unbestätigte und unbekannte sichtbar; bei großen Bäumen nur bis Tiefe 6. */
  function showWholeTree() {
    const big = data.persons.length > BIG_TREE;
    depthLimited = big;
    up = down = big ? BIG_TREE_DEPTH : 30;
    mode = "all";
    showUnconfirmed = true;
    showUnknown = true;
    applyOptions();
    show();
  }
</script>

<section class="viewer">
  <!-- Die Zeichenfläche ist per Tab erreichbar und mit der Tastatur bedienbar; die Liste darunter ist ihre Textalternative. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_interactive_element_to_noninteractive_role -->
  <canvas
    bind:this={canvas}
    tabindex="0"
    role="application"
    aria-label={t("viewer.canvas.label")}
    aria-describedby="viewer-help"
    onkeydown={onCanvasKey}
  ></canvas>
  <p id="viewer-help" class="sr-only">{t("viewer.canvas.help")}</p>
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
  <nav class="sr-only" aria-label={t("viewer.list.title")}>
    <h2>{t("viewer.list.title")}</h2>
    <ul>
      {#each cardList as c (c.id)}
        <li><button class="link" onclick={() => focusOn(c.id)}>{c.name} {c.dates}</button></li>
      {/each}
      {#if cardListMore}<li>{t("viewer.list.more", { n: cardListMore })}</li>{/if}
    </ul>
  </nav>

  <aside class="panel" class:closed={!panelOpen}>
    <button class="fold" onclick={() => (panelOpen = !panelOpen)} aria-expanded={panelOpen} title={panelOpen ? t("viewer.filter.collapse") : t("viewer.filter.expand")}>
      {panelOpen ? "‹" : "›"} {t("viewer.filter")}
    </button>
    {#if panelOpen}
      <div class="seg" role="group" aria-label={t("viewer.filter")}>
        {#each MODES as m (m.value)}
          <button class:on={mode === m.value} aria-pressed={mode === m.value} title={t(m.hint)} onclick={() => setMode(m.value)}>
            {t(m.label)}
          </button>
        {/each}
      </div>
      <p class="count" aria-live="polite">{@html t("viewer.count", { visible: `<strong>${counts.visible}</strong>`, total: counts.total })}</p>

      <label class="switch"><input type="checkbox" bind:checked={showUnconfirmed} onchange={applyOptions} /> {t("viewer.unconfirmed")}</label>
      <label class="switch"><input type="checkbox" bind:checked={showUnknown} onchange={applyOptions} /> {t("viewer.unknown")}</label>

      <div class="depth">
        <label>{t("viewer.ancestors")} <input type="number" min="0" max="30" bind:value={up} onchange={() => { up = clampDepth(up); show(); }} /></label>
        <label>{t("viewer.descendants")} <input type="number" min="0" max="30" bind:value={down} onchange={() => { down = clampDepth(down); show(); }} /></label>
      </div>

      <div class="reset">
        <button onclick={resetFilter} disabled={!filterChanged} title={t("viewer.reset.title")}>{t("viewer.reset")}</button>
        <button onclick={showWholeTree} title={t("viewer.whole.title")}>{t("viewer.whole")}</button>
      </div>
      {#if depthLimited && mode === "all" && up === BIG_TREE_DEPTH && down === BIG_TREE_DEPTH}<p class="note">{t("viewer.whole.limited", { depth: BIG_TREE_DEPTH, total: data.persons.length })}</p>{/if}

      <h3>{t("viewer.lines.title")}</h3>
      <ul class="legend">
        {#each legend as l (l.surname)}
          <li><i style:background={l.color}></i>{l.surname} <small>{l.n}</small></li>
        {/each}
        {#if hasUnknownLine}<li><i style:background="#7d86a3"></i>{t("viewer.lines.unknown")}</li>{/if}
      </ul>

      <h3>{t("viewer.edges.title")}</h3>
      <div class="seg" role="group" aria-label={t("viewer.edges.group")}>
        <button class:on={lineMode === "curved"} aria-pressed={lineMode === "curved"} onclick={() => { lineMode = "curved"; applyOptions(); }}>{t("viewer.edges.curved")}</button>
        <button class:on={lineMode === "orthogonal"} aria-pressed={lineMode === "orthogonal"} onclick={() => { lineMode = "orthogonal"; applyOptions(); }}>{t("viewer.edges.orthogonal")}</button>
      </div>
      <ul class="legend styles">
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeNeutral} stroke-width="2" /></svg>{t("viewer.edges.proven")}</li>
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeNeutral} stroke-width="2" stroke-dasharray="6 4" /></svg>{t("viewer.edges.assumed")}</li>
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeNeutral} stroke-width="2" stroke-dasharray="2 4" /></svg>{t("viewer.edges.adopted")}</li>
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeUp} stroke-width="3" /></svg>{t("viewer.edges.up")}</li>
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeDown} stroke-width="3" /></svg>{t("viewer.edges.down")}</li>
      </ul>
    {/if}
  </aside>

  <div class="zoom">
    <button onclick={() => view?.fit()} title={t("viewer.fit.title")}>{t("viewer.fit")}</button>
    <button onclick={() => view?.zoomBy(1.25)} aria-label={t("viewer.zoomIn")}>+</button>
    <button onclick={() => view?.zoomBy(0.8)} aria-label={t("viewer.zoomOut")}>−</button>
    <button class="desk" onclick={exportSvg} title={t("viewer.svg.title")}>SVG</button>
    <button class="desk" onclick={printView} title={t("viewer.print.title")}>{t("viewer.print")}</button>
  </div>

  {#if error}<p class="error">{t("viewer.error", { error })}</p>{/if}
  <p class="hint">
    {t("viewer.hint")}
    <span class="info">{#if layoutStats}{t("viewer.info", { persons: layoutStats.persons, ghosts: layoutStats.ghosts, layers: layoutStats.layers, ms: fmt(layoutStats.ms, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })}{/if}{#if drawStats}{t("viewer.drawInfo", { ms: fmt(drawStats.ms, { maximumFractionDigits: 1, minimumFractionDigits: 1 }), cards: drawStats.cards })}{/if}</span>
  </p>
</section>

<style>
  .viewer { position: relative; min-height: 0; min-width: 0; height: 100%; overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }

  .panel {
    position: absolute; top: 0.75rem; left: 0.75rem; width: 15.5rem; max-height: calc(100% - 3.5rem); overflow: auto;
    box-sizing: border-box; padding: 0.6rem; display: flex; flex-direction: column; gap: 0.6rem;
    background: color-mix(in srgb, var(--panel) 90%, transparent); backdrop-filter: blur(6px);
    border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 28px #0008;
  }
  .panel.closed { width: auto; padding: 0.3rem; }
  .fold { align-self: flex-start; border-radius: 10px; }
  .seg { display: flex; }
  .seg button { flex: 1; border-radius: 0; margin: 0; padding: 0.3rem 0.35rem; font-size: 0.85rem; }
  .seg button:first-child { border-radius: 8px 0 0 8px; }
  .seg button:last-child { border-radius: 0 8px 8px 0; }
  .seg button + button { border-left: 0; }
  .seg button.on { background: var(--accent); color: #07110f; border-color: var(--accent); }
  .count { margin: 0; color: var(--dim); font-size: 0.9rem; }
  .count :global(strong) { color: var(--text); }
  .switch { display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; cursor: pointer; }
  .switch input { accent-color: var(--accent); }
  .depth { display: flex; gap: 0.5rem; font-size: 0.85rem; color: var(--dim); }
  .depth label { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; }
  .depth input { width: 100%; box-sizing: border-box; }
  .reset { display: flex; gap: 0.4rem; }
  .reset button { flex: 1; padding: 0.3rem 0.35rem; font-size: 0.85rem; }
  .note { margin: 0; font-size: 0.8rem; color: var(--dim); }
  h3 { margin: 0.2rem 0 0; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); }
  .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.88rem; }
  .legend li { display: flex; align-items: center; gap: 0.5rem; }
  .legend i { width: 0.8rem; height: 0.8rem; border-radius: 50%; flex: none; }
  .legend small { color: var(--dim); margin-left: auto; }

  .zoom { position: absolute; right: 0.75rem; bottom: 2.5rem; display: flex; flex-direction: column; gap: 0.3rem; }
  .hint {
    position: absolute; left: 0; right: 0; bottom: 0; margin: 0; padding: 0.3rem 0.75rem;
    color: var(--dim); font-size: 0.78rem; background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .info { float: right; }
  canvas:focus-visible { outline-offset: -3px; }
  .error { position: absolute; top: 0.75rem; right: 0.75rem; margin: 0; color: var(--bad); background: var(--panel); padding: 0.3rem 0.6rem; border-radius: 8px; }
  @media (max-width: 800px) {
    .panel { width: min(15.5rem, calc(100% - 1.5rem)); }
    .info, .hint, .zoom .desk { display: none; }
    .zoom { bottom: 0.75rem; }
  }
</style>
