# memory.md – Projektstand

Diese Datei hält den Stand fest, damit jede neue Sitzung sofort weitermachen kann. Nach jeder Arbeit aktualisieren.

## Projekt in einem Satz
Browser-Stammbaumsoftware (TypeScript, Vite, Svelte), die von jeder Fokusperson aus in beide Richtungen arbeitet, tiefenabhängig in Chunks lädt/rendert und GEDCOM sowie offene Quellen (WikiTree, Wikidata) einbindet.

## Festgelegt
- Graph mit Unions (Mehrfach-Ehen, Halbgeschwister, Ahnenschwund bei Cousinenheirat), siehe DECISIONS.md D1–D8.
- Stack: TypeScript + Vite; Svelte nur für UI; Zeichenfläche Canvas/PixiJS; Kern ohne Framework.
- MyHeritage nur per GEDCOM-Export des Nutzers. Kein Scraping.
- Dokumente in `docs/`, Beispiele in `example/`, eigene Importdateien in `imports/`.
- Nutzer kennt Vite/React nur grundlegend: Code gut kommentieren, Schritte erklären.
- Inspiration: Stammbaum-App aus Niklas Steenfatts Video (kein Quellcode öffentlich gefunden). Dunkles Design, Familienlinien-Farben, gestrichelt = unbestätigt, Filter „Direkte Linie / Familie / Alle“.

## Aktueller Stand
- M0 bis M6 abgeschlossen. Nächster Schritt: **M7 – Oberfläche** (Svelte-Layout, Filter „Direkte Linie / Familie / Alle“, Personendetails, Suche, Fokus wechseln, Import-Dialog). Die Filter und Tiefe gibt es schon als schlichte Leiste in `src/ui/TreeViewer.svelte`; M7 baut sie aus.
- Darstellung (`src/render`, M6, D21/D23): `buildScene(result, personsMap)` → `Scene`; `new TreeView(canvas, {onFocus, onExpand, onDraw})`, `view.setPersons(map)`, `view.setResult(layoutResult, resetView)`, `fit()`, `zoomBy()`, `dispose()`. `Camera` und `GridIndex` sind reines TS. Canvas 2D (kein PixiJS), Messung in D21. Zeichenzeit bei 9.000 Karten eingepasst ca. 5 ms. „+n“ erhöht die Tiefe oder setzt den Fokus (D23). In `TreeViewer.svelte`: `{#key data}` in `App.svelte` baut die Ansicht bei neuen Daten neu auf.
- Layout-Kern ist seit M6 ohne Rekursion (D22). Bekannte Grenze: Modus `all` auf dichten Geflechten wird exponentiell breit (D22); Fix gehört in den Kern.
- Prüfen im Browser: `npm run dev`; Beispiele aus `example/` über die Dateiauswahl laden (die 50.000-Datei per `node scripts/generate-large-tree.mjs 50000` erzeugen, sie liegt nicht in Git).
- Verwandtschafts-API (`src/core`, M4, D14–D16): `ancestorLevels`/`descendantLevels(g, id, {maxDepth})`, `ancestorProfile`, `pedigreeCollapse(g, id)` (Ahnenschwund: `repeated`, `generations`, `implex`), `findCommonAncestors(g, a, b)` (alle gemeinsamen Vorfahren, `lowest` markiert), `describeRelationship(g, a, b)` (sagt, was A für B ist; `label`, `blood[]`, `partner`, `inLaw[]`), `bloodRelationLabel(up, down, sex, half)`, `inbreedingCoefficient(g, id)` bzw. `new KinshipCalculator(g)`. Für M5: `ancestorLevels`/`pedigreeCollapse` liefern die Schichten und doppelten Ahnen (Geisterknoten).
- Layout-API (`src/core/layout`, M5, D17–D20): `layoutView(graph, {focusId, up, down, mode}, options?, previous?)` bzw. `new LayoutSession({persons, unions}).layout(request)` -> `LayoutResult { nodes, bands, unions, bounds, added, stats, conflicts }`. Karten (`LayoutNode`) haben Mittelpunkt `x/y`, `layer`, `ghost`, `bandId`, `hiddenParents/hiddenChildren` („+n“). `LayoutUnion` ist der Ankerpunkt für Kinderlinien (`partnerKeys`, `children[].key/kind/status`). Geister: `ghost: true`, `personId` zeigt auf die echte Karte, Schlüssel `<id>~<Herkunft>`. Im Browser: `new LayoutClient()` aus `src/workers/layoutClient.ts` (`setData`, `layout`, `reset`, `dispose`); der Worker merkt sich die Positionen. Modi: `direct` (nur Linie), `family` (+ Partner, Geschwister), `all` (alles im Fenster −up..+down). Gleicher Fokus und Modus = inkrementell.
- Speicher-API (`src/storage`): `const store = await TreeStore.open()`; `saveTree(name, treeData)`, `listTrees`, `renameTree`, `deleteTree`, `loadTree`, `loadPersons(treeId, ids)`, `loadUnionsOf(treeId, personId)`, `loadNeighborhood(treeId, focusId, {up, down})` (liefert `TreeData`-Teilgraph, den man in `FamilyGraph` stecken kann; Ränder fehlen absichtlich). Schema und Entscheidungen: D13.
- Kern-API: `import { FamilyGraph, loadGraph, parseFuzzyDate, formatFuzzyDate, serializeTreeData } from "src/core"`. Der Graph wirft bei fehlerhaften Daten nicht, sondern sammelt Probleme in `validate()`.
- Import-API (`src/import`, reines TS): `importGedcom(textOderBytes) -> { data: TreeData, warnings, charset? }`, `importFileContent(name, bytes)` (JSON oder GEDCOM), `exportGedcom(data)`, `parseGedcomDate`/`formatGedcomDate`. Im Browser läuft der Import über `src/workers/importClient.ts` (`importFileInWorker(file)`) im Web Worker.
- `App.svelte` ist nur eine Minimal-Oberfläche (Datei laden, speichern, gespeicherte Bäume verwalten, Export-Knöpfe). Echter Import-Dialog in M7.
- Stolperstein: Svelte-`$state` macht Objekte zu Proxys, die IndexedDB nicht speichern kann. Baumdaten mit `$state.raw` halten oder `$state.snapshot` verwenden.
- Abbildungsregeln und bekannte Verluste des GEDCOM-Imports/-Exports: DECISIONS.md D12.
- Im Browser geprüft (M3): Worker-Import, Drop, Speichern, Neuladen, Laden, Umbenennen, Löschen. Tests, Typecheck und Build laufen.

## Offene Fragen
- Layout im Modus `all` bei dichten Verwandtschaften (exponentielle Breite, D22) beheben; Kreuzungen in `family` sind nach der rechtwinkligen Linienführung (D23) akzeptabel.
- Farbe der Familienlinie über Frauen (Mädchenname) statt Nachname? (M7/M9)
- Aufklappen einzelner Äste statt ganzer Schichten (braucht pro Karte erweiterte Anfrage im Kern).
- Zweisprachigkeit DE/EN ab M9?

## Arbeitsumgebung
- Windows 11, Projekt in `D:\Proj\FamilyTree`, Node 22.
