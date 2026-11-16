// Vorschaubilder eines angezeigten Baums (M11, D46). Eine Stelle für Arbeitsspeicher und IndexedDB:
// frische Vorschauen (auch bevor der Baum gespeichert ist) liegen im Arbeitsspeicher, gespeicherte werden
// aus der Datenbank gelesen. Treffen im Hintergrund neue Vorschauen ein, melden sich die Beobachter.
import type { MediaRecord, TreeStore } from "../storage";

export type MediaThumb = Omit<MediaRecord, "treeId" | "file">;

/** Schmale Sicht für die Oberfläche (Galerie, Karten). */
export interface MediaLookup {
  /** Vorschau (400 px) zu `MediaRef.file`, oder `undefined`, wenn (noch) keine da ist */
  thumb(file: string): Promise<MediaThumb | undefined>;
  /** Kleines quadratisches Bild für die Karte, sonst die Vorschau */
  icon(file: string): Promise<Blob | undefined>;
  /** Läuft noch ein Hintergrundauftrag? Dann fehlende Bilder nicht als fehlend melden. */
  readonly loading: boolean;
  /** Meldet neue Vorschauen; gibt die Abmeldung zurück */
  onChange(cb: () => void): () => void;
}

export class MediaHub implements MediaLookup {
  private readonly mem = new Map<string, MediaThumb>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private store: TreeStore | null = null,
    private treeId: string | null = null,
  ) {}

  loading = false;

  setLoading(on: boolean): void {
    this.loading = on;
    this.listeners.forEach((cb) => cb());
  }

  async thumb(file: string): Promise<MediaThumb | undefined> {
    const m = this.mem.get(file);
    if (m) return m;
    if (!this.store || !this.treeId) return undefined;
    return this.store.loadMedia(this.treeId, file);
  }

  async icon(file: string): Promise<Blob | undefined> {
    const th = await this.thumb(file);
    return th ? (th.icon ?? th.thumb) : undefined;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Neue Vorschauen aufnehmen; ist der Baum gespeichert, auch in die Datenbank schreiben. */
  async add(items: [string, MediaThumb][]): Promise<void> {
    for (const [file, th] of items) this.mem.set(file, th);
    await this.flush();
    this.listeners.forEach((cb) => cb());
  }

  /** Der Baum wurde gespeichert: ab jetzt wird in die Datenbank geschrieben, Vorhandenes nachgereicht. */
  async attach(store: TreeStore, treeId: string): Promise<void> {
    this.store = store;
    this.treeId = treeId;
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.store || !this.treeId || !this.mem.size) return;
    const batch = [...this.mem];
    await this.store.saveMedia(this.treeId, batch.map(([file, th]) => ({ file, ...th })));
    // Aus dem Arbeitsspeicher nehmen, was geschrieben ist (außer zwischenzeitlich Ersetztes).
    for (const [file, th] of batch) if (this.mem.get(file) === th) this.mem.delete(file);
  }
}

/** Was der Importdialog beim Öffnen eines Baums mitgibt: der Hub und die noch zu verkleinernden Dateien. */
export interface MediaImport {
  hub: MediaHub;
  entries: [string, File][];
}

/** Ein Hintergrundauftrag: Vorschauen aus Dateien erzeugen und in den Hub legen. */
export interface MediaJob {
  total: number;
  cancel(): void;
  /** Endet mit Zählern, auch nach `cancel` */
  done: Promise<{ done: number; failed: number }>;
}

/**
 * Erzeugt Vorschauen für `entries` (Verweis → Datei) mit `concurrency` Bildern gleichzeitig und legt sie
 * in Päckchen von `batch` Stück in den Hub (jedes Päckchen = eine Transaktion, eine Meldung an die Karten).
 */
export function startMediaJob(
  entries: [string, File][],
  hub: MediaHub,
  make: (f: File) => Promise<MediaThumb>,
  onProgress: (done: number, total: number) => void,
  opts: { concurrency?: number; batch?: number } = {},
): MediaJob {
  const { concurrency = 4, batch = 16 } = opts;
  let cancelled = false;
  let next = 0;
  let done = 0;
  let failed = 0;
  let queue: [string, MediaThumb][] = [];
  const flush = async () => {
    const q = queue;
    queue = [];
    if (q.length && !cancelled) await hub.add(q);
  };
  const worker = async () => {
    while (!cancelled && next < entries.length) {
      const [ref, file] = entries[next++]!;
      try {
        queue.push([ref, await make(file)]);
      } catch {
        failed++;
      }
      done++;
      if (queue.length >= batch) await flush();
      onProgress(done, entries.length);
    }
  };
  const run = async () => {
    await Promise.all(Array.from({ length: concurrency }, worker));
    await flush();
    return { done, failed };
  };
  return { total: entries.length, cancel: () => void (cancelled = true), done: run() };
}
