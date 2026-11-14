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
- M0, M1 und M2 (GEDCOM-Import/-Export) abgeschlossen. Nächster Schritt: **M3 – Speicherung** (IndexedDB, mehrere Bäume).
- Kern-API: `import { FamilyGraph, loadGraph, parseFuzzyDate, formatFuzzyDate, serializeTreeData } from "src/core"`. Der Graph wirft bei fehlerhaften Daten nicht, sondern sammelt Probleme in `validate()`.
- Import-API (`src/import`, reines TS): `importGedcom(textOderBytes) -> { data: TreeData, warnings, charset? }`, `importFileContent(name, bytes)` (JSON oder GEDCOM), `exportGedcom(data)`, `parseGedcomDate`/`formatGedcomDate`. Im Browser läuft der Import über `src/workers/importClient.ts` (`importFileInWorker(file)`) im Web Worker.
- `App.svelte` ist nur eine Minimal-Oberfläche (Datei laden, Export-Knöpfe); der Baum liegt nur im Arbeitsspeicher. Echter Import-Dialog in M7, Speicherung in M3.
- Abbildungsregeln und bekannte Verluste des GEDCOM-Imports/-Exports: DECISIONS.md D12.
- Im Browser (Worker, Drag & Drop) noch nicht von Hand geprüft; Tests und Build laufen.

## Offene Fragen
- PixiJS oder Canvas 2D (Entscheidung bei M6 per Messung).
- Zweisprachigkeit DE/EN ab M9?

## Arbeitsumgebung
- Windows 11, Projekt in `D:\Proj\FamilyTree`, Node 22.
