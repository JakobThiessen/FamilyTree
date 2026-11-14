<script lang="ts">
  // Reiter „Stammbaum“: Zeichenfläche (src/render) mit schwebendem Filterpanel links (einklappbar).
  // Die Hülle kennt Fokus und Ansicht; Suche und Details leben im Elternteil (App.svelte) und
  // wechseln den Fokus über `focusOn(id)`. Jeder Fokuswechsel meldet sich über `onFocusChange`.
  import { onDestroy, onMount } from "svelte";
  import { describeRelationship } from "../core";
  import type { FamilyGraph } from "../core";
  import type { LayoutResult } from "../core/layout";
  import type { Person, PersonId, TreeData, ViewRequest } from "../core/types";
  import { TreeView, COLORS, sceneToSvg } from "../render";
  import type { DrawStats, LineMode } from "../render";
  import { LayoutClient } from "../workers/layoutClient";

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
  let panelOpen = $state(true);
  let info = $state("");
  let error = $state("");
  let drawStats = $state<DrawStats | null>(null);
  let counts = $state({ visible: 0, total: 0 });
  let legend = $state<{ surname: string; color: string; n: number }[]>([]);
  let hasUnknownLine = $state(false);

  const MODES: { value: ViewRequest["mode"]; label: string; hint: string }[] = [
    { value: "direct", label: "Direkte Linie", hint: "Nur die Person, ihre Vorfahren und Nachfahren" },
    { value: "family", label: "Familie", hint: "Zusätzlich Partner, Geschwister und Halbgeschwister" },
    { value: "all", label: "Alle", hint: "Alles Verwandte im Tiefenfenster (bei dichten Verwandtschaften sehr breit)" },
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
  }

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
      info = `${result.stats.persons} Karten (${result.stats.ghosts} Geister), ${result.stats.layers} Schichten, Layout ${result.stats.ms.toFixed(1)} ms`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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

  /** Rolle der Person zur Fokusperson; „nicht verwandt“ zeigen wir nicht. */
  function roleOf(personId: PersonId): string | undefined {
    if (!graph || !focusId || personId === focusId) return undefined;
    try {
      const label = describeRelationship(graph, personId, focusId).label;
      return label === "nicht verwandt" ? undefined : label;
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

  // Das Panel schwebt über der Zeichenfläche: beim Einpassen den Platz links freilassen (nicht auf schmalen Fenstern).
  $effect(() => {
    view?.setInset(panelOpen && window.innerWidth > 800 ? 264 : 0);
  });

  /** Export-Titel: Baumname und Fokusperson. */
  function exportTitle(): string {
    const p = persons.get(focusId);
    const who = p ? [p.givenNames, p.surname].filter(Boolean).join(" ") : "";
    return [title, who && `Fokus: ${who}`].filter(Boolean).join(" – ");
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
</script>

<section class="viewer">
  <canvas bind:this={canvas}></canvas>

  <aside class="panel" class:closed={!panelOpen}>
    <button class="fold" onclick={() => (panelOpen = !panelOpen)} aria-expanded={panelOpen} title={panelOpen ? "Filter einklappen" : "Filter ausklappen"}>
      {panelOpen ? "‹ Filter" : "› Filter"}
    </button>
    {#if panelOpen}
      <div class="seg" role="group" aria-label="Filter">
        {#each MODES as m (m.value)}
          <button class:on={mode === m.value} aria-pressed={mode === m.value} title={m.hint} onclick={() => setMode(m.value)}>
            {m.label}
          </button>
        {/each}
      </div>
      <p class="count" aria-live="polite"><strong>{counts.visible}</strong> von {counts.total} Personen sichtbar</p>

      <label class="switch"><input type="checkbox" bind:checked={showUnconfirmed} onchange={applyOptions} /> Unbestätigte Verbindungen</label>
      <label class="switch"><input type="checkbox" bind:checked={showUnknown} onchange={applyOptions} /> Unbekannte Personen</label>

      <div class="depth">
        <label>Vorfahren <input type="number" min="0" max="30" bind:value={up} onchange={() => { up = clampDepth(up); show(); }} /></label>
        <label>Nachfahren <input type="number" min="0" max="30" bind:value={down} onchange={() => { down = clampDepth(down); show(); }} /></label>
      </div>

      <h3>Familienlinien</h3>
      <ul class="legend">
        {#each legend as l (l.surname)}
          <li><i style:background={l.color}></i>{l.surname} <small>{l.n}</small></li>
        {/each}
        {#if hasUnknownLine}<li><i style:background="#7d86a3"></i>Linie: Name unbekannt</li>{/if}
      </ul>

      <h3>Linien</h3>
      <div class="seg" role="group" aria-label="Linienführung">
        <button class:on={lineMode === "curved"} aria-pressed={lineMode === "curved"} onclick={() => { lineMode = "curved"; applyOptions(); }}>geschwungen</button>
        <button class:on={lineMode === "orthogonal"} aria-pressed={lineMode === "orthogonal"} onclick={() => { lineMode = "orthogonal"; applyOptions(); }}>rechtwinklig</button>
      </div>
      <ul class="legend styles">
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeNeutral} stroke-width="2" /></svg>belegt</li>
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeNeutral} stroke-width="2" stroke-dasharray="6 4" /></svg>unbestätigt</li>
        <li><svg width="30" height="8"><line x1="0" y1="4" x2="30" y2="4" stroke={COLORS.edgeNeutral} stroke-width="2" stroke-dasharray="2 4" /></svg>Adoption / Pflege</li>
      </ul>
    {/if}
  </aside>

  <div class="zoom">
    <button onclick={() => view?.fit()} title="Ganze Ansicht einpassen">Einpassen</button>
    <button onclick={() => view?.zoomBy(1.25)} aria-label="Hineinzoomen">+</button>
    <button onclick={() => view?.zoomBy(0.8)} aria-label="Herauszoomen">−</button>
    <button onclick={exportSvg} title="Ganze Ansicht als SVG-Datei speichern">SVG</button>
    <button onclick={printView} title="Ansicht drucken oder als PDF speichern">Druck</button>
  </div>

  {#if error}<p class="error">Fehler: {error}</p>{/if}
  <p class="hint">
    Ziehen = verschieben · Mausrad = zoomen · Klick auf Karte = Fokus wechseln · „+n“ = aufklappen
    <span class="info">{info}{#if drawStats} · Zeichnen {drawStats.ms.toFixed(1)} ms ({drawStats.cards} sichtbar){/if}</span>
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
  .count strong { color: var(--text); }
  .switch { display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; cursor: pointer; }
  .switch input { accent-color: var(--accent); }
  .depth { display: flex; gap: 0.5rem; font-size: 0.85rem; color: var(--dim); }
  .depth label { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; }
  .depth input { width: 100%; box-sizing: border-box; }
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
  .error { position: absolute; top: 0.75rem; right: 0.75rem; margin: 0; color: var(--bad); background: var(--panel); padding: 0.3rem 0.6rem; border-radius: 8px; }
  @media (max-width: 800px) {
    .panel { width: 12.5rem; }
    .info { display: none; }
  }
</style>
