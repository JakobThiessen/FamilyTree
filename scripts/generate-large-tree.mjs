// Erzeugt einen großen, erfundenen Testbaum für Performance-Tests.
// Aufruf: node scripts/generate-large-tree.mjs 50000
// Ergebnis: example/performance/tree-<N>.json (internes Format)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const count = Number(process.argv[2] ?? 50000);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "example", "performance");
mkdirSync(outDir, { recursive: true });

// Einfacher deterministischer Zufall, damit Testläufe vergleichbar sind
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const given = ["Johann", "Anna", "Maria", "Georg", "Elisabeth", "Heinrich", "Katharina", "Peter", "Margarete", "Karl"];
const family = ["Muster", "Beispiel", "Probe", "Vorlage", "Altmann", "Neumann", "Bauer", "Schmidt"];

// Orte mit echten Ortsnamen und ungefähren Koordinaten (Geographie ist kein Personenbezug).
// Koordinaten stehen direkt am Ort (`place.lat/lon`, wie bei GEDCOM `MAP`), die Karte braucht keine Abfrage.
const HOME = [
  ["Hamburg", 53.55, 9.99], ["Bremen", 53.08, 8.8], ["Hannover", 52.37, 9.73], ["Berlin", 52.52, 13.4],
  ["Köln", 50.94, 6.96], ["Frankfurt am Main", 50.11, 8.68], ["Stuttgart", 48.78, 9.18], ["München", 48.14, 11.58],
  ["Leipzig", 51.34, 12.37], ["Dresden", 51.05, 13.74], ["Danzig", 54.35, 18.65], ["Wien", 48.21, 16.37],
];
const ABROAD = [
  ["New York", 40.71, -74.01], ["Chicago", 41.88, -87.63], ["Buenos Aires", -34.6, -58.38], ["Sydney", -33.87, 151.21],
  ["Auckland", -36.85, 174.76], ["Honolulu", 21.31, -157.86], ["Kapstadt", -33.92, 18.42], ["Sankt Petersburg", 59.93, 30.34],
];
const placeOf = ([name, lat, lon]) => ({ name, lat, lon });
/** Ort des Kindes: meist wie die Eltern, manchmal ein Nachbarort, selten Auswanderung (ab 1800 häufiger). */
const pickPlace = (parentPlace, year) => {
  const r = rnd();
  const abroad = year >= 1800 ? 0.04 : 0.005;
  if (!parentPlace || r < abroad) return placeOf(ABROAD[Math.floor(rnd() * ABROAD.length)]);
  if (r < 0.2) return placeOf(HOME[Math.floor(rnd() * HOME.length)]);
  return parentPlace;
};

const persons = [];
const unions = [];
let uid = 0;

const newPerson = (year, parentPlace) => {
  const id = `p_${persons.length + 1}`;
  const sex = rnd() < 0.5 ? "M" : "F";
  persons.push({
    id,
    givenNames: given[Math.floor(rnd() * given.length)],
    surname: family[Math.floor(rnd() * family.length)],
    sex,
    birth: { date: { kind: "exact", year }, place: pickPlace(parentPlace, year) },
  });
  const p = persons[persons.length - 1];
  // Etwa zwei Drittel haben einen Sterbeort (Geburtsort oder anderer Ort), Sterbejahr nach 55 bis 85 Jahren
  if (rnd() < 0.66) {
    const dy = year + 55 + Math.floor(rnd() * 30);
    p.death = { date: { kind: "exact", year: dy }, place: rnd() < 0.7 ? p.birth.place : pickPlace(p.birth.place, dy) };
  }
  return p;
};

// Generationenweise aufbauen, ca. 25 Jahre pro Generation
let generation = [newPerson(1700, placeOf(HOME[0])), newPerson(1701, placeOf(HOME[0]))];
while (persons.length < count) {
  const next = [];
  for (let i = 0; i + 1 < generation.length && persons.length < count; i += 2) {
    const a = generation[i];
    const b = generation[i + 1];
    const kids = generation.length <= 4 ? 3 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 4); // kleine Generationen bekommen mehr Kinder, sonst stirbt die Linie aus
    const children = [];
    const year = a.birth.date.year + 25;
    for (let k = 0; k < kids && persons.length < count; k++) {
      const c = newPerson(year + k * 2, a.birth.place);
      children.push({ personId: c.id, kind: "biological" });
      next.push(c);
    }
    unions.push({ id: `u_${++uid}`, partnerIds: [a.id, b.id], kind: "marriage", order: 1, children });
  }
  // Partner für die nächste Generation: einfach benachbarte Kinder paaren,
  // gelegentlich Geschwister-Nachkommen (Cousinen) nebeneinander
  generation = next;
  if (generation.length < 2) break;
}

const data = { version: 1, persons, unions, sources: [] };
const file = join(outDir, `tree-${count}.json`);
writeFileSync(file, JSON.stringify(data));
console.log(`${persons.length} Personen, ${unions.length} Unions -> ${file}`);
