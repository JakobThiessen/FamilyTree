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

## D12 – GEDCOM-Import: Format und Abbildung (2026-11-14)
- Eigene Kennungen werden beim Import fortlaufend vergeben (`p_1`, `u_1`, `s_1` in Dateireihenfolge); die GEDCOM-Kennung steht ohne `@` in `externalRefs` (`system: "gedcom"`, z. B. `I12`). Dafür haben `Union` und `Source` jetzt auch `externalRefs`. Der Export übernimmt vorhandene Kennungen, sonst vergibt er neue.
- Fehler führen zu `ImportWarning` (mit Zeilennummer), nicht zum Abbruch (analog D9). Unlesbare Datumswerte bleiben als Freitext (`kind: "about"` ohne Jahr, `text` gesetzt).
- `FuzzyDate.text` hält den GEDCOM-Originalwert; der Export schreibt ihn unverändert zurück, wenn er zu den Feldern passt (`CAL`, volle Grenzen bei `BET`), sonst neu aus den Feldern.
- Union: `kind` = `marriage` bei zwei Partnern oder `MARR`, sonst `unknown`. `order` = höchster Rang der Partner; Rang je Person nach Heiratsdatum, wenn alle Ehen der Person eines haben, sonst Dateireihenfolge. Kinder-Art aus `FAMC.PEDI`; fehlt `CHIL` in der `FAM`, wird es aus `FAMC` ergänzt (mit Warnung).
- Zeichensatz: BOM, sonst `1 CHAR`; `ANSI`/`ASCII`/`ISO-8859-1`/sonstige gelten als Windows-1252; ohne Angabe erst UTF-8, dann Windows-1252. ANSEL ist als eigene kleine Tabelle umgesetzt (keine neue Abhängigkeit).
- Nicht übernommen (kein Gegenstück im Modell): Namenszusätze (`NSFX`), Notizen/Quellen an Personen- oder Union-Ebene außerhalb von Ereignissen, weitere Ereignisse (`CHR`, `BURI`, `OCCU` …), `status`. Weitere Namen werden als Notiz „Weiterer Name: …“ bewahrt. Union-Ende durch Tod wird nicht abgeleitet. Beim Export gehen `status`, `kind: "partnership"` und Union-Ende außer Scheidung verloren. Ereignisse folgen später, wenn das Modell sie braucht.
- Dateierkennung (`importFileContent`): `.json` oder Inhalt mit `{` = JSON, sonst GEDCOM.

## D13 – Speicherung: eine IndexedDB, `idb`, Laden über Indizes (2026-11-14)
- **Schema:** Datenbank `familytree` (Version 1) mit Stores `trees` (Metadaten inkl. Zähler), `persons`, `unions`, `sources`. Alle Bäume teilen sich die Stores; Schlüssel ist `[treeId, id]`. Ein Baum wird per Schlüsselbereich gelöscht, gleiche Personen-IDs in verschiedenen Bäumen stören sich nicht. Gründe gegen eine Datenbank pro Baum: eine Verbindung, eine Migration, einfache Liste.
- **Laden nach Bedarf:** Unions tragen Hilfsfelder `partnerKeys`/`childKeys` (`treeId` + Trennzeichen + `personId`) mit `multiEntry`-Indizes `byPartner`/`byChild`. `loadNeighborhood` läuft schichtweise (Vorfahren über `byChild`, Nachkommen über `byPartner`), besucht doppelte Ahnen nur einmal und lädt Partner/Kinder der geladenen Unions mit, aber nicht deren weitere Unions. Die Hilfsfelder werden beim Lesen entfernt, das Austauschformat `TreeData` bleibt unverändert.
- **Speichern:** ein Import = eine Transaktion (alles oder nichts). Es gibt noch kein Ändern einzelner Personen; das kommt mit Bearbeitung (nach M7). Neuer Import legt immer einen neuen Baum an.
- **Abhängigkeiten:** `idb` (laut Architektur geplant): kleiner Promise-Wrapper um IndexedDB, spart fehleranfälligen Callback-Code. `fake-indexeddb` (nur Dev): IndexedDB in Node, damit `tests/storage` ohne Browser laufen.
- **Svelte-Proxy:** `$state` verpackt Objekte in Proxys, die IndexedDB nicht klonen kann (im Browser aufgefallen, Tests in Node sehen das nicht). Die UI hält Baumdaten daher mit `$state.raw`.

## D14 – Vorfahren je Tiefe, Ahnenschwund und gemeinsame Vorfahren (2026-11-14)
- `ancestorLevels`/`descendantLevels` stellen jede Person nur in ihre **kürzeste** Schicht (Breitensuche mit Besuchtmenge). Wer wissen will, auf wie vielen Wegen und in welcher Tiefe ein Ahn vorkommt, nutzt `ancestorProfile` (rechnet schichtweise, zählt Wege statt sie aufzuzählen).
- Ahnenschwund = Ahn mit mehr als einem Weg. `pedigreeCollapse` liefert die Ahnen, Zahlen je Tiefe und den **Implex** (1 − verschiedene Ahnen / belegte Ahnenplätze).
- `findCommonAncestors` ist die bidirektionale Suche: zwei Fronten steigen abwechselnd (die kleinere zuerst) und laufen bis zur Erschöpfung bzw. `maxDepth`, damit **alle** gemeinsamen Vorfahren gefunden werden. Ein Abbruch beim ersten Treffer wäre falsch, weil ein tieferer niedrigster Ahn auf einer Seite später auftauchen kann. Jeder Treffer trägt kürzeste Entfernung und alle Tiefen je Seite; `lowest` = kein anderer gemeinsamer Vorfahr stammt von ihm ab.
- Ist A Vorfahr von B, gilt A selbst als gemeinsamer Vorfahr (Entfernung 0). Schutz vor Zyklen: Schichten sind auf die Personenzahl begrenzt (kaputte Daten, siehe D9).
- Standardmäßig zählen alle Verknüpfungsarten (auch Adoption) mit; `biologicalOnly` schränkt ein.

## D15 – Verwandtschaftsbezeichnung (2026-11-14)
- Blickrichtung: `describeRelationship(g, a, b)` sagt, **was A für B ist** („A ist Großmutter von B“); das Geschlecht von A bestimmt die Wortform, bei `U` neutrale Formen („Elternteil“, „Onkel/Tante“).
- Bezeichnung aus (Schritte A→Ahn, Schritte B→Ahn): (0,n) Eltern/Großeltern/Urgroßeltern, (n,0) Kinder/Enkel/Urenkel, (1,1) Geschwister, (1,n)/(n,1) Onkel/Tante, Großonkel … bzw. Neffe/Nichte, sonst **Cousin n. Grades** (n = kleinerer Abstand − 1) mit „k Generation(en) versetzt“ bei Abstandsunterschied. Ab 6 Schritten Zahlenform statt „Urururur…“.
- Voll/halb: Eine Linie ist „halb“, wenn A und B nicht über dieselbe Union des Ahns absteigen. Gleiche Ahnenpaare (beide Partner einer gemeinsamen Union) bilden **eine** Linie. Mehrere Linien (doppelte Cousins, Halbbruder und Cousin zugleich) werden alle gemeldet; gleiche Bezeichnungen heißen „(doppelt)“ bzw. „(n-fach)“.
- Partner: Ehemann/Ehefrau (Union `marriage`), sonst Partner/Partnerin, bei Scheidung „Ex-“. Blut und Partnerschaft werden kombiniert („Ehemann, Cousin 1. Grades“).
- Verwandtschaft durch Heirat nur, wenn weder Blut noch Partnerschaft vorliegt: Schwager/Schwägerin, Schwiegereltern/-kinder, Stiefeltern/-kinder, Schwippschwager, sonst allgemein „Partner von …“. Das deckt die weite Stiefdefinition aus D10 ab (auch frühere Partner des Elternteils).
- Nicht umgesetzt: Seitenlinien über zwei Heiraten hinaus, Bezeichnungen für Patenschaft. Nur Deutsch; Englisch kommt mit der Zweisprachigkeit (M9).

## D16 – Inzuchtkoeffizient (2026-11-14)
Nach Wright/Malécot über die rekursive Kinship-Formel: φ(x,y) ersetzt die Person mit dem größeren Rang (längster Weg bis zu einem Gründer) durch den Mittelwert über ihre Eltern; F(x) = φ(Vater, Mutter). Vorteile gegenüber dem Aufzählen aller Wege: Inzucht der Ahnen fließt automatisch ein, jedes Paar wird nur einmal gerechnet (Zwischenspeicher in `KinshipCalculator`). Eltern = Partner der ersten Eltern-Union mit Art `biological`/`unknown`; Adoptiv- und Pflegeeltern nur mit `includeAdopted`. Bei nur einem bekannten Elternteil ist F = 0. Geprüft an Grundfällen (Geschwister 1/4, Onkel/Nichte 1/8, Halbgeschwister 1/8, Cousins 1/16, Vater/Tochter 1/4). Keine neuen Abhängigkeiten in M4.
