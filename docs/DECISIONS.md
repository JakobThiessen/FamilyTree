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
