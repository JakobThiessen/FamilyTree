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

## D17 – Layout: Ansicht und Modi (2026-11-14)
- Ansicht = Fokus + Tiefe `up`/`down` + Modus. Die Tiefe zählt über den **kürzesten** Weg wie in M4 (`ancestorLevels`); wer über einen längeren Weg tiefer liegt, steht trotzdem in seiner tiefsten Schicht (D18).
- `direct`: nur Fokus, Vorfahren, Nachfahren („Linie“). Partner stehen nur, wenn sie selbst Eltern in der Linie sind. `family`: zusätzlich Partner aller Linienpersonen sowie Geschwister und Halbgeschwister, deren Eltern in der Ansicht stehen; diese Zusatzpersonen sind Blätter. `all`: alles über Eltern, Kinder und Partner, solange die Schicht zwischen −up und +down liegt. Die UI-Filter „Direkte Linie / Familie / Alle“ (M7) bilden darauf ab.
- Randzähler für „+n“: `hiddenParents` nur für Schichten ≤ 0, `hiddenChildren` nur für Schichten ≥ 0 (sonst würden Vorfahren wegen ihrer nicht gezeigten Geschwister „+n“ tragen).
- Ist der Fokus unbekannt, ist das Ergebnis leer (`focusKey: null`). Im Modus `all` begrenzt nur das Fenster die Größe; die Obergrenze wählt der Aufrufer.

## D18 – Layout: Schichten (2026-11-14)
- Personen, die über Unions verbunden sind, bilden eine **Gruppe** (= ein Band) und stehen in derselben Schicht.
- Schicht der Linie = **längster Weg** vom Fokus (Kahn-Verfahren auf dem Gruppengraphen), Vorfahren negativ, Nachfahren positiv. Das ist die „tiefste benötigte Schicht“ und garantiert, dass Eltern immer über ihren Kindern stehen. Kürzeste Wege (wie in M4) würden Eltern neben Kinder legen.
- Zusatzpersonen: Kinder = Schicht der Eltern + 1 (das Maximum), Eltern = Schicht der Kinder − 1 (das Minimum). Zyklen in kaputten Daten brechen nicht ab, sondern erscheinen in `conflicts`.
- Bandreihenfolge: wer die meisten Partnerschaften hat, steht links, danach seine Partner nach `Union.order`, deren weitere Partner direkt dahinter. Bei genau zwei Personen steht der Mann links.

## D19 – Layout: Geisterknoten (2026-11-14)
- Jede Gruppe steht genau einmal echt, jede Beziehung „Union – Kind“ wird genau einmal gezeichnet (Tiefensuche vom Fokus, Aufstieg vor Abstieg). Wird eine Gruppe über eine zweite Beziehung erreicht, entsteht stattdessen ein Geist: beim Aufstieg ein Geisterband der Eltern über dem Kind (mit eigenem `LayoutUnion`, `ghost: true`), beim Abstieg eine Geisterkarte des Kindes unter der Union. Geister haben keine eigenen Eltern oder Kinder.
- Vorfahrenbänder zeigen nur Zusatzpersonen als Kinder (Geschwister); Linienkinder kommen über ihren eigenen Weg. Dadurch ist der Ahnenbaum symmetrisch und Geister entstehen nur bei echtem Ahnenschwund. Echte Kinderbänder einer Union werden vor dem Abstieg in die Tiefe angelegt, damit der Abstieg gegen einen späteren Aufstieg gewinnt.
- Schlüssel: echte Karte = Personen-ID, Geist = `<Personen-ID>~up:<Union>:<Kind>` bzw. `~dn:<Union>:<Kind>`. Sie hängen nur von der Beziehung ab und bleiben über Chunks stabil.
- Bekannte Grenze: Ändert sich bei größerer Ansicht, welcher Weg zuerst erreicht wird, kann eine echte Karte weiter von einem ihrer Kinder stehen als nötig (lange Linie). `reset` (Layout neu beginnen) behebt das.

## D20 – Layout: Positionen, Inkrementalität und Worker (2026-11-14)
- Positionen: Teilbaumbreite (größte Breite über alle Schichten des Teilbaums), jedes Band mittig über seinen Teilbaum, Geschwister daneben; dann je Schicht Überlappungen mit isotoner Regression (Reihenfolge bleibt, Verschiebung minimal). Keine Kreuzungsminimierung nach Sugiyama: bei einem Baum mit Geistern ist die Reihenfolge der Tiefensuche schon kreuzungsfrei. Das Ergebnis ist immer überlappungsfrei; bei `family`/`all` sind Linien teils schräg (Feinschliff in M6).
- Inkrementell (`LayoutSession`, gleicher Fokus und Modus): Bänder mit gleicher ID, Schicht und Kartenreihenfolge behalten ihre Position, neue Bänder werden um die mittlere Verschiebung versetzt und in die nächste freie Lücke ihrer Schicht gesetzt. Schon platzierte Personen behalten ihre Schicht. `added` nennt die neuen Karten. Ändert sich ein Band (neues Mitglied), wird es neu platziert. Schrumpft die Ansicht und wächst wieder, bezieht sich das Layout nur auf das letzte Ergebnis.
- Worker: eine langlebige Instanz (anders als der Import-Worker), weil sie die Positionen hält. Nachrichten `setData`/`layout`/`reset` mit Kennung; die Logik steckt in `layoutHandler.ts` und ist ohne Browser testbar. Der Worker bekommt Baumdaten (`setData`, auch ein Ausschnitt aus `loadNeighborhood`), nicht die IndexedDB.
- Leistung: Chunk bei 50.000 Personen 0,3–4 ms (31–95 Karten); 1.750 Karten ca. 55 ms; 9.600 Karten ca. 190 ms (Richtwert 20 µs je Karte). Das Ziel < 100 ms ist für realistische Chunks erreicht. Keine neuen Abhängigkeiten.

## D21 – Darstellung: Canvas 2D statt PixiJS (2026-11-14)
- **Messung** (Chromium im Browser-Pane, 50.000-Personen-Baum, Zeichenfläche 1280×720, Median von 10 Bildern; reine Zeichenzeit auf dem Haupt-Thread): 8.917 Karten/12.251 Linien (Modus `direct`, Tiefe 0/30) eingepasst 4,8 ms (2.109 sichtbare Karten), bei Zoom 0,05: 1,2 ms, bei Zoom 0,2: 0,5 ms, bei Zoom 1: 0,2 ms. 2.836 Karten (`family` 25/25) eingepasst 3,6 ms. Das Ziel eines flüssigen Bildes (< 16 ms) wird mit großem Abstand erreicht.
- Gründe: Culling über ein Raster (`GridIndex`) und Detailstufen (LOD: unter Zoom 0,06 nur Farbflächen je Familienfarbe in einem Pfad, unter 0,3 ohne Text) halten die gezeichnete Menge klein; Linien werden nach Farbe und Stil gebündelt. Text ist der teure Teil, und er erscheint nur bei starkem Zoom, wo wenige Karten sichtbar sind. PixiJS würde eine Abhängigkeit (~500 kB), Textur-Verwaltung für Beschriftungen und einen zweiten Rendering-Weg bringen, ohne dass es heute einen Engpass gäbe. **Keine neue Abhängigkeit.**
- Folge: Reicht Canvas 2D später nicht (z. B. Animationen mit zehntausenden sichtbaren Karten), ist `TreeView` die einzige Stelle, die ersetzt werden müsste: `Scene` (Karten, Linien, Raster) ist unabhängig vom Zeichner.

## D22 – Layout-Kern ohne Rekursion (2026-11-14)
Beim Test mit 50.000 Personen lief der Layout-Kern im Modus `all` ab etwa 17.000 Karten in einen Stapelüberlauf (`Maximum call stack size exceeded`), weil `visit` (build.ts) sich pro Karte rekursiv aufrief und `extent`/`place` (layout.ts) ebenso. Ändert nichts am Ergebnis, nur am Ablauf: `visit` ist jetzt ein Generator (`yield occ` = „besuche dieses Band jetzt, danach hier weiter“), den `run` mit eigenem Stapel abarbeitet – die Besuchsreihenfolge bleibt exakt wie bei Rekursion. `computeExtents` berechnet alle Teilbaumbreiten vorab von hinten nach vorn (Kinder entstehen nach ihrem Band), `place` nutzt einen Stapel. Alle Layout-Tests liefen unverändert durch.
- **Bekannte Grenze (nicht behoben):** Im Modus `all` auf dichten Verwandtschaftsgeflechten (viele Cousinenheiraten, wie im Testbaum) wächst die Breite exponentiell: `extent` reserviert für Geschwisterteilbäume links und rechts je `max` (Verdopplung pro Verschachtelungsstufe). Ab Tiefe 3–5 ab einer Person aus der Mitte des Testbaums entstehen Breiten über 10^9. Das Layout ist weiter überlappungsfrei, aber unbrauchbar breit. `direct` und `family` sind nicht betroffen. Ein Fix gehört in den Layout-Kern (Geschwisterbreiten nicht verdoppeln, Band nicht mehr mittig im eigenen Teilbaum) und ist ein eigener Schritt.

## D23 – Darstellung: Linienführung, Karten, „+n“ (2026-11-14)
- **Szene vor Zeichner:** `buildScene(result, persons)` (reines TS, in Node testbar) macht aus `LayoutResult` und Personen Karten (Name, Lebensspanne, Familienfarbe) und Linien. `TreeView` zeichnet nur noch.
- **Linien rechtwinklig** (Feinschliff aus D20): Stamm von der Partnerschaft senkrecht zu einer waagerechten Sammelschiene, von dort senkrecht zu jedem Kind. Sammelschienen von Partnerschaften derselben Schicht, deren Spannen sich berühren, bekommen versetzte Spuren (höchstens 4, danach Wiederverwendung der Spur mit dem weitesten Abstand). Partnerlinien waagerecht zwischen benachbarten Karten, Ehe dicker als Partnerschaft.
- **Stile:** belegt = durchgezogen, `assumed`/`unknown` (Union, Kind-Verknüpfung) = gestrichelt, Adoption/Pflege = gepunktet. Karten vermuteter Personen und Geisterkarten haben gestrichelten Rahmen; Geister sind blasser und mit „↺“ beschriftet. Fehlt `status`, gilt „belegt“.
- **Farbe pro Familienlinie:** gleicher Nachname (ohne Beachtung von Groß-/Kleinschreibung) = gleiche Farbe aus einer festen Palette von acht Farben (stabiler Hash). Kinderlinien tragen die Farbe des Kindes, Partner- und Stammlinien sind neutral. Eine echte Abstammungslinie über Frauen (Mädchenname) ist noch nicht modelliert; das wäre eine eigene Entscheidung in M7/M9.
- **„+n“-Knopf** über/unter der Karte (▲ Eltern, ▼ Kinder). Klick = Tiefe bis zu dieser Karte erhöhen (`up = −Schicht + 1` bzw. `down = Schicht + 1`), gleicher Fokus und Modus, also inkrementell: vorhandene Karten bleiben stehen und die Kamera bewegt sich nicht. Reicht die Tiefe schon (Partner oder Geschwister am Rand, D17), wird die Person stattdessen Fokus. Aufklappen einzelner Äste ohne die ganze Schicht ist mit der Anfrage `up/down/mode` nicht möglich; das würde eine pro Karte erweiterte Anfrage im Kern brauchen.
- **Eingaben:** Ziehen = verschieben, Mausrad = zoomen um den Zeiger (Faktor `exp(−Δ·0,0015)`, Bereich 0,01–4), Zwei-Finger-Geste = Zoom/Verschieben, Klick (< 5 px Bewegung) auf Karte = Fokus. Kamera wird nur bei neuem Fokus oder Modus neu ausgerichtet (ganze Ansicht, wenn Zoom ≥ 0,5 reicht, sonst Zoom 0,8 auf der Fokuskarte).
- **Raster:** `GridIndex` (Zellgröße 512) für Karten und Linien; Elemente über mehr als 256 Zellen (lange Schienen) werden separat geführt, Zellkoordinaten sind begrenzt, damit absurde Koordinaten (D22, Grenze) keine Endlosschleife auslösen.

## D24 – Oberfläche: Aufbau, Suche im Hauptthread, Dialog (2026-11-14)
- **Aufbau:** `App.svelte` hält Daten (`$state.raw`), Graph, Personentabelle und Quellentabelle (je einmal pro Baum, `$derived`) und verteilt sie. `TreeViewer` besitzt Zeichenfläche und Layout-Worker, der Fokus wird von außen über `focusOn(id)` gesetzt. Das Detailfenster zeigt immer die Fokusperson; ein Klick auf eine Verwandte oder einen Suchtreffer wechselt den Fokus (wie ein Klick auf die Karte). Keine neue Abhängigkeit.
- **Suche im Hauptthread (Abweichung von „schwere Arbeit in Worker“):** Gemessen auf dem 50.000-Personen-Baum: Index aufbauen ca. 220 ms (einmal pro Baum, kurz nach dem Öffnen in einem Timeout), eine Anfrage 3–5 ms. Ein Worker bräuchte eine zweite Kopie der Namen und Nachrichtenverkehr pro Tastendruck, ohne dass es einen Engpass gäbe. Wird der Index bei deutlich größeren Bäumen oder Volltextsuche zu langsam, wandert er in den Worker (`PersonSearchIndex` ist reines TS und zieht ohne Änderung um).
- **Suchregeln:** Normalisierung klein, ohne Akzente (NFD), „ß“ = „ss“; „mueller“ findet „Müller“ nicht (nur „muller“/„müller“). Alle Wörter müssen vorkommen; Lebensjahre zählen als Text („anna 1850“). Treffer am Wortanfang vor Treffern mitten im Wort, dann nach Nachname/Vorname. Trefferliste auf 12 begrenzt.
- **Import-Dialog** als native `<dialog>` (Esc, Fokusfalle, Hintergrund gratis). Zweistufig: Datei lesen → Ergebnis prüfen (Hinweise, Baumprobleme) → „Nur anzeigen“ oder „Speichern und anzeigen“. Dateien lassen sich im ganzen Fenster ablegen. Ohne geöffneten Baum ist der Dialog nicht schließbar. Ein erneuter Import legt immer einen neuen gespeicherten Baum an (D13).
- **Quellen-Links** werden nur für `http(s)` als Link gerendert (kein `javascript:`), mit `rel="noopener noreferrer"`.
- **Offen/vertagt:** Bearbeiten von Personen (D13), Farblinie über Frauen (D23), Zweisprachigkeit und echte Mobilbedienung (M9; schmale Fenster stapeln nur die Spalten).

## D25 – Online-Quellen: Anbieter, CORS, Umfang (2026-11-14)
- **Schnittstelle:** `Provider { id, label, needsKey, disclosure, search(query, ctx), fetchRelatives(ref, ctx) }`. Treffer sind `ExternalPerson` mit Verweis (`system:id`) und Link; `fetchRelatives` liefert eine Generation (Eltern, Partner, Kinder) als `ImportBatch` mit Unions über Verweise. Tiefer geht man durch erneutes Abfragen einer Person. `fetch` kommt aus dem Kontext, daher laufen alle Tests mit nachgebauten Antworten ohne Netz. Abfragen löst nur der Nutzer aus („Suchen“, „Übernehmen“); der Dialog nennt vorher, was gesendet wird. Keine neuen Abhängigkeiten.
- **Wikidata:** SPARQL-Endpunkt `query.wikidata.org` (CORS `*`, im Browser gemessen). Suche per `mwapi`-Volltext (`haswbstatement:P31=Q5`; findet „Johann Goethe“ für „Johann Wolfgang von Goethe“, die Etikettensuche fand ihn nicht). Geburt/Tod mit Genauigkeit (Tag/Monat/Jahr genau, Jahrzehnt/Jahrhundert = „um“; v. Chr. wird verworfen), Familienname aus P734, sonst letztes Wort. Verwandte über P22, P25, P26, P40; Kinder gehören zum Partner, der als anderer Elternteil eingetragen ist. Suchtext wird maskiert, Q-Nummern werden geprüft (keine Abfrage-Einschleusung). Die Suche dauert ca. 5 s (Volltext plus Details).
- **WikiTree:** `api.wikitree.com/api.php` (`searchPerson`, `getRelatives`), nur öffentliche Profile. **Kein CORS** (im Browser gemessen: kein `Access-Control-Allow-Origin`), der Browser darf die API nicht direkt abrufen. Entschieden (mit dem Nutzer): Basisadresse einstellbar; `npm run dev` leitet `/wikitree` über Vite weiter, **ohne Cookies und Browserkennung** (mit den Browser-Kopfzeilen sperrte WikiTree mit 403); im gebauten Stand braucht man einen eigenen Durchleiter, sonst kommt die Meldung „nicht erreichbar … CORS“. Kein Proxy im Produkt (D6). Bekannte Grenze: `getRelatives` liefert bei Kindern oft nur Nachnamen; die übernommenen Kinder tragen dann nur den Nachnamen.
- **FamilySearch:** nur Gerüst. Braucht Entwicklerschlüssel und OAuth; der Anbieter nimmt ein vom Nutzer besorgtes Zugriffstoken (nur im Arbeitsspeicher, als Kopfzeile, nie in der Adresse). Die Suche ist nach der GEDCOM-X-Beschreibung gebaut und nur gegen nachgebaute Antworten getestet, **nicht gegen den echten Dienst**; `fetchRelatives` meldet `unsupported`. In der Oberfläche „Gerüst, ungeprüft“.
- **Zeitwerte:** WikiTree „1755-00-00“ → Jahr; `DataStatus` „guess/before/after“ → about/before/after.

## D26 – Dubletten und Übernahme (2026-11-14)
- **Dubletten** (`src/core/duplicates.ts`, reines TS): `DuplicateFinder` gruppiert einmal nach normalisiertem Nachnamen (keine Vollsuche pro Anfrage, auch bei 50.000 Personen). Wertung 0–1 aus Nachname (gleich 0,3 / ein Tippfehler 0,2, ab 5 Zeichen), Vorname (0,3 / weiterer 0,2 / Initiale 0,1), Geburtsjahr (gleich 0,3, ±2 0,2, ±5 0,1), Sterbejahr (0,1 / 0,05). **Ausschluss** bei anderem Vornamen, bekannt verschiedenem Geschlecht, Jahren mehr als 5 auseinander. Mindestwert 0,5; Stufen hoch ≥ 0,85, mittel ≥ 0,65. Nur Vorschläge mit Gründen.
- **Übernahme** (`adoptBatch`, ohne Netz): Neue Personen, Ereignisse, Partnerschaften und Kinder-Verknüpfungen tragen `status: "assumed"`, dazu eine Quelle je Person (Titel „WikiTree: Name“, Link) und eine Notiz „Übernommen aus … (vermutet, nicht geprüft)“. Neue IDs fortlaufend (`p_n`, `u_n`, `s_n`). Steht der Verweis schon im Baum, wird die Person wiederverwendet (eine zweite Übernahme erzeugt nichts Neues). Passt eine Union mit denselben Partnern, kommen die Kinder dort hinein; ein Kind, das schon in einer anderen biologischen Union steht, wird nicht doppelt verknüpft (Hinweis statt Verletzung der Invariante).
- **„Ist dieselbe Person“:** nur auf Klick des Nutzers; hängt nur Verweis (`externalRefs`) und Notiz mit Link an die vorhandene Person, deren Daten bleiben unverändert (keine Quelle, sie hinge an keiner Aussage). Echtes Zusammenführen zweier Personen gibt es weiter nicht.
- Verwandte, die vorhandenen Personen ähneln, meldet `possibleDuplicates` (Zahl in der Meldung nach der Übernahme); sie bleiben als neue Personen bestehen.

## D27 – Baum ändern: `replaceTree` (2026-11-14)
Die Übernahme ändert zum ersten Mal einen Baum. Statt einzelner Schreibvorgänge (D13: „Ändern kommt später“) ersetzt `TreeStore.replaceTree(id, data)` den Inhalt in einer Transaktion (Löschen per Schlüsselbereich, neu schreiben; Name und Anlegedatum bleiben). Bei Bäumen mit 50.000 Personen ist das pro Übernahme ein Voll-Neuschreiben; für Einzelbearbeitung (offen) bräuchte es gezielte Schreibvorgänge. Ein ungespeicherter Baum bleibt ungespeichert (die Meldung sagt es). Die Ansicht wird neu aufgebaut und springt auf die übernommene Person (`startId`).

## D28 – Zeichenfläche: S-Kurven, Avatar-Karten, Filter in der Szene (2026-11-14)
Ersetzt in D23 die **Linienführung** (Sammelschienen und Spuren sind nur noch Zusatzmodus), die Kartenform und die Kamerabewegung; Stile, Farben, „+n“ und Eingaben bleiben.
- **Linien:** Standard `curved`: je Kind eine kubische Bézierkurve vom Union-Anker (bei einem Elternteil unter der Karte) zur Oberkante des Kindes, senkrecht aus- und einlaufend, Stützpunkte in halber Höhe. Kein Stamm, keine Schiene, keine Spuren. Partnerlinien bleiben gerade. Umschaltbar auf `orthogonal` (Verhalten wie D23), weil dichte Ansichten damit lesbarer bleiben. `SceneEdge.curve` markiert die Kurven; die Begrenzungsbox läuft über die vier Punkte (Stützpunkte liegen in der Hülle), das Raster `GridIndex` bleibt unverändert.
- **Detailstufen:** Kurven nur ab Zoom 0,12 (`LOD_CURVE`), darunter Gerade Start–Ende. Rolle zur Fokusperson auf der Karte ab Zoom 0,55 (`LOD_ROLE`), wird nur für sichtbare Karten berechnet und je Fokus zwischengespeichert (`describeRelationship`, „nicht verwandt“ wird nicht gezeigt).
- **Karten:** Eckenradius 14 (ab Textstufe, sonst 6), Avatar-Kreis mit Initialen in der Familienfarbe statt des Farbstreifens, Leuchten (`shadowBlur`) nur bei Fokus und Hover. Hintergrund: senkrechter Verlauf (einmal je Höhe angelegt). Akzent bleibt Türkis (`#4dd0c8`).
- **Kamerafahrt:** bei Fokuswechsel gleitet die Kamera in 380 ms (Ease-out, Zoom logarithmisch) vom alten zum neuen Ausschnitt; bei mehr als 4.000 Karten springt sie. Ziehen, Zoom und Einpassen brechen die Fahrt ab.
- **Filter in der Szene, nicht im Layout:** `buildScene(result, persons, {lineMode, showUnconfirmed, showUnknown})`. „Unbestätigte Verbindungen“ aus = gestrichelte Linien entfallen (Karten bleiben); „Unbekannte Personen“ aus = Karten ohne Namen oder mit Status `unknown` entfallen samt ihrer Linien, die Fokuskarte nie. Folge: Lücken im Layout bleiben stehen, dafür ist der Wechsel ohne Worker-Aufruf sofort da. `src/core/layout` blieb unverändert. Zähler „x von y“: x = Personen (ohne Geister) nach dem Filter, y = Personen der aktuellen Ansicht vor dem Filter (nicht der ganze Baum).
- **Messung** (Chromium im Browser-Pane, `tree-50000.json`, Modus `direct` 0/30 = 4.648 Personen, 1.700 sichtbare Elemente eingepasst; Median von 10 Bildern, Zeichenzeit): geschwungen eingepasst 2,2 ms, rechtwinklig 3,5 ms; mittlerer Zoom 1,0–3,6 ms (geschwungen) gegenüber 1,7–2,4 ms (rechtwinklig); Zoom nah 0,1–0,4 ms. Streuung der Einzelwerte etwa ±1 ms. Ziel < 16 ms mit großem Abstand erreicht; die Kurven sind im Mittel etwas teurer, aber nicht spürbar.
- **Keine neue Abhängigkeit.**

## D29 – Ahnen-Reiter: Ahnentafel im Kern (2026-11-14)
- **Kern:** `src/core/pedigree.ts` mit `buildAhnentafel(g, id, {maxDepth, maxRows})`, `fatherAndMother` und `pedigreeReport` (Tafel + `pedigreeCollapse` + `inbreedingCoefficient`). Sosa-Nummern: Person 1, Vater 2n, Mutter 2n+1. Vater/Mutter nach Geschlecht der Partner der Eltern-Union (bevorzugt leiblich), unbekanntes Geschlecht füllt der Reihe nach auf.
- **Ahnenschwund in der Tafel:** Ein mehrfach erreichbarer Ahn steht unter jeder Sosa-Nummer, seine Eltern aber nur unter der ersten (`duplicateOf`, UI: „siehe Nr. n“). Die Tafel bleibt so höchstens so lang wie die Zahl verschiedener Ahnen und wächst nicht mit 2^Tiefe.
- **Grenzen:** Tiefe höchstens 30 (Sosa-Nummern bleiben exakte Zahlen), Standard 6 im UI, Auswahl bis 20; höchstens 3.000 Zeilen, danach Hinweis „abgeschnitten“. Gemessen mit `tree-50000.json` (stark verflochtener Testbaum): Neuberechnung bei Tiefe 12–20 unter 25 ms.
- **UI:** `AncestorsView.svelte` zeigt nur an. Klick auf einen Namen setzt den Fokus über `viewer.focusOn`, der Reiter bleibt „Ahnen“.
- **Keine neue Abhängigkeit.** Fächerdiagramm bleibt offen.
