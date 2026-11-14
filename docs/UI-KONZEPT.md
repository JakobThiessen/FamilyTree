# UI-Konzept: Oberfläche mit Rubriken

Entwurf, abgestimmt mit dem Nutzer (Stand 2026-11-14). Vorbild: Stammbaum-App aus Niklas Steenfatts Video (Minute 6:00–7:22, kein Quellcode öffentlich). Wir übernehmen die **Aufteilung**, nicht den Code oder das Design im Detail.

## Was im Video zu sehen ist
- **Kopfleiste:** Logo mit Untertitel links, in der Mitte Reiter **Stammbaum · Ahnen · Zeitleiste · Karte · Forschung · Quellen**, rechts Suche und Sprachumschalter DE/EN. Dunkler Hintergrund, Goldton als Akzent.
- **Stammbaum:** links ein schwebendes Panel mit Filter (Direkte Linie / Familie / Alle), Zähler „x von y Personen sichtbar“, Schaltern „Unbestätigte Verbindungen“ und „Unbekannte Personen“, Legende der **Familienlinien** (Farbchips, dazu „Linie: Name unbekannt“, „Angeheiratet & Stieffamilie“), Linienlegende (belegt = durchgezogen, unbestätigt = gestrichelt), Knopf „Geschichte erzählen“. Karten mit Rolle zur Fokusperson (Vater, Stiefmutter, Schwester …) und „+2“-Knöpfen.
- **Karte:** Panel „Orte & Wege“ mit Umschalter Lebenswege / Orte, Personenliste (Jahre, Anzahl Orte), dunkle Weltkarte mit gestrichelten Bögen zwischen Orten, Zoomknöpfe, Legende.
- Zeitleiste, Ahnen, Forschung und Quellen sind im Ausschnitt nur als Reiter zu sehen (Zeitleiste wird erwähnt: „noch unvollständig“).

## Zuordnung zu unserem Stand
| Rubrik | Status | Grundlage im Projekt | Fehlt |
|---|---|---|---|
| **Stammbaum** | vorhanden (M6/M7) | `TreeViewer`, `PersonDetails`, Suche | Filterpanel wie im Video, Familienlinien-Legende, Schalter für unbestätigt/unbekannt, Zähler „x von y“, Rolle zur Fokusperson auf der Karte |
| **Ahnen** | neu | `ancestorLevels`, `pedigreeCollapse`, `describeRelationship`, `inbreedingCoefficient` (M4) | Ahnentafel (Sosa-Nummern je Generation), Ahnenschwund und Implex anzeigen, optional Fächerdiagramm |
| **Zeitleiste** | neu | Geburt/Tod/Union-Daten (`FuzzyDate`, `yearRange`) | Zeitachse mit Lebensbalken, Ereignisse, Unschärfe (um/vor/zwischen) sichtbar |
| **Karte** | neu | `Place` mit optional `lat/lon` | Koordinaten (GEDCOM liefert meist keine), Kartenhintergrund, Lebenswege |
| **Forschung** | optional, später | Dublettenvorschläge, Treffer „vermutet“ (M8), `validate()`-Probleme | Aufgabenliste: fehlende Eltern/Daten, Dubletten, unbestätigte Aussagen |
| **Quellen** | optional, später | `Source`, `Citation` | Quellenliste mit „wer nutzt sie“, Filter |

## Vorschlag für die Umsetzung
Kleine Schritte, jeder für sich lauffähig. Reihenfolge nach Nutzen und Risiko.

1. **Rahmen (klein, sofort):** Kopfleiste mit Reitern in `App.svelte`, einfacher Router über ein `$state`-Feld (kein Router-Paket nötig). Suche in die Kopfleiste, Sprache DE/EN als Platzhalter. Zeichenfläche bleibt in `src/render`. Reiter ohne Inhalt zeigen „folgt“.
2. **Stammbaum-Panel:** Filterpanel links wie im Video (schwebend, einklappbar), Familienlinien-Legende aus `lineColor`, Schalter „Unbestätigte Verbindungen“ und „Unbekannte Personen“ (braucht Filter in `buildScene` bzw. beim Layout: unbestätigte Kanten/Karten ausblenden), Zähler „x von y“, Rolle zur Fokusperson auf der Karte (`describeRelationship`, nur bei sichtbarem Zoom).
3. **Ahnen:** reine Auswertung mit vorhandener M4-API: Tabelle je Generation (Sosa-Nummer, Name, Lebensspanne), Ahnenschwund (`pedigreeCollapse`), Inzuchtkoeffizient. Fächerdiagramm als Canvas später.
4. **Zeitleiste:** neues Modul `src/core/timeline.ts` (reines TS: Personen und Ereignisse → Zeilen mit Jahresspanne), Darstellung als Canvas oder SVG, gruppiert nach Familienlinie; unscharfe Daten als verlaufender Rand.
5. **Karte:** vorher entscheiden (siehe Fragen). Zunächst Orte als Liste mit Anzahl, dann Karte.
6. **Forschung/Quellen:** erst nach M8, weil sie dessen Dublettenvorschläge und Provider nutzen.

Vorschlag zur Einordnung im Plan: Schritt 1–2 als **M7b**, Ahnen und Zeitleiste und Karte als **M9a–c** (vor dem Feinschliff), Forschung/Quellen als optionale Rubriken nach M8. Die laufende M8-Sitzung bleibt davon unberührt.

## Zeichenfläche: weicher und moderner (Schritt 0, vor dem Rahmen)
Im Video wirkt das Canvas geschmeidiger als unseres. Beobachtet: Verbindungen als **weiche S-Kurven** statt rechtwinkliger Sammelschienen (D23), **stärker gerundete Karten** mit Avatar-Kreis und feinem Rand, **Leuchten** um die Fokuskarte, Hintergrund mit sanftem Verlauf. Umsetzung in `src/render` (Zeichner, ohne Svelte):
- Linien als Bézierkurven (`bezierCurveTo`) vom Union-Anker zum Kind, senkrecht ein- und auslaufend; Partnerlinien bleiben kurz und gerade. Die Sammelschienen und Spuren aus D23 entfallen im Kurvenmodus. Umschaltbar („Linien: geschwungen / rechtwinklig“), damit dichte Ansichten lesbar bleiben.
- Leistung: Kurven sind etwas teurer. Culling über die Begrenzungsbox der Kurve (`GridIndex` bleibt), Bündeln je Farbe und Stil bleibt, unter Zoom 0,06 weiterhin gerade Striche. Vorher/nachher messen wie in D21 (Ziel unter 16 ms bei 50.000 Personen).
- Karten: größerer Eckenradius, Avatar-Kreis (Initialen in der Familienfarbe), weicher Schatten/Leuchten nur bei Fokus und Hover (nicht bei jeder Karte, sonst zu teuer).
- Bewegung: Kamera fährt bei Fokuswechsel weich zur neuen Karte (kurze Animation, bei vielen Karten abgekürzt).
- Neue Entscheidung D-Nummer nötig (ersetzt Teile von D23).

## Entschieden (2026-11-14)
- **Kartenhintergrund:** zunächst mitgelieferte, vereinfachte Offline-Weltkarte; Online-Kacheln höchstens später auf Knopfdruck.
- **Orte ohne Koordinaten:** Auflösung über Wikidata (offen, kein Schlüssel), nur wenn der Nutzer sie auslöst, Ergebnis lokal speichern und als „vermutet“ markieren. Nominatim nur im Ausnahmefall (strenge Nutzungsregeln, keine Massenabfragen). Hängt an den Providern aus M8.
- **Akzentfarbe:** bleibt unser Türkis.
- Rest der folgenden Liste (KI-Erzählung, Sprache) bleibt wie beschrieben.

## Offene Fragen (vor dem Bauen klären) – Ursprungsliste
1. **Kartenhintergrund:** Online-Kacheln (z. B. OpenStreetMap) senden die Kartenausschnitte an einen Dienst (AGENTS.md: keine Daten nach außen ohne bewusste Auslösung). Alternative: mitgelieferte, vereinfachte Weltkarte (GeoJSON, wenige hundert kB, offline) und eigenes Zeichnen auf Canvas. Empfehlung: offline-Umriss zuerst, Kacheln nur auf Knopfdruck.
2. **Koordinaten für Orte:** GEDCOM-Importe haben meist nur Ortsnamen. Auflösen per Wikidata/Nominatim (Abfrage bewusst auslösen, Ergebnis lokal speichern, als „vermutet“ markieren) – passt zu M8.
3. **Reiter „Geschichte erzählen“ (KI-Erzählung):** nicht geplant; würde Personendaten an einen KI-Dienst senden. Nur auf ausdrücklichen Wunsch.
4. **Sprache:** DE/EN-Umschalter erst mit M9 (Texte sind bisher fest Deutsch), Platz in der Kopfleiste aber schon einplanen.
5. **Design:** Goldakzent wie im Video oder bei unserem Türkis bleiben?
