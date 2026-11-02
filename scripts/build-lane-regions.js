// Builds apps/web/src/data/lane-regions.json, the outlines of Canada's provinces and
// territories and the U.S. states drawn on a carrier's lanes map (owner's request,
// 2026-11-01; docs/DECISIONS.md).
//
// Source: Natural Earth's 1:50m "Admin 1 – States, Provinces", which is in the public domain
// (https://www.naturalearthdata.com/about/terms-of-use/). Download
// ne_50m_admin_1_states_provinces.geojson from
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson, then run:
//
//   node scripts/build-lane-regions.js path/to/ne_50m_admin_1_states_provinces.geojson
//
// It keeps the 64 places a lane can run between, simplifies their outlines (about 2 km), and
// keeps Natural Earth's label point for each (the map no longer draws lines between them).
import { readFileSync, writeFileSync } from 'node:fs';

const [source] = process.argv.slice(2);
if (!source) {
  console.error(
    'Usage: node scripts/build-lane-regions.js <ne_50m_admin_1_states_provinces.geojson>',
  );
  process.exit(1);
}

const TOLERANCE = 0.02; // degrees
const round = (value) => Math.round(value * 100) / 100;

/** Distance from p to the segment a–b, in degrees. */
function segmentDistance(p, a, b) {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Douglas–Peucker simplification of one line. */
function simplify(points) {
  if (points.length < 3) return points;
  let furthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (distance > furthest) {
      furthest = distance;
      index = i;
    }
  }
  if (furthest <= TOLERANCE) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, index + 1)).slice(0, -1), ...simplify(points.slice(index))];
}

/** A ring simplified and rounded; null when too small to draw. */
function ring(points) {
  const simplified = simplify(points).map(([x, y]) => [round(x), round(y)]);
  const kept = simplified.filter(
    (point, i) => i === 0 || point[0] !== simplified[i - 1][0] || point[1] !== simplified[i - 1][1],
  );
  if (kept.length < 4) return null;
  const [first] = kept;
  const last = kept[kept.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) kept.push(first);
  return kept;
}

function polygon(rings) {
  const [outer, ...holes] = rings.map(ring);
  return outer ? [outer, ...holes.filter(Boolean)] : null;
}

const data = JSON.parse(readFileSync(source, 'utf8'));
const features = data.features
  .filter((feature) => ['CA', 'US'].includes(feature.properties.iso_a2))
  .map((feature) => {
    const { type, coordinates } = feature.geometry;
    const polygons = (type === 'Polygon' ? [coordinates] : coordinates)
      .map(polygon)
      .filter(Boolean);
    return {
      type: 'Feature',
      properties: {
        code: feature.properties.iso_3166_2,
        center: [round(feature.properties.longitude), round(feature.properties.latitude)],
      },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    };
  })
  .sort((a, b) => a.properties.code.localeCompare(b.properties.code));

if (features.length !== 64) throw new Error(`expected 64 places, found ${features.length}`);
writeFileSync(
  new URL('../apps/web/src/data/lane-regions.json', import.meta.url),
  `${JSON.stringify({ type: 'FeatureCollection', features })}\n`,
);
console.log(`Wrote ${features.length} places.`);
