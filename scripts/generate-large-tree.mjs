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

const persons = [];
const unions = [];
let uid = 0;

const newPerson = (year) => {
  const id = `p_${persons.length + 1}`;
  const sex = rnd() < 0.5 ? "M" : "F";
  persons.push({
    id,
    givenNames: given[Math.floor(rnd() * given.length)],
    surname: family[Math.floor(rnd() * family.length)],
    sex,
    birth: { date: { kind: "exact", year } },
  });
  return persons[persons.length - 1];
};

// Generationenweise aufbauen, ca. 25 Jahre pro Generation
let generation = [newPerson(1700), newPerson(1701)];
while (persons.length < count) {
  const next = [];
  for (let i = 0; i + 1 < generation.length && persons.length < count; i += 2) {
    const a = generation[i];
    const b = generation[i + 1];
    const kids = 1 + Math.floor(rnd() * 4);
    const children = [];
    const year = a.birth.date.year + 25;
    for (let k = 0; k < kids && persons.length < count; k++) {
      const c = newPerson(year + k * 2);
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
