/**
 * Speicher für mehrere Stammbäume in IndexedDB.
 * Die einzige Stelle mit Seiteneffekten für Persistenz; `src/core` bleibt rein.
 */

import type { Citation, Person, PersonId, Source, SourceId, TreeData, Union } from "../core";
import { openTreeDb, personKey } from "./schema";
import type { Db, TreeMeta } from "./schema";

/** Tiefe nach oben (Vorfahren) und unten (Nachkommen) für `loadNeighborhood`. */
export interface NeighborhoodOptions {
  up: number;
  down: number;
}

export class TreeNotFoundError extends Error {
  constructor(treeId: string) {
    super(`Baum nicht gefunden: ${treeId}`);
    this.name = "TreeNotFoundError";
  }
}

/** Schlüsselbereich "alle Datensätze mit dieser treeId" (Schlüssel sind [treeId, id]). */
const treeRange = (treeId: string) => IDBKeyRange.bound([treeId], [treeId, []]);

/** Entfernt die Hilfsfelder (`treeId`, Indexlisten) wieder aus einem gespeicherten Datensatz. */
function strip<T extends { treeId: string }>(rec: T): Omit<T, "treeId" | "partnerKeys" | "childKeys"> {
  const { treeId: _t, partnerKeys: _p, childKeys: _c, ...rest } = rec as T & {
    partnerKeys?: unknown;
    childKeys?: unknown;
  };
  return rest as Omit<T, "treeId" | "partnerKeys" | "childKeys">;
}

function newTreeId(): string {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `t_${rnd}`;
}

export class TreeStore {
  private constructor(private readonly db: Db) {}

  /** Öffnet (und legt bei Bedarf an) die Datenbank. `dbName` nur in Tests anders setzen. */
  static async open(dbName?: string): Promise<TreeStore> {
    return new TreeStore(await openTreeDb(dbName));
  }

  close(): void {
    this.db.close();
  }

  // ---------- Verwaltung ----------

  /** Alle Bäume, zuletzt geänderte zuerst. */
  async listTrees(): Promise<TreeMeta[]> {
    const all = await this.db.getAll("trees");
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getTree(treeId: string): Promise<TreeMeta | undefined> {
    return this.db.get("trees", treeId);
  }

  /** Neuer leerer Baum. */
  async createTree(name: string): Promise<TreeMeta> {
    return this.saveTree(name, { version: 1, persons: [], unions: [], sources: [] });
  }

  /**
   * Legt einen neuen Baum mit den Daten an (z. B. Ergebnis des Imports).
   * Alles in EINER Transaktion: schlägt etwas fehl, bleibt nichts Halbes zurück.
   */
  async saveTree(name: string, data: TreeData): Promise<TreeMeta> {
    const now = Date.now();
    const meta: TreeMeta = {
      id: newTreeId(),
      name: name.trim() || "Unbenannter Baum",
      createdAt: now,
      updatedAt: now,
      personCount: data.persons.length,
      unionCount: data.unions.length,
      sourceCount: data.sources.length,
    };
    await this.write(meta, data, false);
    return meta;
  }

  /**
   * Ersetzt den Inhalt eines vorhandenen Baums (z. B. nach dem Übernehmen externer Treffer, M8).
   * Name und Anlegedatum bleiben. Alles in einer Transaktion: bei einem Fehler bleibt der alte Stand.
   */
  async replaceTree(treeId: string, data: TreeData): Promise<TreeMeta> {
    const old = await this.getTree(treeId);
    if (!old) throw new TreeNotFoundError(treeId);
    const meta: TreeMeta = {
      ...old,
      updatedAt: Date.now(),
      personCount: data.persons.length,
      unionCount: data.unions.length,
      sourceCount: data.sources.length,
    };
    await this.write(meta, data, true);
    return meta;
  }

  /** Gemeinsamer Schreibweg von `saveTree` und `replaceTree`. */
  private async write(meta: TreeMeta, data: TreeData, replace: boolean): Promise<void> {
    const tx = this.db.transaction(["trees", "persons", "unions", "sources"], "readwrite");
    // Alle Schreibaufträge absetzen und gemeinsam abwarten (schneller als einzeln warten).
    const writes: Promise<unknown>[] = [];
    tx.done.catch(() => {}); // Ablehnung wird unten über Promise.all/catch gemeldet, nicht doppelt
    try {
      if (replace) {
        const range = treeRange(meta.id);
        writes.push(
          tx.objectStore("persons").delete(range),
          tx.objectStore("unions").delete(range),
          tx.objectStore("sources").delete(range),
        );
        writes.push(tx.objectStore("trees").put(meta));
      } else {
        writes.push(tx.objectStore("trees").add(meta));
      }
      for (const p of data.persons) writes.push(tx.objectStore("persons").put({ ...p, treeId: meta.id }));
      for (const s of data.sources) writes.push(tx.objectStore("sources").put({ ...s, treeId: meta.id }));
      for (const u of data.unions) {
        writes.push(
          tx.objectStore("unions").put({
            ...u,
            treeId: meta.id,
            partnerKeys: u.partnerIds.map((id) => personKey(meta.id, id)),
            childKeys: u.children.map((c) => personKey(meta.id, c.personId)),
          }),
        );
      }
      writes.push(tx.done);
      await Promise.all(writes);
    } catch (e) {
      // put() kann schon beim Absetzen werfen (z. B. nicht speicherbarer Wert): dann abbrechen.
      for (const w of writes) w.catch(() => {});
      try {
        tx.abort();
      } catch {
        /* Transaktion war schon beendet */
      }
      throw e;
    }
  }

  async renameTree(treeId: string, name: string): Promise<TreeMeta> {
    const tx = this.db.transaction("trees", "readwrite");
    const meta = await tx.store.get(treeId);
    if (!meta) throw new TreeNotFoundError(treeId);
    const next = { ...meta, name: name.trim() || meta.name, updatedAt: Date.now() };
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  /** Löscht den Baum samt allen Personen, Unions und Quellen. */
  async deleteTree(treeId: string): Promise<void> {
    const tx = this.db.transaction(["trees", "persons", "unions", "sources"], "readwrite");
    const range = treeRange(treeId);
    await Promise.all([
      tx.objectStore("trees").delete(treeId),
      tx.objectStore("persons").delete(range),
      tx.objectStore("unions").delete(range),
      tx.objectStore("sources").delete(range),
      tx.done,
    ]);
  }

  // ---------- Laden ----------

  /** Ganzer Baum (z. B. für Export). Für die Ansicht lieber `loadNeighborhood`. */
  async loadTree(treeId: string): Promise<TreeData> {
    if (!(await this.getTree(treeId))) throw new TreeNotFoundError(treeId);
    const range = treeRange(treeId);
    const [persons, unions, sources] = await Promise.all([
      this.db.getAll("persons", range),
      this.db.getAll("unions", range),
      this.db.getAll("sources", range),
    ]);
    return {
      version: 1,
      persons: persons.map(strip) as Person[],
      unions: unions.map(strip) as Union[],
      sources: sources.map(strip) as Source[],
    };
  }

  /** Einzelne Personen nach ID; unbekannte IDs fehlen im Ergebnis. */
  async loadPersons(treeId: string, ids: Iterable<PersonId>): Promise<Person[]> {
    const found = await Promise.all([...new Set(ids)].map((id) => this.db.get("persons", [treeId, id])));
    return found.filter((r) => r !== undefined).map((r) => strip(r) as Person);
  }

  /** Unions, in denen die Person Partner ODER Kind ist. */
  async loadUnionsOf(treeId: string, personId: PersonId): Promise<Union[]> {
    const key = personKey(treeId, personId);
    const [asPartner, asChild] = await Promise.all([
      this.db.getAllFromIndex("unions", "byPartner", key),
      this.db.getAllFromIndex("unions", "byChild", key),
    ]);
    const byId = new Map([...asPartner, ...asChild].map((u) => [u.id, u]));
    return [...byId.values()].map((u) => strip(u) as Union);
  }

  /**
   * Teilgraph um eine Fokusperson: Vorfahren bis `up` Generationen, Nachkommen bis `down`.
   *
   * - Nach oben: die Unions, in denen die Person Kind ist (Eltern samt Geschwistern).
   * - Nach unten: die Unions, in denen die Person Partner ist (Partner und Kinder).
   * - Personen in den geladenen Unions (Partner, Kinder) kommen mit, werden aber nicht weiter
   *   aufgeklappt. Dahinter liegende Unions fehlen absichtlich ("+n"-Knoten der Ansicht, M6).
   * - Doppelte Ahnen (Ahnenschwund) werden nur einmal besucht.
   */
  async loadNeighborhood(treeId: string, focusId: PersonId, opts: NeighborhoodOptions): Promise<TreeData> {
    const unions = new Map<string, Union>();
    const personIds = new Set<PersonId>([focusId]);

    const walk = async (depth: number, direction: "up" | "down") => {
      const seen = new Set<PersonId>([focusId]);
      let frontier = [focusId];
      for (let level = 0; level < depth && frontier.length; level++) {
        const next: PersonId[] = [];
        const batches = await Promise.all(
          frontier.map((id) =>
            this.db.getAllFromIndex("unions", direction === "up" ? "byChild" : "byPartner", personKey(treeId, id)),
          ),
        );
        for (const rec of batches.flat()) {
          const u = strip(rec) as Union;
          unions.set(u.id, u);
          for (const id of u.partnerIds) personIds.add(id);
          for (const c of u.children) personIds.add(c.personId);
          // Weiter geht es mit den Eltern (nach oben) bzw. den Kindern (nach unten).
          const further = direction === "up" ? u.partnerIds : u.children.map((c) => c.personId);
          for (const id of further) {
            if (!seen.has(id)) {
              seen.add(id);
              next.push(id);
            }
          }
        }
        frontier = next;
      }
    };
    await Promise.all([walk(opts.up, "up"), walk(opts.down, "down")]);

    const persons = await this.loadPersons(treeId, personIds);
    const sources = await this.loadSources(treeId, collectSourceIds(persons, [...unions.values()]));
    return { version: 1, persons, unions: [...unions.values()], sources };
  }

  private async loadSources(treeId: string, ids: Set<SourceId>): Promise<Source[]> {
    const found = await Promise.all([...ids].map((id) => this.db.get("sources", [treeId, id])));
    return found.filter((r) => r !== undefined).map((r) => strip(r) as Source);
  }
}

/** Alle Quellen-IDs, die Personen oder Unions zitieren. */
function collectSourceIds(persons: Person[], unions: Union[]): Set<SourceId> {
  const ids = new Set<SourceId>();
  const add = (cs?: Citation[]) => cs?.forEach((c) => ids.add(c.sourceId));
  for (const p of persons) {
    add(p.birth?.citations);
    add(p.death?.citations);
  }
  for (const u of unions) {
    add(u.start?.citations);
    add(u.end?.citations);
  }
  return ids;
}
