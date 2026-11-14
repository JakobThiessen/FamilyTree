# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach SemVer.

## [Unreleased]

### Hinzugefügt (M6)
- Zeichenschicht `src/render` (Canvas 2D, ohne Framework): `Camera` (Zoom um den Zeiger, Verschieben, Einpassen), `GridIndex` (Raster fürs Viewport-Culling), `buildScene` (Karten mit Familienfarbe, rechtwinklige Linien mit Sammelschienen und Spuren), `TreeView` (Zeichnen, Mausrad, Ziehen, Zwei-Finger-Geste, Hover, Klick, Detailstufen)
- Linienstile: belegt durchgezogen, vermutet (`assumed`/`unknown`) gestrichelt, Adoption/Pflege gepunktet; Geisterkarten blasser mit gestricheltem Rahmen und „↺“
- Farbe pro Familienlinie (Nachname → Palette), „+n“-Knöpfe (▲ Eltern, ▼ Kinder) klappen auf, ohne dass sich vorhandene Karten bewegen
- `src/ui/TreeViewer.svelte`: Ansicht (Direkte Linie / Familie / Alle), Tiefe für Vorfahren und Nachfahren, Einpassen, Zoom-Knöpfe, zufällige Person, Anzeige von Layout- und Zeichenzeit; in `App.svelte` unter den geladenen Daten eingebunden
- Tests in `tests/render/render.test.ts` (Kamera, Raster, Szene, Linienstile, Spuren, Beispiele, 50.000 Personen)
- Entscheidungen D21 (Canvas 2D statt PixiJS, mit Messung), D22, D23
- Im Browser geprüft (Vite-Entwicklungsserver): `example/json/*` und `tree-50000.json`: Zoom, Verschieben, Aufklappen, Fokus wechseln

### Geändert (M6)
- Layout-Kern ohne Rekursion (`build.ts`: Generator mit eigenem Stapel, `layout.ts`: `computeExtents`, `place` mit Stapel), weil `all` bei großen Ansichten den Aufrufstapel sprengte (D22). Ergebnis und Reihenfolge unverändert.

### Bekannte Grenzen (M6)
- Modus `all` bei dichten Verwandtschaften: Layoutbreite wächst exponentiell (D22), die Darstellung bleibt stabil, ist aber nicht sinnvoll lesbar. `direct` und `family` sind unauffällig.
- Der Layout-Zeittest „vollständiger Ahnenbaum … unter 100 ms“ (M5) liegt auf dieser Maschine nahe an der Grenze und schlägt bei paralleler Last gelegentlich fehl (auch ohne M6-Änderungen).

### Hinzugefügt (M5)
- Layout-Kern `src/core/layout` (reines TypeScript): `layoutView(graph, request, options?, previous?)` und `LayoutSession` liefern `LayoutResult` mit Karten (`nodes`), Partnerbändern (`bands`), Union-Ankern (`unions`), Rahmen und Statistik
- Sanduhr mit Generationenschichten (Fokus 0, Eltern −1, Kinder +1), bei Schleifen tiefste benötigte Schicht (längster Weg); Modi `direct`, `family`, `all`
- Partnerbänder: Partner im selben Band, Mehrfach-Ehen nach `Union.order`; Geschwister und Halbgeschwister im Modus `family`/`all`
- Geisterknoten für doppelte Ahnen (Ahnenschwund) und doppelt erreichte Partner; „+n“-Zähler `hiddenParents`/`hiddenChildren`
- Inkrementell: gleicher Fokus und Modus = vorhandene Karten behalten x/y, `added` nennt neue Karten
- Layout-Worker: `src/workers/layoutWorker.ts`, `layoutHandler.ts`, `layoutMessages.ts`, `layoutClient.ts` (`LayoutClient`: `setData`, `layout`, `reset`, `dispose`)
- Tests in `tests/core/layout.test.ts` (Cousinenheirat, Mehrfach-Ehen, Schleifen, Adoption, kaputte Daten, inkrementell, Worker-Handler, Performance)
- Entscheidungen D17–D20
- Im Browser (Vite-Entwicklungsserver) geprüft: `LayoutClient` startet den Worker, Nachladen verschiebt nichts, Geister erscheinen

### Hinzugefügt (M4)
- `src/core/ancestry.ts`: `ancestorLevels` / `descendantLevels` (Personen je Tiefe), `ancestorProfile` (Wege je Tiefe), `pedigreeCollapse` / `hasPedigreeCollapse` (Ahnenschwund mit mehrfach erreichbaren Ahnen, Statistik je Tiefe und Implex)
- `src/core/kinship.ts`: `findCommonAncestors` (bidirektionale Suche, **alle** gemeinsamen Vorfahren, niedrigste markiert), `describeRelationship` (Blutsverwandtschaft mit mehreren Linien, Partner, Verwandtschaft durch Heirat) und `bloodRelationLabel` (deutsche Bezeichnungen: Onkel, Neffe, Cousin n. Grades, Halbgeschwister, Schwager, Stiefeltern …)
- `src/core/inbreeding.ts`: `KinshipCalculator` und `inbreedingCoefficient` (Wright/Malécot, mit Zwischenspeicher)
- Tests in `tests/core/kinship.test.ts` (Beispiele `example/json/*`, GEDCOM-Gegenprobe und erfundene Personen)
- Entscheidungen D14–D16

### Hinzugefügt (M3)
- Speicherschicht `src/storage` (IndexedDB über `idb`): `TreeStore` mit `saveTree`, `createTree`, `listTrees`, `getTree`, `renameTree`, `deleteTree`, `loadTree`
- Laden nach Bedarf: `loadPersons`, `loadUnionsOf` und `loadNeighborhood(treeId, focusId, {up, down})` (Teilgraph samt zitierter Quellen)
- Import wird in einer Transaktion gespeichert (alles oder nichts); mehrere Bäume in einer Datenbank, getrennt über `treeId`
- `App.svelte`: Knopf „Im Browser speichern“, Liste gespeicherter Bäume mit Laden, Umbenennen, Löschen
- Tests in `tests/storage/treeStore.test.ts` (mit `fake-indexeddb`)
- Abhängigkeiten: `idb` (laufzeit), `fake-indexeddb` (nur Tests), siehe DECISIONS D13
- Im Browser von Hand geprüft: Worker-Import, Drop-Ereignis, Speichern, Neuladen, Laden, Umbenennen, Löschen (M2-Rest damit erledigt)

### Hinzugefügt (M2)
- GEDCOM-Import (`src/import`): Zeilenparser, Zeichensätze (UTF-8, UTF-16, ANSEL, ISO-8859-1/ANSI), Datumsschlüsselwörter, Mapping auf `TreeData` mit Warnungen statt Abbruch
- GEDCOM-Export (`gedcomExport.ts`, UTF-8) und JSON-Export (`serializeTreeData` in `src/core/loader.ts`)
- Import-Worker (`src/workers/importWorker.ts`, `importClient.ts`) und Minimal-Oberfläche in `App.svelte`: Datei wählen oder ablegen, Zähler, Hinweise, Export-Knöpfe
- `Union.externalRefs` und `Source.externalRefs` (GEDCOM-Kennungen auch für Familien und Quellen)
- Tests in `tests/import/gedcom.test.ts` (Beispiele, Zeichensätze, Sonderfälle, Round-Trip)

### Hinzugefügt
- M1 Kern: `FamilyGraph` (`src/core/graph.ts`) mit Indizes und Abfragen: Eltern, Kinder, Partner in Ehe-Reihenfolge, Geschwister (voll/halb), Stiefeltern, Stiefkinder
- Validierung der Invarianten (Zyklen, hängende Verweise, Dubletten, doppelte biologische Unions, mehr als 2 Partner)
- Datumsmodell (`src/core/fuzzyDate.ts`): Parsen und Formatieren auf Deutsch (um, vor, nach, zwischen), Vergleich
- JSON-Loader (`src/core/loader.ts`) mit Formprüfung, Sammel-Export `src/core/index.ts`
- Beispiel `example/json/cousin-marriage.json`
- Tests in `tests/core/graph.test.ts` und `tests/core/fuzzyDate.test.ts`
- Projektgerüst mit Vite, TypeScript und Svelte
- Dokumentation in `docs/` (README, AGENTS, PLAN, ARCHITECTURE, DATA-MODEL, DATA-SOURCES, DECISIONS, GLOSSARY, TESTING, memory)
- Typen des Datenmodells (`src/core/types.ts`)
- Beispieldaten in `example/` (Mehrfach-Ehen, Heirat unter Cousins)
- Ordner `imports/` für eigene Importdateien (nicht in Git)
