# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach SemVer.

## [Unreleased]

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
