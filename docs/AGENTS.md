# AGENTS.md

Regeln für KI-Assistenten (und Menschen), die an diesem Projekt arbeiten.

## Arbeitsweise

1. Zuerst [memory.md](memory.md) und [PLAN.md](PLAN.md) lesen. Dort steht, wo wir stehen.
2. Immer nur **einen Meilenstein** aus dem Plan bearbeiten und mit dem Nutzer abstimmen.
3. Nach jeder Arbeit: `CHANGELOG.md` ergänzen, Checkliste in `PLAN.md` abhaken, `memory.md` aktualisieren.
4. Wichtige Designentscheidungen in [DECISIONS.md](DECISIONS.md) festhalten (kurz: Kontext, Entscheidung, Folgen).
5. Sprache: Dokumente und Kommentare auf **Deutsch**, Code, Typnamen und Bezeichner auf **Englisch**.

## Architekturregeln

- `src/core` ist **reines TypeScript**: kein DOM, kein Svelte, kein Canvas. Es muss in Node und im Worker laufen.
- Datenfluss nur in eine Richtung: `import/providers → core → storage → render/ui`.
- Jede Person existiert **genau einmal** im Graphen. Doppelte Ahnen (Ahnenschwund) werden verwiesen, nie kopiert.
- Beziehungen laufen über **Unions** (Partnerschaften), Kinder hängen an der Union. Siehe [DATA-MODEL.md](DATA-MODEL.md).
- Jede Aussage trägt Status (`proven | assumed | unknown`) und optional Quellen.
- Dubletten nie automatisch zusammenführen, nur vorschlagen.
- Rendern nur, was im Viewport und in der geladenen Tiefe liegt (Chunking, Culling).
- Schwere Arbeit (Parsing, Layout, Suche) in Web Worker, nie im UI-Thread.

## Daten und Datenschutz

- Echte Familiendaten gehören nach `imports/` und werden **nicht** eingecheckt (siehe `.gitignore`).
- In `example/` liegen nur **erfundene** Personen. Keine echten Namen, keine echten Daten lebender Personen.
- Keine Daten an externe Dienste senden, außer der Nutzer löst eine Abfrage an eine offene Quelle bewusst aus.
- **Kein Scraping** von MyHeritage, Ancestry oder anderen Diensten. Nur Export-Dateien des Nutzers oder offizielle/offene APIs. Siehe [DATA-SOURCES.md](DATA-SOURCES.md).

## Code-Stil

- TypeScript `strict`. Kein `any` ohne Kommentar.
- Kleine, reine Funktionen im Kern. Seiteneffekte nur in `storage`, `render`, `ui`.
- Tests für Kernlogik (Graph, Verwandtschaft, GEDCOM) sind Pflicht, siehe [TESTING.md](TESTING.md).
- Neue Abhängigkeiten nur mit kurzer Begründung in DECISIONS.md.

## Befehle

```bash
npm run dev | build | typecheck | test
```

## Definition of Done (pro Meilenstein)

- [ ] Funktion läuft im Browser und ist mit Beispieldaten aus `example/` geprüft
- [ ] `npm run typecheck` und `npm test` laufen fehlerfrei
- [ ] Doku, Changelog, Plan und memory.md aktualisiert
