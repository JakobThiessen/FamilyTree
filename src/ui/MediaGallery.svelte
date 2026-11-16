<script lang="ts">
  // Fotos einer Person im Detailfenster (M11, D45): Hauptbild groß, weitere als Galerie.
  // Jedes Bild hat einen Alternativtext (Titel, sonst „Foto n von <Name>“). Alles bleibt lokal (Blob-Adressen).
  import { untrack } from "svelte";
  import type { MediaRef } from "../core";
  import { t } from "./lang.svelte";
  import type { MediaLookup } from "./mediaHub";

  let { refs, name, lookup }: { refs: readonly MediaRef[]; name: string; lookup: MediaLookup | null } = $props();

  /** Hauptbild zuerst, Ausschnitte (Gesichter) nach den ganzen Fotos, sonst Dateireihenfolge. */
  const sorted = $derived(
    refs
      .map((m, i) => ({ m, i }))
      .sort((a, b) => Number(!!b.m.primary) - Number(!!a.m.primary) || Number(!!a.m.cutout) - Number(!!b.m.cutout) || a.i - b.i),
  );

  let urls = $state<Record<string, string | null>>({});
  /** Zählt Meldungen des Hintergrundauftrags; jede lädt die noch fehlenden Bilder erneut. */
  let arrived = $state(0);

  $effect(() => {
    const unsub = lookup?.onChange(() => arrived++);
    return () => unsub?.();
  });

  // Vorschauen laden; Blob-Adressen beim Wechsel der Person und beim Schließen wieder freigeben.
  // Kommen Bilder im Hintergrund nach (D46), wird nur nachgeladen, was noch fehlt.
  $effect(() => {
    void arrived;
    const files = refs.map((m) => m.file);
    const l = lookup;
    let cancelled = false;
    if (l) {
      for (const f of files) {
        if (untrack(() => urls[f])) continue;
        l.thumb(f).then((th) => {
          if (cancelled) return;
          if (!th) return void (urls[f] = null);
          const u = URL.createObjectURL(th.thumb);
          urls[f] = u;
        });
      }
    }
    return () => {
      cancelled = true;
    };
  });

  // Aufräumen: Adressen freigeben, wenn die Person wechselt oder die Galerie verschwindet.
  $effect(() => {
    void refs;
    return () => {
      for (const u of Object.values(untrack(() => urls))) if (u) URL.revokeObjectURL(u);
      urls = {};
    };
  });

  /** Läuft der Hintergrundauftrag noch? Dann ist „fehlt“ nur „noch nicht da“. */
  const loading = () => {
    void arrived;
    return !!lookup?.loading;
  };
  const caption = (m: MediaRef) =>
    [m.title, m.primary ? t("person.media.primary") : "", m.cutout ? t("person.media.cutout") : ""].filter(Boolean).join(" · ");
  const alt = (m: MediaRef, n: number) => m.title || (refs.length > 1 ? t("person.media.altN", { n, name }) : t("person.media.alt", { name }));
</script>

<section class="gallery">
  <h3>{t("person.media")}</h3>
  <ul>
    {#each sorted as { m }, k (m.file)}
      <li class:main={k === 0}>
        {#if urls[m.file]}
          <img src={urls[m.file]} alt={alt(m, k + 1)} loading="lazy" />
        {:else if urls[m.file] === null && !loading()}
          <span class="missing">{t("person.media.missing", { file: m.file })}</span>
        {:else}
          <span class="missing" aria-hidden="true">…</span>
        {/if}
        {#if caption(m)}<small>{caption(m)}</small>{/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  li { display: flex; flex-direction: column; gap: 0.2rem; max-width: 7rem; }
  li.main { max-width: 100%; flex-basis: 100%; }
  img { display: block; max-width: 100%; max-height: 7rem; object-fit: contain; border-radius: 6px; border: 1px solid var(--line); background: #000; align-self: flex-start; }
  li.main img { max-height: 16rem; }
  small, .missing { color: var(--dim); font-size: 0.75rem; overflow-wrap: anywhere; }
</style>
