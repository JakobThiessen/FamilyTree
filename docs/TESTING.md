# Teststrategie

- **Werkzeug:** Vitest (`npm test`).
- **Pflicht:** Kernlogik in `src/core` und `src/import` hat Tests.
- **Testdaten:** ausschließlich aus `example/` (erfundene Personen).

## Testfälle (Mindestumfang)

| Bereich | Fall |
|---|---|
| Graph | Eltern, Kinder, Partner, Geschwister (voll/halb) |
| Mehrfach-Ehen | `example/gedcom/multiple-marriages.ged`: 3 Unions in Reihenfolge, Kinder der richtigen Union zugeordnet |
| Cousinenheirat | `example/gedcom/cousin-marriage.ged`: Person nur einmal im Graphen, zwei Wege zum gemeinsamen Ahn |
| Invarianten | keine Zyklen, keine hängenden Referenzen |
| Datum | „um 1750“, „vor 1800“, „zwischen 1700 und 1710“ |
| GEDCOM | verschiedene Zeichensätze, fehlerhafte Zeilen, leere Namen |
| Suche | bidirektionale Suche findet **alle** gemeinsamen Vorfahren |
| Performance | `example/performance` (generiert): 50.000 Personen, Ziel Layout eines Chunks < 100 ms; Szenenaufbau und Culling (`tests/render`) |
| Suche/Details | Namenssuche (Akzente, Wortanfang, Jahre), `describePerson` (Quellen, Links, Eltern, Partnerschaften) in `tests/ui` |
| Darstellung | Kamera, Raster, Szene (Stile, Spuren, „+n“) in `tests/render`; das Zeichnen selbst nur von Hand |

## Manuell

Vor jeder Abnahme im Browser mit den Beispielen prüfen: Zoom, Verschieben, Aufklappen, Fokus wechseln, Suche, Details, Import-Dialog (Datei wählen, Ablegen, Warnungen, Speichern, Neuladen, gespeicherten Baum öffnen).
