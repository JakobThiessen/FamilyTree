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

## M2 – GEDCOM-Import und -Export ✅
- [x] Parser für GEDCOM 5.5.1 (Zeichensätze UTF-8, UTF-16, ANSEL, ISO-8859-1/ANSI)
- [x] Mapping `INDI`, `FAM`, `HUSB`, `WIFE`, `CHIL`, `BIRT`, `DEAT`, `MARR`, `DIV`, `SOUR`, `NOTE`
- [x] Mehrfach-Ehen und Unions korrekt abbilden (`order`, GEDCOM-IDs in `externalRefs`)
- [x] GEDCOM-Datumsschlüsselwörter (`ABT/BEF/AFT/BET…AND`, `CAL/EST`) auf `FuzzyDate`
- [x] Import im Browser (Datei auswählen, Drag & Drop) im Worker (Minimal-Oberfläche, echter Dialog in M7)
- [x] Export zurück nach GEDCOM und JSON
- [x] Tests mit `example/gedcom/*`, Round-Trip

## M3 – Speicherung ✅
- [x] IndexedDB-Schema, Import persistieren
- [x] Mehrere Bäume/Projekte verwalten
- [x] Laden nach Bedarf (nur benötigte Personen)

## M4 – Verwandtschaft und bidirektionale Suche ✅
- [x] Vorfahren-/Nachfahrenmenge je Tiefe
- [x] Bidirektionale Suche A ↔ B, **alle** gemeinsamen Vorfahren
- [x] Verwandtschaftsbezeichnung (Cousin n. Grades, Schwager, mehrfach)
- [x] Inzuchtkoeffizient
- [x] Erkennung von Ahnenschwund

## M5 – Layout ✅
- [x] Generationenschichten, Sanduhr-Layout (Ahnen oben, Nachfahren unten)
- [x] Partnerbänder mit Reihenfolge der Ehen
- [x] Geisterknoten für doppelte Ahnen
- [x] Layout im Worker, inkrementell pro Chunk

## M6 – Darstellung ✅
- [x] Canvas-Zeichenfläche, Zoom und Verschieben, Viewport-Culling
- [x] Tiefe pro Richtung einstellbar, „+n“-Knoten zum Aufklappen
- [x] Personenkarten, Linienstile (belegt durchgezogen, unbestätigt gestrichelt)
- [x] Farben pro Familienlinie
- [x] Performance-Test mit 50.000 Personen (`example/performance`)

## M7 – Oberfläche ✅
- [x] Svelte-Layout, Filter („Direkte Linie / Familie / Alle“)
- [x] Personendetails mit Quellen, Notizen, Status
- [x] Suche nach Namen, Fokus wechseln
- [x] Import-Dialog

## M7b – Zeichenfläche und Rahmen ✅
Konzept: [UI-KONZEPT.md](UI-KONZEPT.md), Schritte 0–2. Reihenfolge danach: Ahnen, Zeitleiste, Karte (M9a–c), dann M9.
- [x] Schritt 0: S-Kurven (umschaltbar), Avatar-Karten, Leuchten bei Fokus/Hover, Hintergrundverlauf, weiche Kamerafahrt, Leistung gemessen (D28)
- [x] Schritt 1: Kopfleiste mit Reitern, Suche oben, DE/EN-Platzhalter, Reiter „folgt“
- [x] Schritt 2: Filterpanel (Zähler, unbestätigt/unbekannt, Familienlinien- und Linienlegende), Rolle zur Fokusperson auf den Karten

## M8 – Online-Quellen ✅
- [x] Provider-Schnittstelle (`src/providers`)
- [x] WikiTree (offene API; im Browser nur über Durchleiter, D25)
- [x] Wikidata (SPARQL)
- [x] FamilySearch (API-Schlüssel nötig, optional): nur Gerüst, ungeprüft (D25)
- [x] Dublettenvorschläge, Treffer als „vermutet“ markieren

## M9a–c – Ahnen, Zeitleiste, Karte ✅
- [x] M9a Ahnen: Ahnentafel mit Sosa-Nummern, Ahnenschwund, Inzuchtkoeffizient (D29; Fächerdiagramm offen)
- [x] M9b Zeitleiste: `src/core/timeline.ts`, Lebensbalken, unscharfe Daten (D30)
- [x] M9c Karte: Orte als Liste, Offline-Weltkarte (handgebaut, grob), Lebenswege, Orte per Wikidata auf Auslösung (D31)
- [x] Reiter Forschung und Quellen entfallen (Nutzer braucht sie nicht; Quellen bleiben im Datenmodell und in den Personendetails)

## M9 – Feinschliff ✅ (abgenommen 2026-11-14, PWA bewusst zurückgestellt)
Reihenfolge (mit Nutzer abgestimmt): Backup, Export, DE/EN, Barrierefreiheit/Mobile, PWA.
- [x] Schritt 1: Backup/Restore (D32)
- [x] Schritt 2: Ausdruck/PDF/SVG-Export (D33, nur Stammbaum-Reiter)
- [x] Schritt 3: Zweisprachigkeit (DE/EN, D34)
- [x] Schritt 4: Barrierefreiheit, Mobile (inkl. Karte über den 180.-Längengrad, D35; ohne Test mit echtem Bildschirmleser)
- [ ] Schritt 5: optional PWA (offline) – zurückgestellt, nicht Teil der Abnahme
- [x] Gesamtprüfung mit 50.000 Personen (Ergebnisse in memory.md)

## Nachfolgearbeiten nach M9 (ab 2026-11-15)
- [x] Reiter Forschung/Quellen entfernt
- [x] Filter zurücksetzen / ganzer Baum
- [x] Orte im 50.000-Personen-Testbaum
- [x] Weltkarte aus Natural Earth (D36)
- [x] Restliche deutsche Texte übersetzen (D37)

## M10 – Bearbeiten ⬜
Abgestimmt (2026-11-15): Formular im Detailfenster, Verwandte per Knöpfe an der Fokusperson (Unions entstehen automatisch), Löschen nur die Person mit Folgenhinweis, Undo/Redo nur in der Sitzung, Sicherung durch sofortiges gezieltes Schreiben in IndexedDB plus Backup/Export (keine Änderungshistorie).
- [x] Schritt 1: Änderungs-Kern `src/core/edit.ts` (`applyEdit` → `data`, `inverse`, `touched`; Zyklen, Doppel-Biologie, leere Unions) mit Tests
- [x] Schritt 2: `TreeStore.applyChanges` (gezieltes Schreiben in einer Transaktion, Zähler, Index-Hilfsfelder); D13/D27 ergänzen
- [ ] Schritt 3: Datenfluss in `App.svelte` (`$state.raw`), `LayoutClient.setData`, Undo/Redo (Strg+Z/Y), „erst speichern?“ bei ungespeichertem Baum; Messung mit 50.000 Personen
- [ ] Schritt 4: Person bearbeiten (Formular in `PersonDetails.svelte`: Name, Geschlecht, Geburt/Tod mit Datum, Ort, Lat/Lon, Status, Quelle, Notizen; Texte DE/EN)
- [ ] Schritt 5: Verwandte hinzufügen (Elternteil, Partner, Kind, Geschwister; Partner-/Union-Auswahl; optional vorhandene Person verknüpfen)
- [ ] Schritt 6: Person löschen mit Folgenhinweis und Undo
- [ ] Schritt 7: Sicherungshinweis („n Änderungen seit letztem Backup“)
- Später (eigener Meilenstein): Dubletten echt zusammenführen, Orte per Wikidata beim Eingeben, Fächerdiagramm, PWA

## Offene Fragen
- Soll später ein Mehrbenutzer-Betrieb oder Sync möglich sein? (Aktuell: nein, lokal)
- ~~PixiJS oder Canvas 2D?~~ Entschieden in M6: Canvas 2D (D21).
