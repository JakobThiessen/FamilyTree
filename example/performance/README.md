# example/performance/

Hier landen **generierte** große Testbäume (werden nicht eingecheckt).

```bash
node scripts/generate-large-tree.mjs 50000
```

Erzeugt `tree-50000.json` (nur JSON, kein `.ged`; GEDCOM entsteht über „GEDCOM“ in der Kopfleiste) mit zufälligen, erfundenen Personen. Geburts- und Sterborte sind echte Städte mit Koordinaten direkt am Ort (`place.lat/lon`), die Karte zeigt sie ohne Abfrage; ein kleiner Teil wandert nach Übersee, auch über die Datumsgrenze (Auckland, Honolulu).
