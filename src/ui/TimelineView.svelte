<script lang="ts">
  // Reiter „Zeitleiste“: Lebensbalken mit unscharfen Daten (SVG). Die Berechnung steht in src/core/timeline.ts;
  // hier wird nur gezeichnet. Namen links (feststehend), Balken rechts (horizontal scrollbar und zoombar).
  import { buildTimeline, dateRange, timelinePersonIds } from "../core";
  import type { FamilyGraph, Person, PersonId, TimelineScope } from "../core";
  import { lineColor } from "../render/style";

  let {
    graph,
    persons,
    focusId,
    onPick,
  }: {
    graph: FamilyGraph | null;
    persons: Map<PersonId, Person>;
    focusId: PersonId;
    onPick: (id: PersonId) => void;
  } = $props();

  import { fmt, t, tn } from "./lang.svelte";
  let scope = $state<TimelineScope>("lineage");
  let depth = $state(5);
  /** Pixel pro Jahr (Zoom) */
  let ppy = $state(4);
  const ZOOMS = [1, 2, 4, 8, 16];
  const ROW = 24;
  const MAX_ROWS = 600;

  // Bei „Alle“ in großen Bäumen nur Zeilen um das Geburtsjahr der Fokusperson (D30), sonst wird die Seite zu schwer.
  const timeline = $derived.by(() => {
    if (!graph || !focusId || !graph.hasPerson(focusId)) return null;
    const around = dateRange(persons.get(focusId)?.birth?.date);
    const ids = timelinePersonIds(graph, focusId, scope, depth);
    return buildTimeline(graph, ids, {
      maxRows: MAX_ROWS,
      ...(around ? { aroundYear: (around.from + around.to) / 2 } : {}),
    });
  });

  const PAD = 10;
  const axis = $derived.by(() => {
    if (!timeline) return { x0: 0, width: 0, ticks: [] as number[] };
    const x0 = Math.floor(timeline.minYear / 10) * 10 - 5;
    const x1 = Math.ceil(timeline.maxYear / 10) * 10 + 5;
    const step = ppy >= 8 ? 10 : ppy >= 3 ? 25 : ppy >= 1.5 ? 50 : 100;
    const ticks: number[] = [];
    for (let y = Math.ceil(x0 / step) * step; y <= x1; y += step) ticks.push(y);
    return { x0, width: (x1 - x0) * ppy + PAD * 2, ticks };
  });
  const markerLabel = (m: { kind: string; who?: string }) =>
    m.kind === "union" ? (m.who ? t("tl.marker.unionWith", { name: m.who }) : t("tl.marker.union")) : t("tl.marker.child", { name: m.who ?? "?" });
  const x = (year: number) => (year - axis.x0) * ppy + PAD;
</script>

{#if !timeline}
  <p class="empty">{t("common.noPerson")}</p>
{:else}
  <div class="wrap">
    <div class="bar">
      <label>{t("common.selection")}
        <select bind:value={scope}>
          <option value="lineage">{t("tl.scope.lineage")}</option>
          <option value="all">{t("tl.scope.all")}</option>
        </select>
      </label>
      {#if scope === "lineage"}
        <label>{t("common.depth")}
          <select bind:value={depth}>{#each [1, 2, 3, 5, 8, 12, 20] as d}<option value={d}>{tn("common.generations", d)}</option>{/each}</select>
        </label>
      {/if}
      <label>{t("tl.zoom")}
        <select bind:value={ppy}>{#each ZOOMS as z}<option value={z}>{t("tl.ppy", { n: z })}</option>{/each}</select>
      </label>
      <span class="dim">{t("tl.persons", { n: fmt(timeline.rows.length) })}{#if timeline.undated}{t("tl.undated", { n: timeline.undated })}{/if}</span>
      <span class="legend dim">
        <i class="sw solid"></i>{t("tl.legend.proven")} <i class="sw est"></i>{t("tl.legend.est")} <i class="sw fuzzy"></i>{t("tl.legend.fuzzy")}
        <i class="dia"></i>{t("tl.legend.union")} <i class="dot"></i>{t("tl.legend.child")}
      </span>
    </div>
    {#if timeline.truncated}
      <p class="warn" role="status">{t("tl.truncated", { total: timeline.total, max: MAX_ROWS, scope: t("tl.scope.lineage") })}</p>
    {/if}

    {#if timeline.rows.length === 0}
      <p class="empty">{t("tl.none")}</p>
    {:else}
      <div class="scroll">
        <div class="grid" style:height="{(timeline.rows.length + 1) * ROW}px">
          <div class="labels">
            <div class="label head" style:height="{ROW}px"></div>
            {#each timeline.rows as r (r.personId)}
              <div class="label" class:focus={r.personId === focusId} style:height="{ROW}px">
                <button class="link" onclick={() => onPick(r.personId)} title={r.name}>{r.name}</button>
              </div>
            {/each}
          </div>
          <svg width={axis.width} height={(timeline.rows.length + 1) * ROW} role="img" aria-label={t("tl.svgLabel")}>
            <!-- Achse mit Gitternetz -->
            {#each axis.ticks as t (t)}
              <line x1={x(t)} x2={x(t)} y1={ROW} y2={(timeline.rows.length + 1) * ROW} class="grid-line" />
              <text x={x(t) + 3} y={ROW - 8} class="tick">{t}</text>
            {/each}
            {#each timeline.rows as r, i (r.personId)}
              {@const y = (i + 1) * ROW}
              {@const color = lineColor(r.surname)}
              {#if r.personId === focusId}<rect x="0" {y} width={axis.width} height={ROW} class="focus-row" />{/if}
              <!-- unscharfe Ränder von Geburt und Tod -->
              {#if r.birth && r.birth.to > r.birth.from}<rect x={x(r.birth.from)} y={y + 6} width={(r.birth.to - r.birth.from) * ppy} height={ROW - 12} fill={color} opacity="0.3" />{/if}
              {#if r.death && r.death.to > r.death.from}<rect x={x(r.death.from)} y={y + 6} width={(r.death.to - r.death.from) * ppy} height={ROW - 12} fill={color} opacity="0.3" />{/if}
              <rect
                x={x(r.start)} y={y + 6} width={Math.max((r.end - r.start) * ppy, 2)} height={ROW - 12} rx="3"
                fill={color} fill-opacity={r.startDerived || r.endDerived ? 0.35 : 0.85}
                stroke={color} stroke-dasharray={r.startDerived || r.endDerived ? "3 2" : undefined}
              >
                <title>{r.name}: {r.birth ? r.birth.from : "?"} – {r.death ? r.death.to : r.maybeLiving ? t("tl.maybeLiving") : "?"}{r.startDerived || r.endDerived ? t("tl.partlyEstimated") : ""}</title>
              </rect>
              {#each r.markers as m, mi (mi)}
                {#if m.kind === "union"}
                  <rect x={x(m.year) - 4} y={y + ROW / 2 - 4} width="8" height="8" transform="rotate(45 {x(m.year)} {y + ROW / 2})" class="marker union"><title>{markerLabel(m)} ({m.year})</title></rect>
                {:else}
                  <circle cx={x(m.year)} cy={y + ROW / 2} r="3" class="marker child"><title>{markerLabel(m)} ({m.year})</title></circle>
                {/if}
              {/each}
            {/each}
          </svg>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .wrap { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; padding: 0.5rem 1rem; border-bottom: 1px solid var(--line); }
  .bar label { display: flex; align-items: center; gap: 0.4rem; color: var(--dim); }
  .dim { color: var(--dim); font-size: 0.85rem; }
  .legend { margin-left: auto; display: flex; align-items: center; gap: 0.4rem; }
  .sw { display: inline-block; width: 1.2rem; height: 0.6rem; border-radius: 2px; background: var(--accent); margin-left: 0.5rem; }
  .sw.est { opacity: 0.35; border: 1px dashed var(--accent); }
  .sw.fuzzy { opacity: 0.3; }
  .dia { display: inline-block; width: 0.5rem; height: 0.5rem; background: var(--warn); transform: rotate(45deg); margin: 0 0.2rem 0 0.6rem; }
  .dot { display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--text); margin: 0 0.2rem 0 0.6rem; }
  .warn { margin: 0; padding: 0.35rem 1rem; color: var(--warn); }
  .scroll { flex: 1; min-height: 0; overflow: auto; }
  .grid { display: flex; min-width: min-content; position: relative; }
  .labels { position: sticky; left: 0; z-index: 2; flex: none; width: 13rem; background: var(--bg); border-right: 1px solid var(--line); }
  .label { box-sizing: border-box; padding: 0 0.5rem; display: flex; align-items: center; overflow: hidden; }
  .label.focus { background: var(--panel); }
  .label .link { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  svg { flex: none; display: block; }
  .grid-line { stroke: var(--line); stroke-width: 1; }
  .tick { fill: var(--dim); font-size: 11px; }
  .focus-row { fill: var(--panel); }
  .marker.union { fill: var(--warn); }
  .marker.child { fill: var(--text); }
  .empty { color: var(--dim); text-align: center; margin-top: 4rem; }
</style>
