# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach SemVer.

## [Unreleased]

### Hinzugefügt (M10 Schritt 1+2: Änderungs-Kern und gezieltes Speichern, D38)
- `src/core/edit.ts` (reines TS): `applyEdit(data, op)` → `{ ok, data, inverse, touched, created, notes }` oder `{ ok: false, reject }`. Operationen `addPerson`/`updatePerson`/`deletePerson`, `addUnion`/`updateUnion`/`deleteUnion`, `linkChild`/`unlinkChild`, `addSource`/`updateSource` und `patch` (Umkehr/Redo). Prüft die Invarianten (kein Zyklus, Kind höchstens in einer biologischen Union, Partner/Kinder/Quellen existieren, höchstens 2 verschiedene Partner). Person löschen: raus aus Unions, Kinder bleiben, Union ohne Partner und ohne Kinder verschwindet. `changesFromTouched(data, touched)` macht aus den berührten IDs eine Änderungsliste (`TreeChanges`)
- Ablehnungen (`edit.reject.*`) und Hinweise (`edit.note.*`) als Code + Parameter (D37); Übersetzungen in der UI folgen mit Schritt 4–6
- `src/core/ids.ts`: `IdSource` (fortlaufende IDs `p_n`/`u_n`/`s_n`) aus `adoptBatch` ausgelagert, Verhalten unverändert
- `TreeStore.applyChanges(treeId, { putPersons, deletePersons, putUnions, deleteUnions, putSources, deleteSources })`: eine Transaktion, Hilfsfelder `partnerKeys`/`childKeys` neu gebildet, Zähler und `updatedAt` im `trees`-Eintrag nachgeführt, Rollback bei Fehler
- Tests: neue `tests/core/edit.test.ts` (17) und 5 in `tests/storage/treeStore.test.ts` (Speicher = Datenbank, Nachbarschaft/Unions nach Änderungen, Rollback, Undo), insgesamt 271 Tests grün; keine UI-Änderung

### Hinzugefügt (Nachfolgearbeiten nach M9, Quellenangabe)
- Inspirationsquelle (Video von Niklas Steenfatt, 6:00–7:22) mit Link im `README.md` (Abschnitt „Inspiration“), `docs/UI-KONZEPT.md` und `docs/memory.md`

### Geändert (Nachfolgearbeiten nach M9, README-Bilder)
- Die vier Aufnahmen in `docs/screenshots/` neu erstellt (ohne Reiter „Forschung/Quellen“, mit neuem Filterpanel und der Natural-Earth-Karte); Bildunterschriften in `README.md` angepasst

### Hinzugefügt (Nachfolgearbeiten nach M9, Schritt 5: restliche Texte DE/EN, D37)
- Kern liefert Meldungen als Code + Parameter neben dem deutschen Text: GEDCOM-Hinweise (14 Codes), `validate()` (`params`), Dateiformat-/Backup-Fehler (`TreeFormatError.code`), Anbieterfehler (`ProviderError.detail`), Dublettengründe (`reasonCodes`), Worker-Fehler (`CodedError`), `TreeNotFoundError`
- `src/ui/messages.ts` übersetzt sie (`warningText`, `issueText`, `errorText`, `reasonText`, `disclosureText`); 69 neue Schlüssel in `de.ts` und `en.ts`; Import-Dialog, Online-Dialog, Karte, Stammbaum und Speicherfehler nutzen sie
- `adoptBatch(…, { lang })`: Vermerk „Übernommen aus …“ und Hinweise auf Deutsch oder Englisch; der Online-Dialog übergibt die Sprache
- Tests: neue `tests/ui/messages.test.ts` (Codes ↔ deutscher Text, Englisch, Fehler, Dubletten, `lang`), insgesamt 249 Tests grün
- Im Browser geprüft (EN): Import einer fehlerhaften GEDCOM-Datei zeigt englische Hinweise mit Zeilennummern

### Geändert (Nachfolgearbeiten nach M9, Schritt 4: Weltkarte aus Natural Earth)
- `src/ui/worldMap.ts` wird jetzt von `scripts/build-world-map.mjs` aus Natural Earth 1:50m erzeugt (352 Landringe, 28 große Seen, 95 kB; vorher 6 kB handgebaut, grob). Gleiche Schnittstelle (`LAND`, `INLAND_SEAS`, `MAP_BOUNDS`), `MapView.svelte` unverändert
- D36 (Quelle, Lizenz, Größe), `LIZENZ.md` aktualisiert; keine neue Abhängigkeit
- Im Browser geprüft: `migration.json` und 50.000-Baum, Lebenswege laufen weiter über die Datumsgrenze (D35)

### Geändert (Nachfolgearbeiten nach M9, Schritt 3: Orte im Testbaum)
- `scripts/generate-large-tree.mjs`: Geburts- und Sterborte (20 echte Städte mit Koordinaten direkt am Ort, wie bei GEDCOM `MAP`; Auswanderung nach Übersee, auch über die Datumsgrenze), Sterbejahr für etwa zwei Drittel; Linien sterben nicht mehr aus (kleine Generationen bekommen mehr Kinder). Der Baum ist dadurch nicht mehr derselbe wie bei der Gesamtprüfung (15,5 MB statt kleiner)
- `example/performance/README.md` korrigiert (erzeugt nur `.json`)
- Im Browser geprüft: Karte mit „Alle Personen“, 20 Orte, 50.000 Lebenswege, Marken auch in Neuseeland und Hawaii; Wechsel dauert etwa 2–3 s

### Hinzugefügt (Nachfolgearbeiten nach M9, Schritt 2: Filter zurücksetzen)
- Filterpanel (`TreeViewer.svelte`): Knopf „Zurücksetzen“ (Standard: Familie, Tiefe 2/2, unbestätigt und unbekannt sichtbar; ausgegraut, solange nichts geändert ist) und „Ganzer Baum“ (Ansicht „Alle“, Tiefe 30, alle Schalter an)
- Bei Bäumen über 3.000 Personen begrenzt „Ganzer Baum“ die Tiefe auf 6 und zeigt einen Hinweis (Leistung, D22); Texte DE/EN (`viewer.reset*`, `viewer.whole*`)
- Im Browser geprüft: `migration.json` (7 → 8 → 7 Personen) und 50.000-Personen-Baum (Hinweis, 17 Karten, Layout 2,7 ms)

### Entfernt (Nachfolgearbeiten nach M9, Schritt 1)
- Deaktivierte Reiter „Forschung“ und „Quellen“ samt Texten (`app.tab.research*`, `app.tab.sources*`) aus `App.svelte`, `de.ts`, `en.ts`; Quellen am Datenmodell, im GEDCOM-Import und in den Personendetails bleiben unverändert

### Hinzugefügt (M9, Schritt 4: Barrierefreiheit, Mobile)
- Zeichenfläche per Tastatur (Pfeile, +/-, 0), Textalternative (Personenliste) und Live-Ansage bei Fokuswechsel, Skip-Link, `<main>`, sichtbare Fokusringe, `aria-activedescendant` in der Suche (D35)
- `prefers-reduced-motion`: keine Übergänge, keine Kamerafahrt (`TreeView.showFocus`, eine Zeile)
- Mobile: Kopfleiste mit seitlich scrollbaren Zeilen statt Überlaufen, Filterpanel und Details starten eingeklappt auf schmalen Fenstern, größere Touch-Ziele (`pointer: coarse`)
- Karte: `unwrapLongitudes` (Kern) und Zeichnen mit ±360°-Versatz, Lebenswege über den 180. Längengrad laufen den kurzen Weg; Tests in `tests/core/places.test.ts`
- Im Browser geprüft (375 px): kein seitliches Scrollen, Tastaturereignisse auf dem Canvas, Ansage und Personenliste

### Hinzugefügt (Doku und Lizenz)
- `LICENSE` (MIT) und `"license": "MIT"` in `package.json`
- `LIZENZ.md`: Lizenzübersicht der Abhängigkeiten (ISC, MIT, Apache-2.0, MPL-2.0 nur in Werkzeugen) und Datenquellen
- `README.md`: Abschnitt „Bilder“ mit vier Aufnahmen (`docs/screenshots/`), Abschnitt „Lizenz“ verweist auf `LICENSE` und `LIZENZ.md`

### Hinzugefügt (M9, Schritt 3: DE/EN)
- Sprachumschalter in der Kopfleiste ist aktiv (D34): `src/ui/i18n.ts`, `lang.svelte.ts`, Wörterbücher `locales/de.ts` / `en.ts`; Wahl bleibt gespeichert, `<html lang>` folgt
- Alle Texte der Oberfläche in Deutsch und Englisch (Kopfleiste, Import/Backup, Filterpanel, Personendetails, Suche, Online-Dialog, Ahnen, Zeitleiste, Karte)
- Kern: `formatFuzzyDate(d, lang)`, `describeRelationship`/`bloodRelationLabel` mit `lang` (englische Verwandtschaftsbezeichnungen), `TimelineMarker.who`
- `TreeView.refreshLabels()`, `setUnknownName`; Tests `tests/ui/i18n.test.ts` (gleiche Schlüssel und Platzhalter, Mehrzahl, Daten, Verwandtschaft)
- Im Browser geprüft: Wechsel auf EN mit `migration.json` in allen vier Reitern, Persistenz nach Neuladen

### Hinzugefügt (M9, Schritt 2: Export)
- `src/render/svgExport.ts` (D33): `sceneToSvg`, `xmlEscape` – SVG der ganzen Ansicht, hell (Druck) oder dunkel
- Reiter Stammbaum: Knöpfe „SVG“ (Datei) und „Druck“ (Druckdialog, PDF über „Als PDF speichern“), Druck-Stil in `app.css`
- Tests `tests/render/render.test.ts` (SVG-Aufbau, Maskierung, leere Szene); im Browser geprüft: Druckbereich mit 10 Karten, `@page` quer

### Hinzugefügt (M9, Schritt 1: Backup/Restore)
- `src/import/backup.ts` (D32): `serializeBackup`, `parseBackup`; `TreeStore.exportAll` / `restoreAll` (additiv, nichts wird überschrieben)
- Dialog „Stammbaum öffnen“: „Alle sichern (Backup)“ und „Backup einspielen …“
- Tests in `tests/storage/treeStore.test.ts`; im Browser geprüft (Sichern, Einspielen, Liste wächst)

### Hinzugefügt (M9c)
- `src/core/places.ts` (D31): `collectPlaces`, `lifePaths`, `placeKey` (Orte zusammenfassen, Lebenswege je Person)
- `src/providers/placeLookup.ts`: `lookupPlace` / `lookupPlaces` (Koordinaten per Wikidata, nur Ortsnamen, nur auf Knopfdruck)
- Reiter „Karte“ (`MapView.svelte`, `worldMap.ts`): mitgelieferte vereinfachte Offline-Weltkarte, Modi Orte und Lebenswege, Zoom/Verschieben, Orteliste mit Ereignissen, vermutete Lage (Wikidata) als hohle Marke, Zwischenspeicher im Browser
- Beispiel `example/json/migration.json` (Auswanderung mit Orten und Koordinaten); Tests `tests/core/places.test.ts`, `tests/providers/placeLookup.test.ts`
- Im Browser geprüft: `example/json/*`, `example/gedcom/*`, `tree-50000.json` (ohne Orte), echte Abfrage bei Wikidata

### Hinzugefügt (M9b)
- `src/core/timeline.ts` (D30): `buildTimeline`, `timelinePersonIds`, `dateRange` (Lebensbalken mit unscharfen Rändern, geschätzte Daten markiert, Marker für Ehen und Kindergeburten, Kürzen auf 600 Zeilen)
- Reiter „Zeitleiste“ (`TimelineView.svelte`): Balken auf Zeitachse mit Gitter, Auswahl (Fokus-Verwandtschaft oder alle), Tiefe, Zoom, Legende, Klick auf Namen wechselt den Fokus
- Tests `tests/core/timeline.test.ts`
- Im Browser geprüft: `example/json/*`, `example/gedcom/*`, `tree-50000.json`

### Geändert
- `README.md` im Hauptverzeichnis ist jetzt die vollständige Projektübersicht (GitHub-Startseite); `docs/README.md` ist nur noch der Dokumentenindex

### Hinzugefügt (M9a)
- `src/core/pedigree.ts` (D29): `buildAhnentafel`, `fatherAndMother`, `pedigreeReport` (Ahnentafel mit Sosa-Nummern je Generation, Verweis auf doppelte Ahnen, Ahnenschwund, Inzuchtkoeffizient)
- Reiter „Ahnen“ (`AncestorsView.svelte`): Kennzahlen (Ahnenplätze, doppelte Ahnen, Implex, Inzuchtkoeffizient), Liste der doppelten Ahnen, Tabelle je Generation, einstellbare Tiefe (2–20), Klick wechselt den Fokus
- Tests `tests/core/pedigree.test.ts` (Cousinenheirat, Mini-Baum, Grenzen)
- Im Browser geprüft: `example/json/*`, `example/gedcom/*`, `tree-50000.json` (Tiefe 20 in unter 25 ms)

### Hinzugefügt (M7b)
- Zeichenfläche (`src/render`, D28): Verbindungen als S-Kurven (umschaltbar „geschwungen / rechtwinklig“, Standard geschwungen), Karten mit größerem Eckenradius und Avatar-Kreis mit Initialen in der Familienfarbe, Leuchten nur bei Fokus und Hover, Hintergrundverlauf, weiche Kamerafahrt bei Fokuswechsel; bei starkem Herauszoomen Kurven als Gerade
- `buildScene(result, persons, options)` mit `lineMode`, `showUnconfirmed`, `showUnknown`; `Scene.visiblePersons/totalPersons`; `isUnknownPerson`, `initials` in `style.ts`; `TreeView.setOptions`, `setInset`, `visibleCounts`, Ereignis `roleOf`
- Rahmen (`App.svelte`): Kopfleiste mit Reitern Stammbaum · Ahnen · Zeitleiste · Karte (Forschung und Quellen deaktivierte Platzhalter), Suche in der Kopfleiste (springt immer zum Stammbaum), DE/EN-Platzhalter; Reiterwechsel über ein `$state`-Feld, der Stammbaum bleibt dabei erhalten; Ahnen, Zeitleiste, Karte zeigen „Folgt“
- Stammbaum-Panel (`TreeViewer.svelte`): schwebendes, einklappbares Filterpanel mit Direkte Linie / Familie / Alle, „x von y Personen sichtbar“, Schaltern „Unbestätigte Verbindungen“ und „Unbekannte Personen“, Tiefe, Familienlinien-Legende (bis 8 Nachnamen mit Farbe und Zahl), Linienlegende und Linienführung; Rolle zur Fokusperson auf den Karten (`describeRelationship`, ab Zoom 0,55); Zoomknöpfe schweben unten rechts
- Tests in `tests/render` (Kurven, Filter, Initialen); Entscheidung D28 mit Messung
- Im Browser geprüft: `example/json/*`, `example/gedcom/*`, `tree-50000.json` (Zeichenzeit 0,1–3,6 ms), Reiterwechsel, Suche aus einem anderen Reiter, Filterschalter

### Hinzugefügt (M8)
- Provider-Schnittstelle `src/providers` (reines TS): `Provider` (`search`, `fetchRelatives`), `ExternalPerson`, `ImportBatch`, `ProviderError` (`network`, `http`, `format`, `config`, `unsupported`); `fetch` ist über den Kontext austauschbar (Tests ohne Netz)
- Wikidata (`wikidata.ts`, SPARQL, Volltextsuche nach Menschen, Geburt/Tod mit Genauigkeit, Eltern/Partner/Kinder), WikiTree (`wikitree.ts`, `searchPerson`/`getRelatives`, Adresse einstellbar), FamilySearch (`familysearch.ts`, nur Gerüst: Suche mit Zugriffstoken, ungeprüft, keine Verwandten)
- Dublettenvorschläge `src/core/duplicates.ts` (`DuplicateFinder`, `findDuplicates`): Name, Jahre, Geschlecht, mit Gründen und Stufe; nie automatisches Zusammenführen
- Übernahme `src/providers/adopt.ts` (`adoptBatch`, reines TS): neue Personen, Partnerschaften und Kinder-Verknüpfungen mit `status: "assumed"` und Quelle mit Link; „Ist dieselbe Person“ hängt nur Verweis und Notiz an eine vorhandene Person; bereits übernommene Verweise werden wiederverwendet
- `TreeStore.replaceTree(treeId, data)`: Inhalt eines gespeicherten Baums in einer Transaktion ersetzen
- Oberfläche: „Online suchen …“ (`OnlineDialog.svelte`) mit Quellenwahl, Hinweis, was gesendet wird, Trefferliste mit Dublettenhinweisen, Übernahme (optional mit Verwandten); `App.svelte` ersetzt/aktualisiert den Baum, springt zur Person und zeigt eine Meldung
- Vite-Dev-Proxy `/wikitree` (nur `npm run dev`; WikiTree hat kein CORS)
- Tests `tests/providers` (Anbieter mit nachgebauten Antworten, Dubletten, Übernahme, `replaceTree`)
- Entscheidungen D25–D27
- Im Browser geprüft: Wikidata-Suche und Übernahme (mit Verwandten, Dublettenhinweis, „Ist dieselbe Person“), WikiTree über den Dev-Proxy (Suche, Übernahme mit Verwandten, gespeicherter Baum wird aktualisiert und nach Neuladen wieder gelesen), CORS-Fehlermeldung ohne Proxy

### Hinzugefügt (M7)
- Oberfläche (Svelte): Kopfleiste (Name, Speichern, GEDCOM-/JSON-Export, Details ein/aus, „Öffnen / Import …“), Zeichenfläche mit Bedienleiste, rechts Suche und Personendetails; auf schmalen Fenstern liegen die Details unter der Zeichenfläche
- Filter „Direkte Linie / Familie / Alle“ als Knopfgruppe mit Erklärung (Tooltip), Tiefe für Vorfahren und Nachfahren, Einpassen, Zoom
- `src/ui/PersonDetails.svelte` und `src/ui/personInfo.ts` (`describePerson`, reines TS): Geburt/Tod mit Datum, Ort, Status und Quellen (Titel, Fundstelle, Link nur für http/https), Notizen, Status (belegt/vermutet/unbekannt), Eltern, Partnerschaften mit Kindern, Geschwister (voll/halb), Kennungen; Verwandte sind anklickbar und wechseln den Fokus
- Namenssuche `src/core/search.ts` (`PersonSearchIndex`, `normalizeText`): ohne Akzente und Groß-/Kleinschreibung, mehrere Wörter, auch Lebensjahre; Wortanfang vor Treffer im Wort. `SearchBox.svelte` mit Trefferliste (Pfeiltasten, Enter, Esc, Taste „/“)
- Import-Dialog `src/ui/ImportDialog.svelte` (native `<dialog>`): Datei wählen oder irgendwo im Fenster ablegen, Ergebnis mit Zahlen, Zeichensatz, allen Import-Hinweisen und Baumproblemen, Name zum Speichern, „Nur anzeigen“ oder „Speichern und anzeigen“; gespeicherte Bäume öffnen, umbenennen, löschen. Beim Start öffnet sich der Dialog
- Tests `tests/ui/ui.test.ts` (Suche, Personendetails)
- Entscheidung D24
- Im Browser geprüft (Vite-Entwicklungsserver): `example/json/*`, `example/gedcom/*`, 50.000-Personen-Baum (Import, Speichern, Neuladen aus IndexedDB, Suche, Fokus über Suche/Details/Karte, alle drei Filter), kaputte GEDCOM-Datei mit Warnungen

### Geändert (M7)
- `TreeViewer.svelte`: Fokus kommt auch von außen (`focusOn(id)`), meldet Wechsel über `onFocusChange`; Knopf „Zufällige Person“ entfällt (Suche ersetzt ihn); Zeichenfläche füllt die verfügbare Höhe
- `App.svelte` neu aufgebaut (die Minimal-Oberfläche aus M2/M3 entfällt); Stil mit CSS-Variablen in `app.css`
- Test `tests/core/layout.test.ts`: Zeitgrenze für den 1.750-Karten-Chunk von 100 auf 250 ms (allein ca. 55 ms, bei paralleler Ausführung der Testdateien über 100 ms; schlug schon vor M7 sporadisch fehl). Layout-Kern unverändert.

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
