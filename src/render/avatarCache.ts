/**
 * Zwischenspeicher für Avatarbilder auf den Karten (D46). Reines TypeScript (der Bildtyp `T` ist
 * beliebig, im Browser `ImageBitmap`), damit die Logik ohne DOM testbar ist.
 *
 * - `get(id)` liefert sofort das Bild oder `undefined` und stößt beim ersten Mal das Laden an.
 * - Jede Person wird höchstens einmal gleichzeitig geladen; Fehlschläge (kein Bild da) merkt sich der
 *   Cache, bis `retryMissing()` sie wieder zulässt (wenn im Hintergrund neue Vorschauen eingetroffen sind).
 * - Mehr als `max` Bilder bleiben nicht im Speicher: das am längsten nicht benutzte fliegt raus
 *   (und wird über `dispose` freigegeben, z. B. `ImageBitmap.close`).
 */
export class AvatarCache<T> {
  private readonly cache = new Map<string, T>(); // Einfügereihenfolge = Benutzungsreihenfolge
  private readonly pending = new Set<string>();
  private readonly missing = new Set<string>();
  private generation = 0;

  constructor(
    private readonly load: (id: string) => Promise<T | undefined>,
    private readonly onLoad: () => void,
    private readonly max = 300,
    private readonly dispose: (value: T) => void = () => {},
  ) {}

  get size(): number {
    return this.cache.size;
  }

  get(id: string): T | undefined {
    const hit = this.cache.get(id);
    if (hit !== undefined) {
      this.cache.delete(id); // ans Ende = zuletzt benutzt
      this.cache.set(id, hit);
      return hit;
    }
    if (!this.pending.has(id) && !this.missing.has(id)) this.start(id);
    return undefined;
  }

  private start(id: string): void {
    const gen = this.generation;
    this.pending.add(id);
    this.load(id).then(
      (value) => {
        if (gen !== this.generation) {
          if (value !== undefined) this.dispose(value);
          return;
        }
        this.pending.delete(id);
        if (value === undefined) {
          this.missing.add(id);
          return;
        }
        this.cache.set(id, value);
        while (this.cache.size > this.max) {
          const oldest = this.cache.keys().next().value as string;
          this.dispose(this.cache.get(oldest) as T);
          this.cache.delete(oldest);
        }
        this.onLoad();
      },
      () => {
        if (gen !== this.generation) return;
        this.pending.delete(id);
        this.missing.add(id);
      },
    );
  }

  /** Erneut versuchen, wo bisher kein Bild da war. */
  retryMissing(): void {
    this.missing.clear();
  }

  /** Alles vergessen (anderer Baum). Laufende Ladevorgänge werden verworfen. */
  clear(): void {
    this.generation++;
    for (const v of this.cache.values()) this.dispose(v);
    this.cache.clear();
    this.pending.clear();
    this.missing.clear();
  }
}
