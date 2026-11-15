# Datenmodell

Umgesetzt in `src/core/types.ts`.

## Grundidee

- **Person**: eine Einzelperson, genau einmal im Graphen.
- **Union**: Partnerschaft (Ehe, eheähnlich, unbekannt) zwischen 0–2 Personen, mit Reihenfolge und Zeitraum.
- **Kind-Verknüpfung**: ein Kind hängt an einer Union (`childIds`) mit Art der Abstammung (leiblich, adoptiert, Pflege, unbekannt).
- **Source / Citation**: Quellen und Belegstellen. Jede Aussage kann Quellen und einen Status tragen.

## Folgen für typische Fälle

| Fall | Abbildung |
|---|---|
| Mann mit drei Frauen nacheinander | drei Unions mit `order` 1–3, Ende der Union per Tod der Frau |
| Halbgeschwister | gemeinsamer Elternteil, aber verschiedene Unions |
| Vollgeschwister | gleiche Union |
| Stiefmutter | Partner des Elternteils in einer späteren Union, nicht Elternteil des Kindes |
| Heirat unter Cousins | beide Partner haben gemeinsame Vorfahren; Graph hat eine Schleife, keine Kopie |
| Unbekannter Elternteil | Union mit nur einem Partner |
| Unsichere Verbindung | `status: "assumed"` an Union oder Kind-Verknüpfung |

## Medien

`Person.media` ist eine Liste von `MediaRef` (`file`, `title`, `format`, `primary`, `cutout`). Der Baum enthält nur Verweise (Pfad wie in der GEDCOM), die Bilddateien liegen beim Nutzer, Vorschauen in IndexedDB (D44, D45).

## Unscharfe Daten

```ts
type FuzzyDate = {
  kind: "exact" | "about" | "before" | "after" | "between";
  year?: number; month?: number; day?: number;
  yearTo?: number;          // nur bei "between"
  text?: string;            // Originaltext, z. B. "um 1750"
};
```

## Status

`proven` (durch Quelle belegt) · `assumed` (vermutet, z. B. aus Familienwissen oder externer Quelle) · `unknown`.

## IDs

Interne IDs sind stabile Strings (`p_…`, `u_…`, `s_…`). Externe IDs (GEDCOM `@I12@`, WikiTree, Wikidata) werden in `externalRefs` gehalten, damit Re-Import und Abgleich möglich sind.

## Invarianten (werden getestet)

- Eltern-Kind-Kanten bilden keinen Zyklus (niemand ist sein eigener Vorfahr).
- Jede Person-ID kommt nur einmal vor.
- Jede Union verweist nur auf existierende Personen.
- Ein Kind steht höchstens in einer biologischen Union (Adoption darf zusätzlich bestehen).

Änderungen laufen über `applyEdit` (`src/core/edit.ts`, D38); es lehnt Operationen ab, die diese Invarianten verletzen würden.
