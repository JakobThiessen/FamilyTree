<script lang="ts">
  // Reiter „Karte“: Orte und Lebenswege auf einer mitgelieferten Offline-Weltkarte (SVG, D31).
  // Berechnung in src/core/places.ts. Koordinaten fehlen oft (GEDCOM); auf Knopfdruck werden sie bei Wikidata
  // gesucht (nur Ortsnamen gehen raus) und lokal im Browser gemerkt. Solche Orte gelten als „vermutet“.
  import { onDestroy } from "svelte";
  import { collectPlaces, lifePaths, placeKey, timelinePersonIds } from "../core";
  import type { Coordinates, FamilyGraph, KnownPlaces, PersonId, TimelineScope } from "../core";
  import { lookupPlaces } from "../providers";
  import { lineColor } from "../render/style";
  import { INLAND_SEAS, LAND, MAP_BOUNDS } from "./worldMap";
  import type { Ring } from "./worldMap";

  let { graph, focusId, onPick }: { graph: FamilyGraph | null; focusId: PersonId; onPick: (id: PersonId) => void } = $props();

  type Mode = "places" | "paths";
  let mode = $state<Mode>("places");
  let scope = $state<TimelineScope>("lineage");
  let depth = $state(5);
  let selectedKey = $state<string | null>(null);
  let selectedPerson = $state<PersonId | null>(null);

  // ---- Zwischenspeicher gefundener Koordinaten (localStorage, pro Browser, nicht pro Baum) ----
  const STORE_KEY = "familytree.placeCoords.v1";
  type Cached = { lat: number; lon: number; label?: string; qid?: string } | null; // null = nichts gefunden
  function readCache(): Record<string, Cached> {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }
  let cache = $state.raw<Record<string, Cached>>(readCache());
  const known = $derived.by<KnownPlaces>(() => {
    const m = new Map<string, Coordinates>();
    for (const [k, v] of Object.entries(cache)) if (v) m.set(k, { lat: v.lat, lon: v.lon });
    return m;
  });
  function saveCache(next: Record<string, Cached>) {
    cache = next;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* Speicher voll oder gesperrt: Ergebnis gilt dann nur für diese Sitzung */
    }
  }

  // ---- Daten ----
  const LIST_MAX = 300;
  const MARKER_MAX = 2000;
  const PATH_MAX = 400;
  const ids = $derived(graph && focusId && graph.hasPerson(focusId) ? timelinePersonIds(graph, focusId, scope, depth) : []);
  const places = $derived(graph ? collectPlaces(graph, ids, known) : []);
  const paths = $derived(graph ? lifePaths(graph, ids, known) : []);
  const located = $derived(places.filter((p) => p.coords));
  const missing = $derived(places.filter((p) => !p.coords && cache[p.key] === undefined));
  const selectedPath = $derived(paths.find((p) => p.personId === selectedPerson));

  // ---- Wikidata-Abfrage ----
  const BATCH = 25;
  let busy = $state(false);
  let progress = $state("");
  let lookupError = $state("");
  let abort: AbortController | null = null;
  onDestroy(() => abort?.abort());

  async function resolveMissing() {
    if (busy || !missing.length) return;
    const batch = missing.slice(0, BATCH);
    busy = true;
    lookupError = "";
    abort = new AbortController();
    let done = 0;
    const next = { ...cache };
    try {
      await lookupPlaces(batch.map((p) => p.name), { signal: abort.signal }, (name, m) => {
        const key = placeKey(name);
        next[key] = m ? { lat: m.lat, lon: m.lon, label: m.label, qid: m.qid } : null;
        progress = `${++done} von ${batch.length}: ${name}`;
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) lookupError = e instanceof Error ? e.message : String(e);
    } finally {
      saveCache(next); // auch Teilergebnisse behalten
      busy = false;
      progress = "";
    }
  }

  // ---- Karte: Ausschnitt, Zoomen, Verschieben ----
  const W = MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon;
  const H = MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat;
  const ASPECT = W / H;
  let vb = $state<{ x: number; y: number; w: number; h: number }>({ x: MAP_BOUNDS.minLon, y: -MAP_BOUNDS.maxLat, w: W, h: H });
  let svgEl: SVGSVGElement | undefined = $state();
  let cw = $state(800);
  let ch = $state(400);
  /** Pixel pro Kartenpunkt: hält Marken und Linien unabhängig vom Zoom gleich groß */
  const scale = $derived(Math.min(cw / vb.w, ch / vb.h) || 1);

  const px = (n: number) => n / scale;
  const ring = (r: Ring) => r.map(([lon, lat]) => `${lon},${-lat}`).join(" ");

  function fit(points: Coordinates[]) {
    if (!points.length) {
      vb = { x: MAP_BOUNDS.minLon, y: -MAP_BOUNDS.maxLat, w: W, h: H };
      return;
    }
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const p of points) {
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    }
    let w = Math.max(maxLon - minLon, 6) * 1.3;
    let h = Math.max(maxLat - minLat, 6 / ASPECT) * 1.3;
    if (w / h < ASPECT) w = h * ASPECT; else h = w / ASPECT;
    w = Math.min(w, W); h = Math.min(h, H);
    vb = { x: (minLon + maxLon) / 2 - w / 2, y: -((minLat + maxLat) / 2) - h / 2, w, h };
  }
  const fitAll = () => fit(located.map((p) => p.coords!));

  // Beim Wechsel der Auswahl oder des Fokus neu einpassen (nicht bei jedem Zwischenergebnis der Abfrage)
  let fitted = "";
  $effect(() => {
    const sig = `${focusId}|${scope}|${depth}|${mode}`;
    if (sig !== fitted && placesReady) {
      fitted = sig;
      fitAll();
    }
  });
  const placesReady = $derived(places.length >= 0 && graph !== null);

  function toMap(clientX: number, clientY: number): { x: number; y: number } {
    const r = svgEl!.getBoundingClientRect();
    const k = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = (r.width - vb.w * k) / 2;
    const oy = (r.height - vb.h * k) / 2;
    return { x: vb.x + (clientX - r.left - ox) / k, y: vb.y + (clientY - r.top - oy) / k };
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const f = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(Math.max(vb.w * f, 1), W);
    const h = w / ASPECT;
    const p = toMap(e.clientX, e.clientY);
    vb = { x: p.x - ((p.x - vb.x) * w) / vb.w, y: p.y - ((p.y - vb.y) * h) / vb.h, w, h };
  }
  let drag: { x: number; y: number } | null = null;
  function onDown(e: PointerEvent) {
    drag = { x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!drag) return;
    vb = { ...vb, x: vb.x - (e.clientX - drag.x) / scale, y: vb.y - (e.clientY - drag.y) / scale };
    drag = { x: e.clientX, y: e.clientY };
  }
  const onUp = () => (drag = null);
  function zoomBy(f: number) {
    const w = Math.min(Math.max(vb.w * f, 1), W);
    const h = w / ASPECT;
    vb = { x: vb.x + (vb.w - w) / 2, y: vb.y + (vb.h - h) / 2, w, h };
  }

  function selectPlace(key: string) {
    selectedKey = selectedKey === key ? null : key;
    const c = places.find((p) => p.key === key)?.coords;
    if (c && selectedKey) vb = { ...vb, x: c.lon - vb.w / 2, y: -c.lat - vb.h / 2 };
  }
  function selectPerson(id: PersonId) {
    selectedPerson = selectedPerson === id ? null : id;
    const stops = paths.find((p) => p.personId === id)?.stops.flatMap((s) => (s.coords ? [s.coords] : [])) ?? [];
    if (selectedPerson && stops.length) fit(stops);
  }

  const kindLabel = { birth: "Geburt", death: "Tod", union: "Heirat/Partnerschaft" } as const;
  const polyline = (coords: Coordinates[]) => coords.map((c) => `${c.lon},${-c.lat}`).join(" ");
  // Nur so viele Lebenswege zeichnen, wie die Grenze erlaubt (bei „Alle“ in großen Bäumen sonst Zehntausende)
  const drawnPaths = $derived.by(() => {
    const out: { p: (typeof paths)[number]; pts: Coordinates[] }[] = [];
    for (const p of paths) {
      const pts = p.stops.flatMap((s) => (s.coords ? [s.coords] : []));
      if (pts.length >= 2) out.push({ p, pts });
      if (out.length >= PATH_MAX) break;
    }
    return out;
  });
  const radius = (persons: number) => 4 + Math.min(Math.sqrt(persons) * 1.6, 12);
</script>

{#if !graph || !focusId}
  <p class="empty">Keine Person gewählt. Im Stammbaum eine Person anklicken oder über die Suche wählen.</p>
{:else}
  <div class="wrap">
    <aside>
      <div class="controls">
        <div class="seg" role="group" aria-label="Darstellung">
          <button class:on={mode === "places"} onclick={() => (mode = "places")}>Orte</button>
          <button class:on={mode === "paths"} onclick={() => (mode = "paths")}>Lebenswege</button>
        </div>
        <label>Auswahl
          <select bind:value={scope}>
            <option value="lineage">Fokus, Vorfahren, Nachfahren</option>
            <option value="all">Alle Personen</option>
          </select>
        </label>
        {#if scope === "lineage"}
          <label>Tiefe
            <select bind:value={depth}>{#each [1, 2, 3, 5, 8, 12, 20] as d}<option value={d}>{d} Generationen</option>{/each}</select>
          </label>
        {/if}
      </div>

      <p class="dim stat">
        {places.length} Orte, {located.length} mit Koordinaten · {paths.length} Lebenswege
      </p>
      {#if missing.length}
        <div class="lookup">
          <button onclick={resolveMissing} disabled={busy} title="Sendet nur die Ortsnamen (nicht die Personen) an wikidata.org">
            {busy ? "Suche läuft …" : `Koordinaten bei Wikidata suchen (${Math.min(missing.length, BATCH)} von ${missing.length})`}
          </button>
          <small class="dim">Nur Ortsnamen gehen an wikidata.org. Ergebnisse sind vermutet (hohle Marken) und bleiben im Browser.</small>
          {#if progress}<small class="dim">{progress}</small>{/if}
          {#if lookupError}<small class="bad" role="alert">{lookupError}</small>{/if}
        </div>
      {/if}

      <ul class="list">
        {#if mode === "places"}
          {#each places.slice(0, LIST_MAX) as p (p.key)}
            <li>
              <button class="row" class:on={selectedKey === p.key} onclick={() => selectPlace(p.key)}>
                <span class="nm">{p.name}</span>
                <small class="dim">{p.persons} {p.persons === 1 ? "Person" : "Personen"}{#if !p.coords} · ohne Koordinaten{:else if p.coordsFrom === "lookup"} · vermutet{/if}</small>
              </button>
              {#if selectedKey === p.key}
                <ul class="events">
                  {#each p.events.slice(0, 20) as e}
                    <li>{kindLabel[e.kind]}{#if e.year} {e.year}{/if}: <button class="link" onclick={() => onPick(e.personId)}>{graph.getPerson(e.personId)?.givenNames ?? ""} {graph.getPerson(e.personId)?.surname ?? ""}</button></li>
                  {/each}
                  {#if p.events.length > 20}<li class="dim">… und {p.events.length - 20} weitere</li>{/if}
                </ul>
              {/if}
            </li>
          {/each}
          {#if places.length > LIST_MAX}<li class="dim more">… und {places.length - LIST_MAX} weitere Orte (Auswahl eingrenzen)</li>{/if}
        {:else}
          {#each paths.slice(0, LIST_MAX) as p (p.personId)}
            <li>
              <button class="row" class:on={selectedPerson === p.personId} onclick={() => selectPerson(p.personId)}>
                <span class="nm"><i class="chip" style:background={lineColor(p.surname)}></i>{p.name}</span>
                <small class="dim">{p.birthYear ?? "?"}{#if p.deathYear} – {p.deathYear}{/if} · {p.stops.length} {p.stops.length === 1 ? "Ort" : "Orte"}</small>
              </button>
              {#if selectedPerson === p.personId}
                <ol class="events">
                  {#each p.stops as s}<li>{s.name}{#if s.year} <small class="dim">({kindLabel[s.kind]} {s.year})</small>{:else} <small class="dim">({kindLabel[s.kind]})</small>{/if}{#if !s.coords} <small class="dim">· ohne Koordinaten</small>{/if}</li>{/each}
                </ol>
                <button class="link focus" onclick={() => onPick(p.personId)}>Als Fokus wählen</button>
              {/if}
            </li>
          {/each}
          {#if paths.length > LIST_MAX}<li class="dim more">… und {paths.length - LIST_MAX} weitere (Auswahl eingrenzen)</li>{/if}
        {/if}
        {#if (mode === "places" ? places : paths).length === 0}<li class="dim more">Keine Ortsangaben in dieser Auswahl.</li>{/if}
      </ul>
    </aside>

    <div class="map" bind:clientWidth={cw} bind:clientHeight={ch}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg
        bind:this={svgEl}
        viewBox="{vb.x} {vb.y} {vb.w} {vb.h}"
        role="img"
        aria-label="Weltkarte mit Orten der Familie"
        onwheel={onWheel}
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
      >
        <rect x={MAP_BOUNDS.minLon} y={-MAP_BOUNDS.maxLat} width={W} height={H} class="sea" />
        {#each LAND as r}<polygon points={ring(r)} class="land" />{/each}
        {#each INLAND_SEAS as r}<polygon points={ring(r)} class="sea-inland" />{/each}

        {#if mode === "paths"}
          {#each drawnPaths as x (x.p.personId)}
            {@const sel = selectedPerson === x.p.personId}
            <polyline
              points={polyline(x.pts)} fill="none" stroke={lineColor(x.p.surname)}
              stroke-width={sel ? 3 : 1.5} stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round"
              opacity={selectedPerson && !sel ? 0.25 : 0.85} vector-effect="non-scaling-stroke"
            ><title>{x.p.name}</title></polyline>
          {/each}
          {#if selectedPath}
            {#each selectedPath.stops as s, i (i)}
              {#if s.coords}
                <circle cx={s.coords.lon} cy={-s.coords.lat} r={px(6)} fill={lineColor(selectedPath.surname)} stroke="var(--bg)" stroke-width="1.5" vector-effect="non-scaling-stroke"><title>{i + 1}. {s.name}</title></circle>
                <text x={s.coords.lon} y={-s.coords.lat} dy={px(3.5)} text-anchor="middle" font-size={px(9)} class="num">{i + 1}</text>
              {/if}
            {/each}
          {/if}
        {/if}

        {#if mode === "places" || !selectedPath}
          {#each located.slice(0, MARKER_MAX) as p (p.key)}
            {@const sel = selectedKey === p.key}
            <circle
              cx={p.coords!.lon} cy={-p.coords!.lat} r={px(radius(p.persons) * (mode === "paths" ? 0.6 : 1))}
              class="pin" class:guess={p.coordsFrom === "lookup"} class:sel
              role="button" tabindex="-1" aria-label={p.name}
              onclick={() => { mode = "places"; selectPlace(p.key); }} onkeydown={() => {}}
              vector-effect="non-scaling-stroke"
            ><title>{p.name}: {p.persons} {p.persons === 1 ? "Person" : "Personen"}{p.coordsFrom === "lookup" ? " (Lage vermutet, Wikidata)" : ""}</title></circle>
          {/each}
        {/if}
      </svg>
      <div class="zoom">
        <button onclick={fitAll} title="Alle Orte einpassen">Einpassen</button>
        <button onclick={() => zoomBy(0.6)} aria-label="Hineinzoomen">+</button>
        <button onclick={() => zoomBy(1 / 0.6)} aria-label="Herauszoomen">−</button>
      </div>
      <p class="hint dim">Ziehen = verschieben · Mausrad = zoomen · hohle Marke = Lage vermutet · Karte stark vereinfacht</p>
    </div>
  </div>
{/if}

<style>
  .wrap { height: 100%; display: grid; grid-template-columns: 22rem minmax(0, 1fr); min-height: 0; }
  aside { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); background: var(--panel); padding: 0.75rem; gap: 0.5rem; }
  .controls { display: flex; flex-direction: column; gap: 0.4rem; }
  .controls label { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; color: var(--dim); }
  .seg { display: flex; }
  .seg button { flex: 1; border-radius: 0; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; }
  .seg button.on { background: var(--accent); color: #08201e; }
  .stat { margin: 0; font-size: 0.85rem; }
  .dim { color: var(--dim); }
  .bad { color: var(--bad); }
  .lookup { display: flex; flex-direction: column; gap: 0.3rem; }
  .list { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; min-height: 0; }
  .row { width: 100%; display: flex; flex-direction: column; align-items: flex-start; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 0.35rem 0.25rem; }
  .row:hover, .row.on { background: var(--bg); }
  .nm { display: flex; align-items: center; gap: 0.4rem; }
  .chip { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 50%; }
  .events { margin: 0.2rem 0 0.4rem 0.5rem; padding-left: 1rem; font-size: 0.85rem; }
  ul.events { list-style: none; padding-left: 0.25rem; }
  .more { padding: 0.5rem 0.25rem; }
  .focus { margin: 0 0 0.5rem 0.5rem; }
  .map { position: relative; min-width: 0; min-height: 0; background: #0a1224; overflow: hidden; }
  svg { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
  svg:active { cursor: grabbing; }
  .sea { fill: #0a1224; }
  .land { fill: #1b2547; stroke: #2e3b6b; stroke-width: 1; vector-effect: non-scaling-stroke; }
  .sea-inland { fill: #0a1224; stroke: #2e3b6b; stroke-width: 1; vector-effect: non-scaling-stroke; }
  .pin { fill: var(--accent); fill-opacity: 0.8; stroke: var(--bg); stroke-width: 1.5; cursor: pointer; }
  .pin.guess { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 3 2; }
  .pin.sel { fill: var(--warn); stroke: var(--text); }
  .num { fill: #08201e; font-weight: 700; pointer-events: none; }
  .zoom { position: absolute; right: 0.75rem; bottom: 2rem; display: flex; flex-direction: column; gap: 0.3rem; }
  .hint { position: absolute; left: 0.75rem; bottom: 0.5rem; margin: 0; font-size: 0.75rem; }
  .empty { color: var(--dim); text-align: center; margin-top: 4rem; }
  @media (max-width: 800px) {
    .wrap { grid-template-columns: minmax(0, 1fr); grid-template-rows: 40% minmax(0, 1fr); }
    aside { border-right: 0; border-bottom: 1px solid var(--line); overflow: auto; }
  }
</style>
