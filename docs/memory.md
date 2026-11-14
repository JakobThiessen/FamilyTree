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
- M0 bis M8 und **M7b** abgeschlossen (M7b = Zeichenfläche und Rahmen, D28). **M9a (Ahnen, D29)**, **M9b (Zeitleiste, D30)** und **M9c (Karte, D31)** fertig. Nächster Schritt: **M9 – Feinschliff** (optional vorher Forschung/Quellen, UI-KONZEPT.md Schritt 6), danach **M9 – Feinschliff** (Export PDF/SVG, Barrierefreiheit, Mobile, DE/EN, Backup, PWA).
- Ahnen (M9a, D29): `src/core/pedigree.ts` `buildAhnentafel(g, id, {maxDepth, maxRows})` → `generations[].rows[]` (`sosa`, `personId`, `duplicateOf`), `pedigreeReport` (+ Ahnenschwund, Inzucht). UI `AncestorsView.svelte` (Props `graph`, `persons`, `focusId`, `onPick`); Klick ruft in `App.svelte` `pickKeepTab` (Fokus setzen, Reiter bleibt).
- Zeitleiste (M9b, D30): `src/core/timeline.ts` `buildTimeline(g, ids, {lifespan, parentAge, maxRows, aroundYear})` → `rows[]` (`start/end`, `birth/death` als Range, `startDerived/endDerived`, `markers`), `timelinePersonIds(g, focus, "lineage"|"all", depth)`. UI `TimelineView.svelte` (SVG, ≤ 600 Zeilen). Browser-Messungen schwanken (gedrosseltes Pane), Kernzeiten in Node messen.
- Karte (M9c, D31): `src/core/places.ts` `collectPlaces(g, ids?, known?)`, `lifePaths`, `placeKey`; `src/providers/placeLookup.ts` `lookupPlace(name)` (Wikidata, nur Ortsnamen, nur auf Knopfdruck); abgefragte Koordinaten liegen im `localStorage` (`familytree.placeCoords.v1`), nicht im Baum. UI `MapView.svelte` + handgebaute `worldMap.ts` (grob; später ggf. Natural Earth). Beispiel mit Orten: `example/json/migration.json` (die anderen Beispiele haben fast keine Orte, `tree-50000.json` keine).
- README: Projektübersicht liegt in `README.md` im Hauptverzeichnis, `docs/README.md` ist nur der Index.
- Online-Quellen (`src/providers`, M8, D25–D27): `createWikidataProvider()`, `createWikiTreeProvider({baseUrl})`, `createFamilySearchProvider({accessToken})` mit `search(query, ctx)` und `fetchRelatives(ref, ctx)`; `adoptBatch(treeData, batch, {linkTo, includeRelatives})` (ohne Netz) → `AdoptResult`; Dubletten `DuplicateFinder`/`findDuplicates` in `src/core/duplicates.ts`; `TreeStore.replaceTree(id, data)`. UI: `OnlineDialog.svelte`, Knopf „Online suchen …“. **WikiTree hat kein CORS**: im Browser nur über den Vite-Proxy `/wikitree` (nur `npm run dev`) oder einen eigenen Durchleiter. FamilySearch ist nur Gerüst, ungeprüft. Wikidata-Suche dauert ca. 5 s. WikiTree liefert bei Kindern oft nur Nachnamen.
- M7b (D28): `App.svelte` hat Reiter über `tab` (`$state`); der Stammbaum bleibt beim Reiterwechsel gemountet (nur `display:none`). Suche sitzt in der Kopfleiste. `TreeViewer.svelte` bekommt `graph` (für `roleOf`) und hat das schwebende Filterpanel; `view.setOptions({lineMode, showUnconfirmed, showUnknown})` baut nur die Szene neu (Filter wirken in `buildScene`, nicht im Layout). Standard der Linien: S-Kurven (`SceneEdge.curve`, 8 Zahlen), Kamerafahrt bei Fokuswechsel (`TreeView.anim`), `setInset(px)` lässt links Platz fürs Panel. Zähler „x von y“ = Personen der Ansicht vor/nach Filter.
- Oberfläche (`src/ui`, M7, D24): `App.svelte` (Kopfleiste, Layout, Drop im ganzen Fenster, Export), `TreeViewer.svelte` (Zeichenfläche, Filter, Tiefe; `focusOn(id)`, `onFocusChange`), `SearchBox.svelte` + `src/core/search.ts` (`PersonSearchIndex`), `PersonDetails.svelte` + `personInfo.ts` (`describePerson`), `ImportDialog.svelte` (Datei lesen, Hinweise, speichern, gespeicherte Bäume). Suche läuft im Hauptthread (D24, gemessen).
- Darstellung (`src/render`, M6, D21/D23): `buildScene(result, personsMap)` → `Scene`; `new TreeView(canvas, {onFocus, onExpand, onDraw})`, `view.setPersons(map)`, `view.setResult(layoutResult, resetView)`, `fit()`, `zoomBy()`, `dispose()`. `Camera` und `GridIndex` sind reines TS. Canvas 2D (kein PixiJS), Messung in D21. Zeichenzeit bei 9.000 Karten eingepasst ca. 5 ms. „+n“ erhöht die Tiefe oder setzt den Fokus (D23). In `TreeViewer.svelte`: `{#key data}` in `App.svelte` baut die Ansicht bei neuen Daten neu auf.
- Layout-Kern ist seit M6 ohne Rekursion (D22). Bekannte Grenze: Modus `all` auf dichten Geflechten wird exponentiell breit (D22); Fix gehört in den Kern.
- Prüfen im Browser: `npm run dev` (oder `.claude/launch.json`); Beispiele aus `example/` über „Öffnen / Import …“ laden (die 50.000-Datei per `node scripts/generate-large-tree.mjs 50000` erzeugen, sie liegt nicht in Git).
- Verwandtschafts-API (`src/core`, M4, D14–D16): `ancestorLevels`/`descendantLevels(g, id, {maxDepth})`, `ancestorProfile`, `pedigreeCollapse(g, id)` (Ahnenschwund: `repeated`, `generations`, `implex`), `findCommonAncestors(g, a, b)` (alle gemeinsamen Vorfahren, `lowest` markiert), `describeRelationship(g, a, b)` (sagt, was A für B ist; `label`, `blood[]`, `partner`, `inLaw[]`), `bloodRelationLabel(up, down, sex, half)`, `inbreedingCoefficient(g, id)` bzw. `new KinshipCalculator(g)`. Für M5: `ancestorLevels`/`pedigreeCollapse` liefern die Schichten und doppelten Ahnen (Geisterknoten).
- Layout-API (`src/core/layout`, M5, D17–D20): `layoutView(graph, {focusId, up, down, mode}, options?, previous?)` bzw. `new LayoutSession({persons, unions}).layout(request)` -> `LayoutResult { nodes, bands, unions, bounds, added, stats, conflicts }`. Karten (`LayoutNode`) haben Mittelpunkt `x/y`, `layer`, `ghost`, `bandId`, `hiddenParents/hiddenChildren` („+n“). `LayoutUnion` ist der Ankerpunkt für Kinderlinien (`partnerKeys`, `children[].key/kind/status`). Geister: `ghost: true`, `personId` zeigt auf die echte Karte, Schlüssel `<id>~<Herkunft>`. Im Browser: `new LayoutClient()` aus `src/workers/layoutClient.ts` (`setData`, `layout`, `reset`, `dispose`); der Worker merkt sich die Positionen. Modi: `direct` (nur Linie), `family` (+ Partner, Geschwister), `all` (alles im Fenster −up..+down). Gleicher Fokus und Modus = inkrementell.
- Speicher-API (`src/storage`): `const store = await TreeStore.open()`; `saveTree(name, treeData)`, `listTrees`, `renameTree`, `deleteTree`, `loadTree`, `loadPersons(treeId, ids)`, `loadUnionsOf(treeId, personId)`, `loadNeighborhood(treeId, focusId, {up, down})` (liefert `TreeData`-Teilgraph, den man in `FamilyGraph` stecken kann; Ränder fehlen absichtlich). Schema und Entscheidungen: D13.
- Kern-API: `import { FamilyGraph, loadGraph, parseFuzzyDate, formatFuzzyDate, serializeTreeData } from "src/core"`. Der Graph wirft bei fehlerhaften Daten nicht, sondern sammelt Probleme in `validate()`.
- Import-API (`src/import`, reines TS): `importGedcom(textOderBytes) -> { data: TreeData, warnings, charset? }`, `importFileContent(name, bytes)` (JSON oder GEDCOM), `exportGedcom(data)`, `parseGedcomDate`/`formatGedcomDate`. Im Browser läuft der Import über `src/workers/importClient.ts` (`importFileInWorker(file)`) im Web Worker.
- Stolperstein: Svelte-`$state` macht Objekte zu Proxys, die IndexedDB nicht speichern kann. Baumdaten mit `$state.raw` halten oder `$state.snapshot` verwenden.
- Abbildungsregeln und bekannte Verluste des GEDCOM-Imports/-Exports: DECISIONS.md D12.
- Der Layout-Zeittest in `tests/core/layout.test.ts` hat eine Grenze von 250 ms (parallele Testdateien machen ihn sonst unzuverlässig).
- Im Browser geprüft (M3): Worker-Import, Drop, Speichern, Neuladen, Laden, Umbenennen, Löschen. Tests, Typecheck und Build laufen.

## Offene Fragen
- Layout im Modus `all` bei dichten Verwandtschaften (exponentielle Breite, D22) beheben; Kreuzungen in `family` sind nach der rechtwinkligen Linienführung (D23) akzeptabel.
- Farbe der Familienlinie über Frauen (Mädchenname) statt Nachname? (M9)
- Personen bearbeiten (Daten ändern, Speicher aktualisieren) – noch nicht geplant; nur die Übernahme externer Treffer ändert Bäume (`replaceTree`, D27). Echtes Zusammenführen von Dubletten fehlt (nur „Ist dieselbe Person“ = Verweis, D26).
- FamilySearch gegen den echten Dienst prüfen (Schlüssel nötig); WikiTree-Durchleiter für den gebauten Stand – Entscheidung des Nutzers.
- Karte: Linien über den 180.-Längengrad werden quer gezeichnet; Weltkarte ist sehr grob.
- Mobile Bedienung und Barrierefreiheit der Zeichenfläche (M9).
- Aufklappen einzelner Äste statt ganzer Schichten (braucht pro Karte erweiterte Anfrage im Kern).
- Zweisprachigkeit DE/EN ab M9?

## Arbeitsumgebung
- Windows 11, Projekt in `D:\Proj\FamilyTree`, Node 22.
