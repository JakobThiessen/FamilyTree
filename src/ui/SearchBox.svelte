<script lang="ts">
  // Namenssuche mit Trefferliste (Combobox: Pfeiltasten, Enter, Esc). Taste „/“ springt ins Feld.
  import type { Person, PersonId, PersonSearchIndex } from "../core";
  import { displayName, lifeSpan } from "../render/style";
  import { t } from "./lang.svelte";

  // Der Index gehört App.svelte: einmal pro Baum aufgebaut, beim Bearbeiten nur nachgeführt (`rev` zählt die Änderungen).
  let { persons, index, rev, onPick }: { persons: ReadonlyMap<PersonId, Person>; index: PersonSearchIndex; rev: number; onPick: (id: PersonId) => void } = $props();

  // Index schon beim Öffnen des Baums aufbauen, nicht erst beim ersten Tastendruck.
  $effect(() => {
    const t = setTimeout(() => void index.size, 0);
    return () => clearTimeout(t);
  });

  let query = $state("");
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement;

  const hits = $derived((void rev, query.trim() ? index.search(query, 12) : []));

  function pick(id: PersonId) {
    onPick(id);
    query = "";
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      active = Math.min(active + 1, hits.length - 1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(active - 1, 0);
      e.preventDefault();
    } else if (e.key === "Enter" && hits[active]) {
      pick(hits[active]!.id);
    } else if (e.key === "Escape") {
      open = false;
      query = "";
    }
  }

  function globalKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (e.key === "/" && t?.tagName !== "INPUT" && t?.tagName !== "TEXTAREA") {
      e.preventDefault();
      input.focus();
    }
  }
</script>

<svelte:window onkeydown={globalKey} />

<div class="search">
  <input
    bind:this={input}
    bind:value={query}
    type="search"
    placeholder={t("search.placeholder")}
    aria-label={t("search.placeholder")}
    role="combobox"
    aria-expanded={open && hits.length > 0}
    aria-controls="search-hits"
    aria-activedescendant={open && hits.length ? `search-hit-${active}` : undefined}
    aria-autocomplete="list"
    autocomplete="off"
    oninput={() => { open = true; active = 0; }}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 150)}
    onkeydown={onKey}
  />
  {#if open && query.trim()}
    <ul id="search-hits" role="listbox">
      {#each hits as h, i (h.id)}
        {@const p = persons.get(h.id)}
        <li role="option" id="search-hit-{i}" aria-selected={i === active} class:active={i === active}>
          <button type="button" class="hit" onmousedown={(e) => { e.preventDefault(); pick(h.id); }}>
            <span>{displayName(p)}</span><small>{lifeSpan(p)}</small>
          </button>
        </li>
      {:else}
        <li class="none">{t("search.none")}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .search { position: relative; }
  input { width: 100%; box-sizing: border-box; }
  ul {
    position: absolute; z-index: 5; left: 0; right: 0; margin: 2px 0 0; padding: 0; list-style: none;
    background: var(--panel); border: 1px solid var(--line); border-radius: 6px; max-height: 20rem; overflow: auto;
  }
  li.active { background: #1f2745; }
  .hit { display: flex; justify-content: space-between; gap: 0.5rem; width: 100%; background: none; border: 0; border-radius: 0; text-align: left; }
  small { color: var(--dim); }
  .none { padding: 0.4rem 0.65rem; color: var(--dim); }
</style>
