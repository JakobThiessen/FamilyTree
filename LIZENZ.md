# Lizenzen

Stand: 2026-11-14. Diese Datei fasst zusammen, unter welchen Lizenzen das Projekt, seine Abhängigkeiten und die verwendeten Daten stehen. Sie ist eine Übersicht, keine Rechtsberatung. Maßgeblich sind die Lizenztexte der jeweiligen Pakete (`node_modules/<paket>/LICENSE`).

## 1. Lizenz dieses Projekts

**MIT-Lizenz** (Text in der Datei [LICENSE](LICENSE), Urheberangabe „Copyright (c) 2026 jthiessen“). `package.json` trägt `"license": "MIT"`; `"private": true` bleibt, damit das Paket nicht versehentlich auf npm veröffentlicht wird. Die MIT-Lizenz gilt für den eigenen Code und die eigenen Dokumente, nicht für die Pakete und Datenquellen aus den Abschnitten 2 und 3.

Eigene Inhalte des Projekts:

- **Quellcode** (`src/`, `tests/`, `scripts/`) und **Dokumente** (`docs/`, `README.md`): MIT, siehe oben.
- **Beispieldaten** (`example/`): ausschließlich erfundene Personen, ohne Bezug zu echten Menschen.
- **Weltkarte** (`src/ui/worldMap.ts`): vereinfachte Küstenlinien aus **Natural Earth** (1:50m, Ebenen „Land“ und „Lakes“), erzeugt mit `scripts/build-world-map.mjs`. Natural Earth ist gemeinfrei (public domain), eine Namensnennung ist nicht verpflichtend, wird aber gern gesehen: „Made with Natural Earth.“ (https://www.naturalearthdata.com/). Siehe D36.
- Keine eingebundenen Schriften, Bilder oder Icons von Dritten (die Oberfläche nutzt die Systemschrift).

## 2. Abhängigkeiten

Nicht alles steht unter der MIT-Lizenz. Die direkten Abhängigkeiten aus `package.json` (Versionen laut `package-lock.json`):

| Paket | Version | Lizenz | Verwendung |
|---|---|---|---|
| `idb` | 8.0.4 | ISC | **Laufzeit** (im ausgelieferten Bundle): Zugriff auf IndexedDB |
| `svelte` | 5.57.3 | MIT | Oberfläche; die kleine Laufzeit steckt im gebauten Bundle |
| `vite` | 8.3.8 | MIT | Entwicklungsserver und Build |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | MIT | Svelte in Vite |
| `svelte-check` | 4.7.8 | MIT | Typprüfung |
| `@tsconfig/svelte` | 5.0.9 | MIT | TypeScript-Grundeinstellung |
| `@types/node` | 26.6.6 | MIT | Typen |
| `vitest` | 5.1.0 | MIT | Tests |
| `typescript` | 6.0.3 | Apache-2.0 | Typprüfung (nur Entwicklung) |
| `fake-indexeddb` | 6.2.8 | Apache-2.0 | Tests (nur Entwicklung) |

Alle Pakete zusammen (auch indirekte, 98 Stück im `package-lock.json`): 76 × MIT, 6 × Apache-2.0, 2 × ISC, 1 × BSD-3-Clause, 1 × 0BSD und **12 × MPL-2.0**.

Zu den MPL-2.0-Paketen: Es sind `lightningcss` und seine Plattformdateien, die Vite beim Entwickeln und Bauen mitbringt. Sie sind reine Werkzeuge und **nicht Teil des ausgelieferten Programms**. Die MPL-2.0 verlangt nur, Änderungen an *diesen* Dateien offenzulegen; wir ändern sie nicht.

Im ausgelieferten Bundle (`npm run build`) landen nur Svelte (MIT), `idb` (ISC) und unser eigener Code. Wer das Bundle weitergibt, sollte die Lizenztexte beider Pakete beilegen (Hinweispflicht von MIT und ISC).

Die Liste lässt sich jederzeit prüfen, z. B. mit:

```bash
npx license-checker --summary
```

(Hilfsprogramm, nicht Teil des Projekts; bei Änderungen an den Abhängigkeiten diese Datei aktualisieren.)

## 3. Daten aus Online-Quellen

Das Programm ruft Online-Quellen nur auf ausdrücklichen Knopfdruck ab (siehe [DATA-SOURCES.md](docs/DATA-SOURCES.md)). Für die abgerufenen Daten gelten die Bedingungen des jeweiligen Dienstes, nicht die Lizenz dieses Projekts:

| Quelle | Hinweis |
|---|---|
| Wikidata | Die strukturierten Daten sind gemeinfrei (CC0). Dienstbedingungen und Abfragelimits beachten. |
| WikiTree | Eigene Nutzungsbedingungen für die API und die Profilinhalte; vor einer Weitergabe der Daten prüfen. |
| FamilySearch | API-Schlüssel und Nutzungsbedingungen des Anbieters nötig; Anbindung ist nur ein ungeprüftes Gerüst. |
| MyHeritage, Ancestry u. a. | Keine Anbindung, **kein Scraping**. Nur Exportdateien, die der Nutzer selbst besitzt. |

Eigene Familiendaten (GEDCOM-/JSON-Dateien im Ordner `imports/`) bleiben Eigentum der jeweiligen Rechteinhaber und werden nicht eingecheckt.
