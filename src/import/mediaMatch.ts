/**
 * Zuordnung der Bildverweise eines Baums (`MediaRef.file`) zu den Dateien, die der Nutzer im Browser
 * ausgewählt hat (D45). Reines TypeScript, ohne Dateizugriff: bekommt nur Pfadlisten.
 *
 * Die GEDCOM nennt den Pfad, wie ihn das Programm des Exports kannte (relativ wie "Fotos/a.jpg" oder
 * absolut wie "C:\Bilder\a.jpg"). Beim Auswählen eines Ordners heißen die Pfade je nach gewähltem
 * Ordner anders ("Fotos/a.jpg" oder "gedcom/Fotos/a.jpg"). Deshalb zählt das längste gemeinsame
 * Pfadende, Groß-/Kleinschreibung wird ignoriert.
 */

export interface MediaMatch {
  /** Verweis (`MediaRef.file`) → Pfad der ausgewählten Datei */
  matched: Map<string, string>;
  /** Verweise ohne passende Datei */
  missing: string[];
  /** Verweise, die zu mehreren Dateien gleich gut passen (nicht zugeordnet) */
  ambiguous: string[];
}

const segments = (p: string): string[] =>
  p
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== "." && !/^[a-z]:$/i.test(s))
    .map((s) => s.toLowerCase());

/** Ordnet Verweise den vorhandenen Dateipfaden zu. */
export function matchMedia(refs: Iterable<string>, available: readonly string[]): MediaMatch {
  const result: MediaMatch = { matched: new Map(), missing: [], ambiguous: [] };
  // Index über den Dateinamen, damit nicht jede Suche alle Dateien durchgeht.
  const byName = new Map<string, { path: string; seg: string[] }[]>();
  for (const path of available) {
    const seg = segments(path);
    const name = seg[seg.length - 1];
    if (name === undefined) continue;
    const list = byName.get(name) ?? [];
    list.push({ path, seg });
    byName.set(name, list);
  }
  for (const ref of new Set(refs)) {
    const seg = segments(ref);
    const name = seg[seg.length - 1];
    const candidates = name === undefined ? undefined : byName.get(name);
    if (!candidates) {
      result.missing.push(ref);
      continue;
    }
    // Längstes gemeinsames Pfadende bestimmen (mindestens der Dateiname).
    const common = (c: { seg: string[] }): number => {
      let n = 0;
      while (n < seg.length && n < c.seg.length && seg[seg.length - 1 - n] === c.seg[c.seg.length - 1 - n]) n++;
      return n;
    };
    const scored = candidates.map((c) => ({ c, n: common(c) }));
    const best = Math.max(...scored.map((s) => s.n));
    const top = scored.filter((s) => s.n === best);
    if (top.length === 1) result.matched.set(ref, top[0]!.c.path);
    else result.ambiguous.push(ref);
  }
  return result;
}
