<script lang="ts">
  // Reiter „Ahnen“: Ahnentafel je Generation, Ahnenschwund und Inzuchtkoeffizient der Fokusperson.
  // Die Auswertung kommt aus src/core/pedigree.ts (reines TypeScript); hier wird sie nur angezeigt.
  import { pedigreeReport } from "../core";
  import type { FamilyGraph, Person, PersonId } from "../core";
  import { displayName, lifeSpan } from "../render/style";
  import { fmt, t, tn } from "./lang.svelte";
  import type { MessageKey } from "./i18n";

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

  // Tiefe begrenzen: bei großen Bäumen wächst die Tafel sonst schnell (höchstens 2^Tiefe Plätze je Generation).
  let depth = $state(6);
  const DEPTHS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20];
  const MAX_ROWS = 3000;

  const report = $derived(graph && focusId && graph.hasPerson(focusId) ? pedigreeReport(graph, focusId, { maxDepth: depth, maxRows: MAX_ROWS }) : null);

  const name = (id: PersonId) => displayName(persons.get(id));
  const span = (id: PersonId) => lifeSpan(persons.get(id));
  const genLabel = (n: number) => (n <= 4 ? t(`anc.gen.${n}` as MessageKey) : t("anc.gen.more", { n: n - 2 }));
  const percent = (x: number) => fmt(x * 100, { maximumFractionDigits: 2 }) + " %";
</script>

{#if !report}
  <p class="empty">{t("common.noPerson")}</p>
{:else}
  <div class="wrap">
    <header>
      <h2>{t("anc.heading", { name: name(focusId) })} <small>{span(focusId)}</small></h2>
      <label>{t("common.depth")}
        <select bind:value={depth}>{#each DEPTHS as d}<option value={d}>{tn("common.generations", d)}</option>{/each}</select>
      </label>
    </header>

    <section class="summary">
      <div><b>{report.tafel.rowCount - 1}</b><span>{t("anc.slots")}</span></div>
      <div><b>{report.collapse.repeated.length}</b><span>{t("anc.repeated")}</span></div>
      <div title={t("anc.implex.title")}><b>{percent(report.collapse.implex)}</b><span>{t("anc.implex")}</span></div>
      <div title={t("anc.inbreeding.title")}><b>{percent(report.inbreeding)}</b><span>{t("anc.inbreeding")}</span></div>
    </section>
    {#if report.tafel.truncated}
      <p class="warn" role="status">{t("anc.truncated", { max: MAX_ROWS })}</p>
    {/if}

    {#if report.collapse.repeated.length}
      <section>
        <h3>{t("anc.collapse")}</h3>
        <p class="dim">{t("anc.collapseHelp")}</p>
        <ul class="plain">
          {#each report.collapse.repeated.slice(0, 50) as r (r.id)}
            <li>
              <button class="link" onclick={() => onPick(r.id)}>{name(r.id)}</button>
              <small>{t("anc.paths", { paths: r.pathCount, gens: r.depths.join(", ") })}</small>
            </li>
          {/each}
        </ul>
        {#if report.collapse.repeated.length > 50}<p class="dim">{t("anc.moreRepeated", { n: report.collapse.repeated.length - 50 })}</p>{/if}
      </section>
    {/if}

    <section>
      <h3>{t("anc.tafel")}</h3>
      {#each report.tafel.generations as gen (gen.generation)}
        <h4>
          {gen.generation === 0 ? t("anc.gen.person") : t("anc.gen.n", { n: gen.generation })}
          {#if genLabel(gen.generation) && gen.generation > 0}<small>· {genLabel(gen.generation)}</small>{/if}
          <small>· {t("anc.known", { known: gen.known, slots: fmt(gen.slots) })}</small>
        </h4>
        <table>
          <thead><tr><th>{t("anc.th.sosa")}</th><th>{t("anc.th.name")}</th><th>{t("anc.th.span")}</th></tr></thead>
          <tbody>
            {#each gen.rows as row (row.sosa)}
              <tr class:dup={row.duplicateOf !== undefined}>
                <td class="num">{row.sosa}</td>
                <td>
                  <button class="link" onclick={() => onPick(row.personId)}>{name(row.personId)}</button>
                  {#if row.duplicateOf !== undefined}<small class="tag">{t("anc.see", { n: row.duplicateOf })}</small>{/if}
                </td>
                <td class="dim">{span(row.personId)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/each}
    </section>
  </div>
{/if}

<style>
  .wrap { height: 100%; overflow: auto; padding: 1rem 1.5rem 2rem; max-width: 60rem; margin: 0 auto; box-sizing: border-box; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; background: none; border: 0; padding: 0; }
  h2 { margin: 0 0 0.75rem; } h2 small, h4 small { color: var(--dim); font-weight: normal; }
  h3 { margin: 1.5rem 0 0.25rem; } h4 { margin: 1rem 0 0.3rem; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.6rem; }
  .summary div { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 0.5rem 0.75rem; display: flex; flex-direction: column; }
  .summary b { font-size: 1.4rem; color: var(--accent); }
  .summary span { color: var(--dim); font-size: 0.8rem; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: var(--dim); font-weight: normal; font-size: 0.8rem; border-bottom: 1px solid var(--line); }
  td, th { padding: 0.25rem 0.5rem; }
  tr:hover td { background: var(--panel); }
  .num { width: 5rem; font-variant-numeric: tabular-nums; color: var(--dim); }
  .dup td { opacity: 0.75; }
  .tag { color: var(--warn); margin-left: 0.4rem; }
  .warn { color: var(--warn); }
  .dim { color: var(--dim); }
  ul.plain { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--dim); text-align: center; margin-top: 4rem; }
</style>
