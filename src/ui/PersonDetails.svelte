<script lang="ts">
  // Detailfenster der Fokusperson: Ereignisse mit Quellen, Notizen, Status, Familie (anklickbar).
  import type { PersonId } from "../core";
  import { STATUS_LABEL } from "./personInfo";
  import type { PersonInfo, RelativeRef } from "./personInfo";

  let { info, onPick }: { info: PersonInfo | null; onPick: (id: PersonId) => void } = $props();
</script>

{#snippet rel(r: RelativeRef)}
  <button class="link" onclick={() => onPick(r.id)}>{r.name}</button>
  {#if r.span}<small>{r.span}</small>{/if}
  {#if r.note}<small class="tag">{r.note}</small>{/if}
{/snippet}

{#snippet badge(s: keyof typeof STATUS_LABEL)}
  <span class="badge {s}">{STATUS_LABEL[s]}</span>
{/snippet}

{#if !info}
  <p class="dim">Keine Person gewählt.</p>
{:else}
  <article>
    <h2>{info.name}</h2>
    <p class="dim">{info.sex}{#if info.span}{" · " + info.span}{/if}{" "}{@render badge(info.status)}</p>

    {#each info.events as ev (ev.label)}
      <section>
        <h3>{ev.label} {@render badge(ev.status)}</h3>
        <p>{ev.date}{#if ev.place}, {ev.place}{/if}</p>
        {#if ev.citations.length}
          <ul class="plain">
            {#each ev.citations as c}
              <li>
                Quelle:
                {#if c.url}<a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a>{:else}{c.title}{/if}
                {#if c.detail}<small>({c.detail})</small>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}

    {#if info.notes.length}
      <section>
        <h3>Notizen</h3>
        {#each info.notes as n}<p class="note">{n}</p>{/each}
      </section>
    {/if}

    {#if info.parentFamilies.length}
      <section>
        <h3>Eltern</h3>
        {#each info.parentFamilies as f}
          <p>
            {#each f.parents as r, i}{#if i}<span class="dim amp">&amp;</span>{/if}{@render rel(r)}{:else}<span class="dim">unbekannt</span>{/each}
            {#if f.note}<small class="tag">{f.note}</small>{/if}
          </p>
        {/each}
      </section>
    {/if}

    {#each info.unions as u (u.id)}
      <section>
        <h3>{u.title} {@render badge(u.status)}</h3>
        <p>
          {#if u.partner}{@render rel(u.partner)}{:else}<span class="dim">Partner unbekannt</span>{/if}
          {#if u.period}<small>{u.period}</small>{/if}
        </p>
        {#if u.children.length}
          <ul class="plain">
            {#each u.children as c}<li>Kind: {@render rel(c)}</li>{/each}
          </ul>
        {/if}
      </section>
    {/each}

    {#if info.siblings.full.length || info.siblings.half.length}
      <section>
        <h3>Geschwister</h3>
        <ul class="plain">
          {#each info.siblings.full as r}<li>{@render rel(r)}</li>{/each}
          {#each info.siblings.half as r}<li>{@render rel(r)} <small class="tag">Halbgeschwister</small></li>{/each}
        </ul>
      </section>
    {/if}

    {#if info.externalRefs.length}
      <section>
        <h3>Kennungen</h3>
        <p class="dim">{info.externalRefs.join(" · ")}</p>
      </section>
    {/if}
  </article>
{/if}

<style>
  h2 { margin: 0 0 0.2rem; font-size: 1.25rem; }
  h3 { margin: 1rem 0 0.2rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  p { margin: 0.15rem 0; }
  .dim, small { color: var(--dim); }
  small { margin-left: 0.3rem; }
  .amp { margin: 0 0.3rem; }
  .note { white-space: pre-wrap; }
  ul.plain { list-style: none; padding: 0; margin: 0.2rem 0; }
  a { color: #8ab4ff; }
  .tag { border: 1px solid var(--line); border-radius: 4px; padding: 0 0.3rem; font-size: 0.72rem; }
  .badge { font-size: 0.7rem; border-radius: 4px; padding: 0 0.35rem; text-transform: none; letter-spacing: 0; border: 1px solid var(--line); }
  .badge.proven { color: #7bd88f; }
  .badge.assumed { color: var(--warn); border-style: dashed; }
  .badge.unknown { color: var(--dim); border-style: dashed; }
</style>
