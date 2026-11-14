<script lang="ts">
  // Zeichenfläche (src/render) plus Bedienleiste: Filter, Tiefe, Zoom.
  // Die Hülle kennt Fokus und Ansicht; Suche und Details leben im Elternteil (App.svelte) und
  // wechseln den Fokus über `focusOn(id)`. Jeder Fokuswechsel meldet sich über `onFocusChange`.
  import { onDestroy, onMount } from "svelte";
  import type { LayoutResult } from "../core/layout";
  import type { Person, PersonId, TreeData, ViewRequest } from "../core/types";
  import { TreeView } from "../render";
  import type { DrawStats } from "../render";
  import { LayoutClient } from "../workers/layoutClient";

  let {
    data,
    startId,
    onFocusChange,
  }: { data: TreeData; /** Fokus beim Aufbau, sonst die erste Person */ startId?: PersonId; onFocusChange?: (id: PersonId) => void } = $props();

  let canvas: HTMLCanvasElement;
  let view: TreeView | null = null;
  let client: LayoutClient | null = null;

  let focusId = $state("");
  let up = $state(2);
  let down = $state(2);
  let mode = $state<ViewRequest["mode"]>("family");
  let info = $state("");
  let error = $state("");
  let drawStats = $state<DrawStats | null>(null);

  const MODES: { value: ViewRequest["mode"]; label: string; hint: string }[] = [
    { value: "direct", label: "Direkte Linie", hint: "Nur die Person, ihre Vorfahren und Nachfahren" },
    { value: "family", label: "Familie", hint: "Zusätzlich Partner, Geschwister und Halbgeschwister" },
    { value: "all", label: "Alle", hint: "Alles Verwandte im Tiefenfenster (bei dichten Verwandtschaften sehr breit)" },
  ];

  /** Nur die jüngste Anfrage zeigen (Antworten des Workers können sich überholen). */
  let ticket = 0;
  /** Letzte angezeigte Anfrage: gleicher Fokus und Modus = Kamera nicht bewegen (inkrementell). */
  let last: ViewRequest | null = null;

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
    const persons = new Map<string, Person>(d.persons.map((p) => [p.id, p]));
    view.setPersons(persons);
    await client.setData(d);
    await client.reset();
    last = null;
    const first = startId && persons.has(startId) ? startId : (d.persons[0]?.id ?? "");
    focusId = first;
    if (first) onFocusChange?.(first);
    await show();
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
    });
    loadData(data);
  });

  onDestroy(() => {
    view?.dispose();
    client?.dispose();
  });

  const clampDepth = (v: number) => Math.max(0, Math.min(30, Math.round(v) || 0));
  const setMode = (m: ViewRequest["mode"]) => {
    mode = m;
    show();
  };
</script>

<section class="viewer">
  <div class="bar">
    <div class="seg" role="group" aria-label="Filter">
      {#each MODES as m (m.value)}
        <button class:on={mode === m.value} aria-pressed={mode === m.value} title={m.hint} onclick={() => setMode(m.value)}>
          {m.label}
        </button>
      {/each}
    </div>
    <label>
      Vorfahren
      <input type="number" min="0" max="30" bind:value={up} onchange={() => { up = clampDepth(up); show(); }} />
    </label>
    <label>
      Nachfahren
      <input type="number" min="0" max="30" bind:value={down} onchange={() => { down = clampDepth(down); show(); }} />
    </label>
    <span class="grow"></span>
    <button onclick={() => view?.fit()} title="Ganze Ansicht einpassen">Einpassen</button>
    <button onclick={() => view?.zoomBy(1.25)} aria-label="Hineinzoomen">+</button>
    <button onclick={() => view?.zoomBy(0.8)} aria-label="Herauszoomen">−</button>
  </div>
  {#if error}<p class="error">Fehler: {error}</p>{/if}
  <canvas bind:this={canvas}></canvas>
  <p class="hint">
    Ziehen = verschieben · Mausrad = zoomen · Klick auf Karte = Fokus wechseln · „+n“ = aufklappen
    <span class="info">{info}{#if drawStats} · Zeichnen {drawStats.ms.toFixed(1)} ms ({drawStats.cards} sichtbar){/if}</span>
  </p>
</section>

<style>
  .viewer { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; }
  .bar { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line); }
  .bar input[type="number"] { width: 3.5rem; }
  .grow { flex: 1; }
  .seg { display: inline-flex; }
  .seg button { border-radius: 0; margin: 0; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; }
  .seg button + button { border-left: 0; }
  .seg button.on { background: var(--accent); color: #07110f; border-color: var(--accent); }
  canvas { flex: 1; min-height: 0; width: 100%; display: block; cursor: grab; }
  .hint { color: var(--dim); font-size: 0.78rem; margin: 0; padding: 0.3rem 0.75rem; border-top: 1px solid var(--line); }
  .info { float: right; }
  .error { color: var(--bad); margin: 0.3rem 0.75rem; }
</style>
