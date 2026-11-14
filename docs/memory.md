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
- M0 (Gerüst) und M1 (Kern: Graph, Abfragen, Validierung, Datumsmodell, JSON-Loader) abgeschlossen. Nächster Schritt: **M2 – GEDCOM-Import und -Export**.
- Kern-API: `import { FamilyGraph, loadGraph, parseFuzzyDate, formatFuzzyDate } from "src/core"`. Der Graph wirft bei fehlerhaften Daten nicht, sondern sammelt Probleme in `validate()`.
- Der Loader liest keine Dateien (Aufrufer übergibt Text), damit der Kern in Browser, Worker und Node läuft.
- Offen für M2: GEDCOM-Daten (`ABT/BEF/AFT/BET`) auf `FuzzyDate` abbilden; `parseFuzzyDate` versteht bisher nur deutschen Text.

## Offene Fragen
- PixiJS oder Canvas 2D (Entscheidung bei M6 per Messung).
- Zweisprachigkeit DE/EN ab M9?

## Arbeitsumgebung
- Windows 11, Projekt in `D:\Proj\FamilyTree`, Node 22.
