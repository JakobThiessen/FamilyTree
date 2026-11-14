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
  (Canvas)          (Svelte)
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

## Provider-Schnittstelle (Entwurf)

```ts
interface Provider {
  id: string;
  search(query: PersonQuery): Promise<ExternalPerson[]>;
  fetchRelatives(ref: ExternalRef, depth: number): Promise<ImportBatch>;
}
```

Treffer werden als `assumed` importiert und nie automatisch mit vorhandenen Personen verschmolzen.

## Abhängigkeiten (geplant)

| Paket | Zweck |
|---|---|
| vite, typescript | Build, Typen |
| svelte | Oberfläche |
| pixi.js (optional, M6) | WebGL-Rendering |
| idb | IndexedDB-Komfort (in M3 eingebaut) |
| fake-indexeddb (nur Tests) | IndexedDB in Node für `tests/storage` |
| vitest | Tests |
