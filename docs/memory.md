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
- M0 bis M5 abgeschlossen. Nächster Schritt: **M6 – Darstellung** (Canvas, Zoom/Verschieben, Culling, „+n“-Knoten, Personenkarten, Linienstile, Familienfarben, Test mit 50.000 Personen). M6 zeichnet nur, was `LayoutResult` liefert; der Layout-Kern bleibt unberührt.
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
- Layout-Qualität bei vielen Zusatzpersonen (`family`/`all`) ist „gut genug“; Feinschliff (Kreuzungen, Kantenführung) gehört in M6 nach Sicht im Browser.
- PixiJS oder Canvas 2D (Entscheidung bei M6 per Messung).
- Zweisprachigkeit DE/EN ab M9?

## Arbeitsumgebung
- Windows 11, Projekt in `D:\Proj\FamilyTree`, Node 22.
