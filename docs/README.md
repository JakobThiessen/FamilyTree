# FamilyTree

Browserbasierte Stammbaum-Software in TypeScript. Sie arbeitet von **beiden Seiten** aus: Du wählst eine beliebige Person als Fokus und gehst nach oben (Ahnen) und nach unten (Nachfahren). Die Daten werden **tiefenabhängig in Chunks** geladen und gerendert, damit auch sehr große Bäume flüssig bleiben.

## Ziele

- Beliebige Fokusperson, Ansicht in beide Richtungen (Sanduhr-Layout)
- Performant bei 50.000+ Personen (Chunking, Viewport-Culling, Web Worker)
- Historische Realität: mehrere Ehen nacheinander, Halbgeschwister, Heirat unter Cousins (Ahnenschwund)
- Unsichere Daten sind normal: Status „belegt / vermutet / unbekannt“ plus Quelle
- Import eigener Daten (GEDCOM, z. B. MyHeritage-Export) und offene Quellen (WikiTree, Wikidata)
- Lokal zuerst: alles im Browser (IndexedDB), kein Server, Daten bleiben privat

## Technik

TypeScript · Vite · Svelte (nur Oberfläche) · Canvas/PixiJS (Zeichenfläche) · Web Worker · IndexedDB · Vitest

Der Kern (`src/core`) ist reines TypeScript ohne Framework-Bezug.

## Schnellstart

```bash
npm install
npm run dev        # Entwicklungsserver
npm run build      # Produktionsbuild
npm run typecheck  # TypeScript prüfen
npm test           # Tests
```

## Ordnerstruktur

| Ordner | Inhalt |
|---|---|
| `docs/` | **alle** Dokumente (Plan, Architektur, Entscheidungen, Changelog, Memory) |
| `example/` | Beispieldaten zum Testen, nach Format getrennt (`gedcom`, `json`, `performance`) |
| `imports/` | **eigene** Dateien zum Importieren (GEDCOM, JSON). Inhalt wird nicht in Git eingecheckt |
| `src/core` | Datenmodell, Graph, Suche, Verwandtschaft, Layout (ohne UI) |
| `src/import` | GEDCOM-Parser und Export |
| `src/providers` | Online-Quellen (WikiTree, Wikidata, später weitere) |
| `src/render` | Zeichenfläche (Canvas/PixiJS), Viewport, Culling |
| `src/ui` | Svelte-Oberfläche (Filter, Details, Import) |
| `src/workers` | Web Worker für Parsing und Layout |
| `src/storage` | IndexedDB-Zugriff |
| `tests/` | Tests, gespiegelt zur `src`-Struktur |
| `scripts/` | Hilfsskripte (z. B. Testdaten generieren) |

## Dokumente

- [AGENTS.md](AGENTS.md) – Regeln für KI-Assistenten und Mitwirkende
- [PLAN.md](PLAN.md) – Roadmap mit Meilensteinen und Checkliste
- [ARCHITECTURE.md](ARCHITECTURE.md) – Aufbau und Datenfluss
- [DATA-MODEL.md](DATA-MODEL.md) – Datenmodell (Personen, Unions, Quellen)
- [DATA-SOURCES.md](DATA-SOURCES.md) – Datenquellen, Rechtliches
- [DECISIONS.md](DECISIONS.md) – Entscheidungsprotokoll
- [GLOSSARY.md](GLOSSARY.md) – Begriffe
- [TESTING.md](TESTING.md) – Teststrategie
- [CHANGELOG.md](CHANGELOG.md) – Änderungen
- [memory.md](memory.md) – laufender Projektstand für neue Sitzungen
