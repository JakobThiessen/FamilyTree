# Plan

Wir gehen die Meilensteine **gemeinsam der Reihe nach** durch. Ein Meilenstein ist fertig, wenn alle Punkte abgehakt sind und der Nutzer ihn abgenommen hat.

Status: ⬜ offen · 🟨 in Arbeit · ✅ fertig

## M0 – Projektgerüst ✅
- [x] Ordnerstruktur, Dokumente, `.gitignore`
- [x] Vite + TypeScript + Svelte Grundgerüst
- [x] Typen des Datenmodells (`src/core/types.ts`)
- [x] Beispieldaten (`example/`)

## M1 – Kern: Datenmodell und Graph ✅
- [x] `Person`, `Union`, `Source`, `Place`, Status/Unsicherheit (siehe DATA-MODEL.md)
- [x] `FamilyGraph`: Personen, Unions, Indizes für Eltern/Kinder/Partner
- [x] Abfragen: Eltern, Kinder, Partner, Geschwister (voll/halb), Stieffamilie
- [x] Datumsmodell mit Unschärfe („um 1750“, „vor 1800“, Zeitraum)
- [x] Tests mit `example/json/*` (inkl. Zyklen, Cousinenheirat)
- [x] Validierung der Invarianten (`FamilyGraph.validate()`), JSON-Loader

## M2 – GEDCOM-Import und -Export ⬜
- [ ] Parser für GEDCOM 5.5.1 (Zeichensätze UTF-8, ANSEL, ISO-8859-1)
- [ ] Mapping `INDI`, `FAM`, `HUSB`, `WIFE`, `CHIL`, `BIRT`, `DEAT`, `MARR`, `DIV`, `SOUR`, `NOTE`
- [ ] Mehrfach-Ehen und Unions korrekt abbilden
- [ ] Import im Browser (Datei auswählen, Drag & Drop) im Worker
- [ ] Export zurück nach GEDCOM und JSON
- [ ] Tests mit `example/gedcom/*`

## M3 – Speicherung ⬜
- [ ] IndexedDB-Schema, Import persistieren
- [ ] Mehrere Bäume/Projekte verwalten
- [ ] Laden nach Bedarf (nur benötigte Personen)

## M4 – Verwandtschaft und bidirektionale Suche ⬜
- [ ] Vorfahren-/Nachfahrenmenge je Tiefe
- [ ] Bidirektionale Suche A ↔ B, **alle** gemeinsamen Vorfahren
- [ ] Verwandtschaftsbezeichnung (Cousin n. Grades, Schwager, mehrfach)
- [ ] Inzuchtkoeffizient (optional)
- [ ] Erkennung von Ahnenschwund

## M5 – Layout ⬜
- [ ] Generationenschichten, Sanduhr-Layout (Ahnen oben, Nachfahren unten)
- [ ] Partnerbänder mit Reihenfolge der Ehen
- [ ] Geisterknoten für doppelte Ahnen
- [ ] Layout im Worker, inkrementell pro Chunk

## M6 – Darstellung ⬜
- [ ] Canvas-Zeichenfläche, Zoom und Verschieben, Viewport-Culling
- [ ] Tiefe pro Richtung einstellbar, „+n“-Knoten zum Aufklappen
- [ ] Personenkarten, Linienstile (belegt durchgezogen, unbestätigt gestrichelt)
- [ ] Farben pro Familienlinie
- [ ] Performance-Test mit 50.000 Personen (`example/performance`)

## M7 – Oberfläche ⬜
- [ ] Svelte-Layout, Filter („Direkte Linie / Familie / Alle“)
- [ ] Personendetails mit Quellen, Notizen, Status
- [ ] Suche nach Namen, Fokus wechseln
- [ ] Import-Dialog

## M8 – Online-Quellen ⬜
- [ ] Provider-Schnittstelle (`src/providers`)
- [ ] WikiTree (offene API)
- [ ] Wikidata (SPARQL)
- [ ] FamilySearch (API-Schlüssel nötig, optional)
- [ ] Dublettenvorschläge, Treffer als „vermutet“ markieren

## M9 – Feinschliff ⬜
- [ ] Zeitleiste, Karte (Orte)
- [ ] Ausdruck/PDF/SVG-Export
- [ ] Barrierefreiheit, Mobile, Zweisprachigkeit (DE/EN)
- [ ] Backup/Restore, optional PWA (offline)

## Offene Fragen
- Soll später ein Mehrbenutzer-Betrieb oder Sync möglich sein? (Aktuell: nein, lokal)
- PixiJS (WebGL) oder reines Canvas 2D? Entscheidung bei M6 per Messung.
