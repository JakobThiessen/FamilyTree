# Entscheidungsprotokoll

Format: Datum · Entscheidung · Begründung · Folgen.

## D1 – Graph statt Baum (2026-11-14)
Personen als Knoten, Beziehungen als Kanten, keine feste Wurzel. Nötig für Ansicht in beide Richtungen, Mehrfach-Ehen und Ahnenschwund. Folge: Layout muss Schleifen verkraften (Geisterknoten).

## D2 – Unions als eigene Objekte (2026-11-14)
Kinder hängen an der Union, nicht an „dem Ehepartner“. Macht Halb-/Vollgeschwister und Stieffamilien eindeutig.

## D3 – TypeScript + Vite (2026-11-14)
Das Datenmodell ist groß und wächst; Typen verhindern Fehler. Vite ist Standard, schnell, unterstützt Worker ohne Zusatzaufwand.

## D4 – Oberfläche: Svelte, Zeichenfläche ohne Framework (2026-11-14)
React würde bei tausenden Knoten durch den virtuellen DOM bremsen. Die Zeichenfläche ist reines TS (Canvas, evtl. PixiJS). Svelte nur für Panels, Filter, Details.

## D5 – Kern ohne Framework-Bezug (2026-11-14)
`src/core` bleibt reines TS, damit UI austauschbar ist und der Kern in Worker/Node läuft.

## D6 – Lokal zuerst (2026-11-14)
Alles im Browser (IndexedDB), kein Backend. Familiendaten bleiben privat, keine laufenden Kosten.

## D7 – Kein Scraping, MyHeritage nur per GEDCOM (2026-11-14)
MyHeritage hat keine öffentliche Baum-API, Scraping verstößt gegen die Nutzungsbedingungen.

## D8 – Dokumente in `docs/` (2026-11-14)
Alle Dokumente liegen in `docs/`. Im Projektwurzelverzeichnis liegen nur kurze Verweisdateien (`README.md`, `AGENTS.md`), damit Werkzeuge und Git-Plattformen sie finden.

## D9 – Graph toleriert fehlerhafte Daten, `validate()` meldet (2026-11-14)
Der `FamilyGraph`-Konstruktor wirft nicht bei Dubletten, hängenden Verweisen oder Zyklen. Fehlerhafte Einträge werden übersprungen (bei doppelten IDs gilt der erste) und über `validate()` als `ValidationIssue` mit Code gemeldet. Folge: Ein unsauberer GEDCOM-Import bleibt ladbar und die UI kann Probleme anzeigen. Der Aufrufer muss `validate()` prüfen.

## D10 – Geschwister und Stiefverwandte über Unions definiert (2026-11-14)
Voll-Geschwister = gleiche Union; Halb-Geschwister = gemeinsamer Elternteil in anderer Union. Stiefeltern = Partner der Eltern aus Unions, in denen die Person nicht Kind ist (auch frühere Partner des Elternteils); Stiefkinder analog. Folge: Ein Kind aus Ehe 3 hat die Frauen aus Ehe 1 und 2 als Stiefmütter im weiten Sinn; die UI kann nach Union-Zeitraum filtern.

## D11 – Datumsparser nur Deutsch, Sortierung über Jahresnäherung (2026-11-14)
`parseFuzzyDate` versteht deutschen Text und ISO-Formen; GEDCOM-Schlüsselwörter kommen in M2 im Importer. `dateSortKey` nutzt das genannte Jahr als Näherung auch bei vor/nach.
