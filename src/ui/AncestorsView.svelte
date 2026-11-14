<script lang="ts">
  // Reiter „Ahnen“: Ahnentafel je Generation, Ahnenschwund und Inzuchtkoeffizient der Fokusperson.
  // Die Auswertung kommt aus src/core/pedigree.ts (reines TypeScript); hier wird sie nur angezeigt.
  import { pedigreeReport } from "../core";
  import type { FamilyGraph, Person, PersonId } from "../core";
  import { displayName, lifeSpan } from "../render/style";

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
  const GEN_NAMES = ["Person", "Eltern", "Großeltern", "Urgroßeltern"];
  const genLabel = (n: number) => (n <= 3 ? GEN_NAMES[n] ?? "" : n === 4 ? "Ururgroßeltern" : `${n - 2}× Urgroßeltern`);
  const percent = (x: number) => (x * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " %";
</script>

{#if !report}
  <p class="empty">Keine Person gewählt. Im Stammbaum eine Person anklicken oder über die Suche wählen.</p>
{:else}
  <div class="wrap">
    <header>
      <h2>Ahnen von {name(focusId)} <small>{span(focusId)}</small></h2>
      <label>Tiefe
        <select bind:value={depth}>{#each DEPTHS as d}<option value={d}>{d} Generationen</option>{/each}</select>
      </label>
    </header>

    <section class="summary">
      <div><b>{report.tafel.rowCount - 1}</b><span>Ahnenplätze (bekannt)</span></div>
      <div><b>{report.collapse.repeated.length}</b><span>doppelte Ahnen</span></div>
      <div title="Anteil der Ahnenplätze, die durch einen schon gezählten Ahn belegt sind"><b>{percent(report.collapse.implex)}</b><span>Ahnenverlust (Implex)</span></div>
      <div title="Wahrscheinlichkeit, dass beide Erbanlagen von demselben Ahn stammen (Wright)"><b>{percent(report.inbreeding)}</b><span>Inzuchtkoeffizient</span></div>
    </section>
    {#if report.tafel.truncated}
      <p class="warn" role="status">Mehr als {MAX_ROWS} Zeilen: die Tafel ist abgeschnitten. Tiefe verringern.</p>
    {/if}

    {#if report.collapse.repeated.length}
      <section>
        <h3>Ahnenschwund</h3>
        <p class="dim">Diese Personen kommen auf mehreren Wegen unter den Vorfahren vor (z. B. nach einer Heirat unter Verwandten).</p>
        <ul class="plain">
          {#each report.collapse.repeated.slice(0, 50) as r (r.id)}
            <li>
              <button class="link" onclick={() => onPick(r.id)}>{name(r.id)}</button>
              <small>{r.pathCount} Wege, in Generation {r.depths.join(", ")}</small>
            </li>
          {/each}
        </ul>
        {#if report.collapse.repeated.length > 50}<p class="dim">… und {report.collapse.repeated.length - 50} weitere.</p>{/if}
      </section>
    {/if}

    <section>
      <h3>Ahnentafel</h3>
      {#each report.tafel.generations as gen (gen.generation)}
        <h4>
          {gen.generation === 0 ? "Person" : `Generation ${gen.generation}`}
          {#if genLabel(gen.generation) && gen.generation > 0}<small>· {genLabel(gen.generation)}</small>{/if}
          <small>· {gen.known} von {gen.slots.toLocaleString("de-DE")} Plätzen bekannt</small>
        </h4>
        <table>
          <thead><tr><th>Sosa</th><th>Name</th><th>Lebensspanne</th></tr></thead>
          <tbody>
            {#each gen.rows as row (row.sosa)}
              <tr class:dup={row.duplicateOf !== undefined}>
                <td class="num">{row.sosa}</td>
                <td>
                  <button class="link" onclick={() => onPick(row.personId)}>{name(row.personId)}</button>
                  {#if row.duplicateOf !== undefined}<small class="tag">siehe Nr. {row.duplicateOf}</small>{/if}
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
