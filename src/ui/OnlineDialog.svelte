<script lang="ts">
  // Online suchen (M8): Treffer aus Wikidata/WikiTree/FamilySearch zu einem Namen, Dublettenhinweise,
  // Übernahme als „vermutet“. Es wird nur etwas gesendet, wenn „Suchen“ oder „Übernehmen“ gedrückt wird.
  import { DuplicateFinder } from "../core";
  import type { DuplicateCandidate, Person, PersonId, TreeData } from "../core";
  import {
    adoptBatch,
    createFamilySearchProvider,
    createWikiTreeProvider,
    createWikidataProvider,
    refKey,
    WIKITREE_ENDPOINT,
  } from "../providers";
  import type { AdoptResult, ExternalPerson, ImportBatch, Provider } from "../providers";
  import { describeLifespan } from "../providers/adopt";
  import { displayName, lifeSpan } from "../render/style";

  let {
    data,
    prefill,
    onAdopt,
  }: {
    data: TreeData | null;
    /** Fokusperson: Vorbelegung der Suchfelder */
    prefill: Person | null;
    /** Neuer Baum mit den übernommenen Personen; die App speichert und zeigt ihn */
    onAdopt: (result: AdoptResult, summary: string) => void | Promise<void>;
  } = $props();

  interface Hit {
    ext: ExternalPerson;
    dupes: DuplicateCandidate[];
    /** Person im Baum mit demselben Verweis (schon übernommen) */
    known: PersonId | null;
  }

  let dialog: HTMLDialogElement;
  let providerId = $state("wikidata");
  let token = $state(""); // FamilySearch-Zugriffstoken: nur Arbeitsspeicher
  // Im Dev-Server leitet Vite /wikitree weiter; sonst ist die Adresse vom Nutzer einzutragen (kein CORS bei WikiTree).
  let wikitreeBase = $state(import.meta.env.DEV ? "/wikitree/api.php" : WIKITREE_ENDPOINT);
  let givenNames = $state("");
  let surname = $state("");
  let birthYear = $state("");
  let busy = $state(false);
  let error = $state("");
  let message = $state("");
  let hits = $state.raw<Hit[] | null>(null);
  let withRelatives = $state(true);

  const providers = $derived<Record<string, Provider>>({
    wikidata: createWikidataProvider(),
    wikitree: createWikiTreeProvider({ baseUrl: wikitreeBase.trim() || WIKITREE_ENDPOINT }),
    familysearch: createFamilySearchProvider({ accessToken: token.trim() || undefined }),
  });
  const provider = $derived(providers[providerId]!);
  const names = $derived(new Map((data?.persons ?? []).map((p) => [p.id, p])));

  export function open() {
    if (prefill) {
      givenNames = prefill.givenNames ?? "";
      surname = prefill.surname ?? "";
      birthYear = prefill.birth?.date?.year?.toString() ?? "";
    }
    hits = null;
    error = "";
    message = "";
    if (!dialog.open) dialog.showModal();
  }

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const personLabel = (id: PersonId) => {
    const p = names.get(id);
    return p ? `${displayName(p)} ${lifeSpan(p)}`.trim() : id;
  };

  async function search(e: Event) {
    e.preventDefault();
    if (!data || busy) return;
    busy = true;
    error = "";
    message = "";
    hits = null;
    try {
      const year = Number.parseInt(birthYear, 10);
      const found = await provider.search({
        givenNames: givenNames.trim() || undefined,
        surname: surname.trim() || undefined,
        birthYear: Number.isFinite(year) ? year : undefined,
      });
      const finder = new DuplicateFinder(data.persons);
      const byRef = new Map<string, PersonId>();
      for (const p of data.persons) for (const r of p.externalRefs ?? []) byRef.set(refKey(r), p.id);
      hits = found.map((ext) => ({
        ext,
        known: byRef.get(refKey(ext.ref)) ?? null,
        dupes: finder.find({
          givenNames: ext.givenNames,
          surname: ext.surname,
          sex: ext.sex,
          birthYear: ext.birth?.date?.year,
          deathYear: ext.death?.date?.year,
        }),
      }));
      if (!found.length) message = "Keine Treffer.";
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }

  /** Übernimmt einen Treffer; `linkTo` = Verweis an vorhandene Person statt neuer Person. */
  async function take(hit: Hit, linkTo?: PersonId) {
    if (!data || busy) return;
    busy = true;
    error = "";
    try {
      const batch: ImportBatch = withRelatives
        ? await provider.fetchRelatives(hit.ext.ref)
        : { provider: provider.id, root: hit.ext.ref, people: [hit.ext], unions: [] };
      const res = adoptBatch(data, batch, { linkTo, includeRelatives: withRelatives });
      const parts = [`${res.addedPersons} Person(en) und ${res.addedUnions} Partnerschaft(en) als „vermutet“ hinzugefügt`];
      if (linkTo) parts.unshift("Verweis an vorhandene Person angehängt");
      if (res.possibleDuplicates.length) parts.push(`${res.possibleDuplicates.length} mögliche Dublette(n) zu prüfen`);
      if (res.notes.length) parts.push(res.notes.join(" "));
      await onAdopt(res, parts.join("; ") + ".");
      dialog.close();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="online-title">
  <header>
    <h2 id="online-title">Online suchen</h2>
    <button onclick={() => dialog.close()} aria-label="Schließen">✕</button>
  </header>

  <form onsubmit={search}>
    <label>Quelle
      <select bind:value={providerId}>
        <option value="wikidata">Wikidata (bekannte historische Personen)</option>
        <option value="wikitree">WikiTree (offene Profile)</option>
        <option value="familysearch">FamilySearch (Gerüst, ungeprüft)</option>
      </select>
    </label>
    {#if providerId === "wikitree"}
      <label>Adresse der WikiTree-API
        <input bind:value={wikitreeBase} spellcheck="false" />
        <small>WikiTree erlaubt keine Abfragen direkt aus dem Browser. Im Dev-Server ist <code>/wikitree/api.php</code> voreingestellt; sonst die Adresse eines eigenen Durchleiters eintragen.</small>
      </label>
    {:else if providerId === "familysearch"}
      <label>Zugriffstoken
        <input type="password" bind:value={token} autocomplete="off" />
        <small>Braucht ein FamilySearch-Entwicklerkonto; das Token wird nicht gespeichert.</small>
      </label>
    {/if}
    <div class="row">
      <label>Vorname(n)<input bind:value={givenNames} /></label>
      <label>Nachname<input bind:value={surname} required /></label>
      <label class="year">Geburtsjahr<input bind:value={birthYear} inputmode="numeric" pattern="[0-9]*" /></label>
    </div>
    <p class="dim">{provider.disclosure} Erst mit „Suchen“ wird etwas gesendet.</p>
    <button class="primary" disabled={busy || !data}>{busy ? "Bitte warten …" : "Suchen"}</button>
  </form>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if message}<p class="dim">{message}</p>{/if}

  {#if hits?.length}
    <label class="check">
      <input type="checkbox" bind:checked={withRelatives} />
      Eltern, Partner und Kinder mitnehmen (löst beim Übernehmen eine weitere Abfrage aus)
    </label>
    <ul class="hits">
      {#each hits as h (refKey(h.ext.ref))}
        <li>
          <div class="head">
            <strong>{[h.ext.givenNames, h.ext.surname].filter(Boolean).join(" ")}</strong>
            <small>{describeLifespan(h.ext)}{#if h.ext.birth?.place} · {h.ext.birth.place}{/if}</small>
            <a href={h.ext.url} target="_blank" rel="noopener noreferrer">{h.ext.ref.id}</a>
          </div>
          {#if h.ext.summary}<small class="dim">{h.ext.summary}</small>{/if}
          {#if h.known}
            <p class="ok">Schon im Baum: {personLabel(h.known)} (gleicher Verweis).</p>
          {/if}
          {#if h.dupes.length}
            <p class="warn">Mögliche Dublette – bitte prüfen, es wird nichts automatisch zusammengeführt:</p>
            <ul class="dupes">
              {#each h.dupes as d (d.personId)}
                <li>
                  {personLabel(d.personId)} <small>({d.reasons.join(", ")})</small>
                  <button disabled={busy} onclick={() => take(h, d.personId)} title="Ist dieselbe Person: nur Verweis, Quelle und Notiz anhängen">Ist dieselbe Person</button>
                </li>
              {/each}
            </ul>
          {/if}
          <button disabled={busy} onclick={() => take(h)}>Als neue, vermutete Person übernehmen</button>
        </li>
      {/each}
    </ul>
  {/if}
</dialog>

<style>
  dialog {
    width: min(46rem, calc(100vw - 2rem)); max-height: calc(100vh - 3rem); box-sizing: border-box;
    background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.25rem;
  }
  dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font-size: 1.2rem; }
  form { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.5rem; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: var(--dim); }
  label input, label select { color: var(--text); }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .row label { flex: 1 1 10rem; }
  .row .year { flex: 0 1 7rem; }
  .check { flex-direction: row; align-items: center; margin: 0.8rem 0 0.3rem; color: var(--text); }
  .hits { list-style: none; padding: 0; margin: 0; }
  .hits > li { border-top: 1px solid var(--line); padding: 0.6rem 0; display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start; }
  .head { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: baseline; }
  .dupes { margin: 0; padding-left: 1.2rem; font-size: 0.9rem; }
  .dupes li { margin: 0.2rem 0; }
  .error { color: var(--bad); }
  .warn { color: var(--warn); margin: 0.2rem 0 0; }
  .ok { color: #7bd88f; margin: 0.2rem 0 0; }
  .dim, small { color: var(--dim); }
  a { color: #8ab4ff; }
</style>
