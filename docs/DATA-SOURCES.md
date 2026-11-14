# Datenquellen

## Grundsatz

Wir verwenden nur Daten, die der Nutzer selbst hat (Exportdateien) oder die über **offene bzw. offizielle Schnittstellen** angeboten werden. **Kein Scraping** von Plattformen, deren Nutzungsbedingungen das verbieten.

## Übersicht

| Quelle | Zugang | Status | Hinweis |
|---|---|---|---|
| GEDCOM-Datei | Import im Browser | M2 | Standardformat, funktioniert mit MyHeritage, Ancestry, Gramps u. a. |
| JSON (eigenes Format) | Import/Export | M1 | verlustfreies Backup |
| WikiTree | offene API | M8 ✅ | gemeinsamer Weltstammbaum, nur öffentliche Profile; **kein CORS**: im Browser nur über Durchleiter (Dev-Server: `/wikitree`), siehe D25 |
| Wikidata | SPARQL | M8 ✅ | v. a. historisch bedeutsame Personen und Adel; direkt aus dem Browser möglich |
| FamilySearch | API mit Entwicklerschlüssel | M8, nur Gerüst | Zugriffstoken des Nutzers nötig; gegen den echten Dienst ungeprüft |
| MyHeritage | **keine öffentliche Baum-API** | – | nur über GEDCOM-Export des eigenen Kontos |

## MyHeritage-Export (GEDCOM)

1. Bei MyHeritage anmelden, Stammbaum öffnen.
2. Stammbaum-Verwaltung → „Exportieren“ → GEDCOM.
3. Datei in `imports/gedcom/` ablegen (wird nicht in Git eingecheckt).
4. In der App „Import“ wählen.

## Datenschutz

- Lebende Personen: beim Export/Teilen optional anonymisieren (geplant M9).
- Es werden keine Daten an externe Dienste gesendet, außer der Nutzer startet eine Abfrage bei WikiTree/Wikidata/FamilySearch.
- Importierte Daten bleiben im Browser (IndexedDB).

## Abgleich

Externe Treffer werden als `assumed` markiert und als **Vorschlag** angezeigt (Dialog „Online suchen …“). Der Dialog zeigt ähnliche Personen im Baum (Name, Jahre, Geschlecht). „Ist dieselbe Person“ hängt nur einen Verweis und eine Notiz an; Zusammenführen gibt es nicht (D26).
