# Architektur

## Überblick

```
 GEDCOM / JSON / Provider (WikiTree, Wikidata)
              │  (Worker)
              ▼
        src/import, src/providers   ──►  normalisiertes Modell
              │
              ▼
        src/core  (FamilyGraph, Suche, Layout)   ◄── reines TypeScript
              │
              ▼
        src/storage (IndexedDB)
              │
      ┌───────┴────────┐
      ▼                ▼
  src/render        src/ui
  (Canvas 2D)       (Svelte)
```

## Prinzipien

1. **Graph statt Baum.** Personen sind Knoten, Eltern-Kind- und Partnerbeziehungen Kanten. Es gibt keine feste Wurzel.
2. **Unions als Objekte.** Eine Union verbindet Partner und besitzt Kinder. So sind mehrere Ehen, Halbgeschwister und Stieffamilien eindeutig.
3. **Jede Person einmal.** Ahnenschwund erzeugt ungerichtete Schleifen, die Eltern-Kind-Kanten bleiben ein DAG (kein Zyklus). Die Darstellung nutzt Geisterknoten.
4. **Chunking nach Tiefe.** Ansicht = Fokus + Tiefe nach oben + Tiefe nach unten. Weiter entfernte Äste sind zugeklappt („+n“) und werden beim Aufklappen oder Heranzoomen nachgeladen.
5. **Bidirektionale Suche.** Zwei Fronten laufen aufeinander zu und liefern alle gemeinsamen Vorfahren.
6. **Worker für schwere Arbeit.** Parsing, Layout und Suche laufen im Web Worker. Der UI-Thread zeichnet nur.
7. **Lokal zuerst.** IndexedDB, kein Backend.

## Chunking im Detail

- `ViewRequest { focusId, up, down, mode }`
- Der Kern liefert pro Anfrage einen **Teilgraphen** (Personen + Unions + zugeklappte Ränder).
- Der Layout-Worker rechnet Positionen **pro Generationsschicht**; neue Chunks verschieben vorhandene Knoten nicht, sondern werden angehängt (stabiles Layout).
- Das Rendering zeichnet nur Knoten im Viewport (Culling) und vereinfacht bei starkem Auszoomen (Punkte statt Karten, Level of Detail).

## Layout

- Generationsindex: Fokus = 0, Eltern = −1, Kinder = +1. Bei Schleifen wird der Knoten in die tiefste benötigte Schicht gelegt.
- Partner stehen im selben Band, sortiert nach Ehe-Reihenfolge.
- Kanten: durchgezogen = belegt, gestrichelt = vermutet.
- Geisterknoten: Jede Person steht einmal echt. Wird sie über einen zweiten Weg erreicht (Ahnenschwund, Heirat unter Verwandten), entsteht dort eine Geisterkarte, die auf die echte verweist.
- Umsetzung in `src/core/layout` (Auswahl, Schichten, Bänder/Geister, Positionen); Details in DECISIONS D17–D20.

## Darstellung (`src/render`, M6)

- `LayoutResult` → `buildScene` (`scene.ts`, reines TS: Karten, rechtwinklige Linien, Raster-Indizes) → `TreeView` (`treeView.ts`, Canvas 2D, Zoom/Verschieben, Culling, Detailstufen, Klicks als Ereignisse). `Camera` und `GridIndex` sind reines TS und getestet.
- `src/ui/TreeViewer.svelte` ist nur die dünne Hülle: Modus, Tiefe, `LayoutClient`, Ereignisse von `TreeView` in neue Layout-Anfragen übersetzen. Details in DECISIONS D21 und D23.

## Provider-Schnittstelle (`src/providers`, M8, D25/D26)

```ts
interface Provider {
  id: string; label: string; needsKey: boolean; disclosure: string;
  search(query: PersonQuery, ctx?): Promise<ExternalPerson[]>;
  fetchRelatives(ref: ExternalRef, ctx?): Promise<ImportBatch>; // Eltern, Partner, Kinder
}
```

`wikidata.ts` (SPARQL), `wikitree.ts` (Adresse einstellbar, kein CORS), `familysearch.ts` (Gerüst). `adoptBatch` (`adopt.ts`, ohne Netz) macht aus einem `ImportBatch` neue Personen mit `status: "assumed"`; Dubletten schlägt `src/core/duplicates.ts` nur vor. Treffer werden nie automatisch mit vorhandenen Personen verschmolzen. Die Oberfläche (`OnlineDialog.svelte`) löst Abfragen nur auf Klick aus.

## Abhängigkeiten (geplant)

| Paket | Zweck |
|---|---|
| vite, typescript | Build, Typen |
| svelte | Oberfläche |
| ~~pixi.js~~ | nicht nötig: Canvas 2D reicht (D21) |
| idb | IndexedDB-Komfort (in M3 eingebaut) |
| fake-indexeddb (nur Tests) | IndexedDB in Node für `tests/storage` |
| vitest | Tests |
