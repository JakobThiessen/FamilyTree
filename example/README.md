# example/

Beispieldaten mit **erfundenen** Personen. Sie dienen zum Testen und Entwickeln.

| Ordner | Datei | Zeigt |
|---|---|---|
| `gedcom/` | `multiple-marriages.ged` | Ein Mann mit drei Ehen nacheinander (Frauen starben), Kinder aus jeder Ehe, Halbgeschwister |
| `gedcom/` | `cousin-marriage.ged` | Heirat unter Cousin und Cousine (Ahnenschwund, gemeinsame Großeltern) |
| `json/` | `multiple-marriages.json` | dasselbe im internen JSON-Format |
| `json/` | `cousin-marriage.json` | Heirat unter Cousin und Cousine im internen JSON-Format (entspricht `cousin-marriage.ged`; GEDCOM-ID `@In@` = `p_n`, `@Fn@` = `u_n`) |
| `performance/` | (generiert) | große Testbäume, erzeugt mit `scripts/generate-large-tree.mjs` |

Regeln: nur erfundene Namen, keine echten Daten, jede Datei einzeln erklärt in dieser Tabelle.
