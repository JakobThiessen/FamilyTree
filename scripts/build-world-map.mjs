// Erzeugt src/ui/worldMap.ts aus Natural-Earth-Daten (gemeinfrei, public domain, siehe D36 und LIZENZ.md).
// Einmalig ausführen, die erzeugte Datei wird eingecheckt; zur Laufzeit ist keine Bibliothek nötig.
//
// Eingabe: zwei GeoJSON-Dateien von https://www.naturalearthdata.com/ (1:50m):
//   ne_50m_land.geojson   (physical/ne_50m_land)
//   ne_50m_lakes.geojson  (physical/ne_50m_lakes)
// Aufruf:  node scripts/build-world-map.mjs <Ordner mit den GeoJSON-Dateien> [Toleranz in Grad, Standard 0.12]
//
// Schritte: nur Außenringe, Antarktis weglassen (liegt außerhalb des sichtbaren Ausschnitts),
// Kleinstinseln weglassen, Douglas-Peucker-Vereinfachung, auf 1 Nachkommastelle runden,
// jeden Ring als Text "lon,lat lon,lat …" ablegen (kompakter als verschachtelte Felder).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("Aufruf: node scripts/build-world-map.mjs <Ordner> [Toleranz]");
  process.exit(1);
}
const TOL = Number(process.argv[3] ?? 0.12);
const MIN_LAT = -58; // Ausschnitt der Karte, siehe MAP_BOUNDS
const MIN_SIZE = 0.6; // Inseln, deren Rahmen in beiden Richtungen kleiner ist, entfallen (Grad)
const MIN_LAKE_AREA = 4; // nur große Seen (Quadratgrad Rahmen), z. B. Kaspisches Meer, Obere See, Viktoriasee

/** Außenringe aller Polygone eines GeoJSON-Features. */
function outerRings(geojson) {
  const rings = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") rings.push(g.coordinates[0]);
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) rings.push(poly[0]);
  }
  return rings;
}

function bbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Abstand eines Punkts p von der Strecke a–b. */
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker ohne Rekursion (Küstenringe können tausende Punkte haben). */
function simplify(points, tol) {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let far = -1, farD = tol;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(points[i], points[s], points[e]);
      if (d > farD) { far = i; farD = d; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([s, far], [far, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (v) => Math.round(v * 10) / 10;

function encode(ring, tol) {
  const open = ring.slice(0, -1); // GeoJSON schließt den Ring mit dem Startpunkt, das tun wir beim Zeichnen
  const s = simplify(open, tol).map(([x, y]) => [round(x), round(y)]);
  // Nach dem Runden entstandene Doppelpunkte entfernen
  const out = s.filter((p, i) => i === 0 || p[0] !== s[i - 1][0] || p[1] !== s[i - 1][1]);
  return out.length >= 3 ? out.map(([x, y]) => `${x},${y}`).join(" ") : null;
}

const land = outerRings(JSON.parse(readFileSync(join(dir, "ne_50m_land.geojson"), "utf8")))
  .filter((r) => {
    const b = bbox(r);
    if (b.maxY < MIN_LAT) return false; // Antarktis
    return b.w >= MIN_SIZE || b.h >= MIN_SIZE;
  })
  .map((r) => encode(r, TOL))
  .filter(Boolean);

const lakes = outerRings(JSON.parse(readFileSync(join(dir, "ne_50m_lakes.geojson"), "utf8")))
  .filter((r) => {
    const b = bbox(r);
    return b.w * b.h >= MIN_LAKE_AREA;
  })
  .map((r) => encode(r, TOL))
  .filter(Boolean);

const lines = (arr) => arr.map((s) => `  "${s}",`).join("\n");
const out = `/**
 * Weltkarte zum Mitliefern (offline, D31, D36). GENERIERT von scripts/build-world-map.mjs, nicht von Hand ändern.
 *
 * Quelle: Natural Earth (https://www.naturalearthdata.com/), Maßstab 1:50m, Ebenen "Land" und "Lakes".
 * Natural Earth ist gemeinfrei (public domain); Hinweis in LIZENZ.md. Vereinfacht (Toleranz ${TOL}°), ohne
 * Antarktis und ohne Kleinstinseln, Koordinaten auf 0,1° gerundet.
 * Ringe sind Text "lon,lat lon,lat …" (kompakt) und werden beim Laden einmal in Punktfelder umgewandelt.
 */
export type Ring = readonly (readonly [number, number])[];

const LAND_DATA = [
${lines(land)}
];

const LAKES_DATA = [
${lines(lakes)}
];

const parse = (rings: string[]): Ring[] =>
  rings.map((r) => r.split(" ").map((p) => p.split(",").map(Number) as [number, number]));

/** Landmassen (Außenringe), Längengrade −180…180 (an der Datumsgrenze geteilt, wie bei Natural Earth). */
export const LAND: Ring[] = parse(LAND_DATA);

/** Große Binnenseen und Binnenmeere (z. B. Kaspisches Meer), in Meeresfarbe über das Land gelegt. */
export const INLAND_SEAS: Ring[] = parse(LAKES_DATA);

/** Sichtbarer Ausschnitt der Karte (Breitengrade, Pole abgeschnitten). */
export const MAP_BOUNDS = { minLon: -180, maxLon: 180, minLat: -58, maxLat: 84 } as const;
`;
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "worldMap.ts");
writeFileSync(target, out, "utf8");
console.log(`${land.length} Landringe, ${lakes.length} Seen, ${(out.length / 1024).toFixed(0)} kB -> ${target}`);
