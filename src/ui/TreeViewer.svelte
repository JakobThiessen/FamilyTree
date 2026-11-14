<script lang="ts">
  // Dünne Hülle um die Zeichenfläche (src/render): Bedienelemente für Modus und Tiefe.
  // Der Oberflächenausbau (Suche, Details, Filterleiste) folgt in M7.
  import { onDestroy, onMount } from "svelte";
  import type { LayoutResult } from "../core/layout";
  import type { Person, TreeData, ViewRequest } from "../core/types";
  import { TreeView } from "../render";
  import type { DrawStats } from "../render";
  import { LayoutClient } from "../workers/layoutClient";

  let { data }: { data: TreeData } = $props();

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

  /** Neue Baumdaten: Worker und Personentabelle füllen, Fokus auf eine sinnvolle Person setzen. */
  async function loadData(d: TreeData) {
    if (!client || !view) return;
    const persons = new Map<string, Person>(d.persons.map((p) => [p.id, p]));
    view.setPersons(persons);
    await client.setData(d);
    await client.reset();
    last = null;
    focusId = d.persons[0]?.id ?? "";
    await show();
  }

  onMount(() => {
    client = new LayoutClient();
    view = new TreeView(canvas, {
      onFocus: (id) => {
        focusId = id;
        show();
      },
      // „+n“ klappt auf, indem die Tiefe bis zu dieser Karte erweitert wird (die Ansicht bleibt stehen).
      // Reicht die Tiefe schon (Partner oder Geschwister am Rand der Ansicht, siehe D17), wird die Person stattdessen Fokus.
      onExpand: (card, dir) => {
        if (dir === "up" && -card.node.layer + 1 > up) up = -card.node.layer + 1;
        else if (dir === "down" && card.node.layer + 1 > down) down = card.node.layer + 1;
        else focusId = card.node.personId;
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

  function randomPerson() {
    const p = data.persons[Math.floor(Math.random() * data.persons.length)];
    if (p) {
      focusId = p.id;
      show();
    }
  }

  const clampDepth = (v: number) => Math.max(0, Math.min(30, Math.round(v) || 0));
</script>

<section class="viewer">
  <div class="bar">
    <label>
      Ansicht
      <select bind:value={mode} onchange={show}>
        <option value="direct">Direkte Linie</option>
        <option value="family">Familie</option>
        <option value="all">Alle</option>
      </select>
    </label>
    <label>
      Vorfahren
      <input type="number" min="0" max="30" bind:value={up} onchange={() => { up = clampDepth(up); show(); }} />
    </label>
    <label>
      Nachfahren
      <input type="number" min="0" max="30" bind:value={down} onchange={() => { down = clampDepth(down); show(); }} />
    </label>
    <button onclick={() => view?.fit()}>Einpassen</button>
    <button onclick={() => view?.zoomBy(1.25)}>+</button>
    <button onclick={() => view?.zoomBy(0.8)}>−</button>
    <button onclick={randomPerson}>Zufällige Person</button>
    <span class="info">{info}{#if drawStats} · Zeichnen {drawStats.ms.toFixed(1)} ms ({drawStats.cards} Karten sichtbar){/if}</span>
  </div>
  {#if error}<p class="error">Fehler: {error}</p>{/if}
  <canvas bind:this={canvas}></canvas>
  <p class="hint">Ziehen = verschieben, Mausrad = zoomen, Klick auf Karte = Fokus wechseln, „+n“ = aufklappen.</p>
</section>

<style>
  .viewer { margin-top: 1rem; }
  .bar { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; margin-bottom: 0.5rem; }
  .bar input[type="number"] { width: 3.5rem; }
  .info { color: #9aa3bf; font-size: 0.85rem; }
  canvas { width: 100%; height: 70vh; display: block; border: 1px solid #2a3354; border-radius: 6px; cursor: grab; }
  .hint { color: #9aa3bf; font-size: 0.8rem; margin: 0.25rem 0 0; }
  .error { color: #d55; }
</style>
