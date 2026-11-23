// Builds apps/web/public/grid/alberta-townships.json, the township grid of the oil and gas map
// (F-240, F-271; the owner, 2026-11-22: the grid "needs to load much faster and be snappy and
// quickly generated once"). Made once from the Government of Alberta's township grid service and
// kept with the app, so the map draws every township at once without asking the province.
//
// Source: the Alberta Township System service, layer 14 (township outlines),
// https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer,
// "Copyright Government of Alberta", under the Open Government Licence – Alberta (named on the
// map under Sources & licence). Run again only if the province changes the grid:
//
//   node scripts/build-township-grid.js
//
// It keeps each edge once (two townships share most of theirs; drawn twice, a line would look
// darker than the picture the owner gave), joins the edges into long lines, and keeps each
// township's box and numbers for the range and township labels along the map's edges.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';

const SERVICE =
  'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer/14/query';
const OUT = fileURLToPath(
  new URL('../apps/web/public/grid/alberta-townships.json', import.meta.url),
);
/** About 20 m: far below a pixel where the townships are drawn (from zoom 7.8). */
const OFFSET = '0.0002';

async function page(offset) {
  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    outFields: 'M,RGE,TWP',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: OFFSET,
    geometryPrecision: '5',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: '1000',
  });
  const res = await fetch(`${SERVICE}?${params.toString()}`);
  if (!res.ok) throw new Error(`the service answered ${String(res.status)}`);
  const answer = await res.json();
  if (!Array.isArray(answer.features)) throw new Error('the service sent no list of shapes');
  return answer.features;
}

const key = ([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const r5 = (n) => Math.round(n * 1e5) / 1e5;

async function main() {
  const features = [];
  for (let offset = 0; ; offset += 1000) {
    const got = await page(offset);
    features.push(...got);
    if (got.length < 1000) break;
  }

  // Each edge once, and each township's numbers and box.
  const edges = new Map();
  const townships = [];
  for (const f of features) {
    const { M, RGE, TWP } = f.properties ?? {};
    if (![M, RGE, TWP].every((n) => Number.isInteger(n) && n > 0)) continue;
    const polygons =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i += 1) {
          const [x, y] = ring[i];
          west = Math.min(west, x);
          east = Math.max(east, x);
          south = Math.min(south, y);
          north = Math.max(north, y);
          if (i === 0) continue;
          const a = key(ring[i - 1]);
          const b = key(ring[i]);
          if (a === b) continue;
          const id = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (!edges.has(id)) edges.set(id, [a, b]);
        }
      }
    }
    townships.push([M, RGE, TWP, r4(west), r4(south), r4(east), r4(north)]);
  }

  // Edges joined into lines: from each end, follow the one next edge while there is exactly one.
  const at = new Map();
  for (const [id, [a, b]] of edges) {
    for (const end of [a, b]) {
      const list = at.get(end) ?? [];
      list.push(id);
      at.set(end, list);
    }
  }
  const used = new Set();
  const lines = [];
  const walk = (from, start) => {
    const points = [from];
    let point = from;
    let id = start;
    while (id && !used.has(id)) {
      used.add(id);
      const [a, b] = edges.get(id);
      point = a === point ? b : a;
      points.push(point);
      const next = (at.get(point) ?? []).filter((e) => !used.has(e));
      id = (at.get(point) ?? []).length === 2 && next.length === 1 ? next[0] : undefined;
    }
    return points;
  };
  // Start at the ends and the crossings first, so the lines run between them.
  const starts = [...at.keys()].sort(
    (p, q) => Number(at.get(p).length === 2) - Number(at.get(q).length === 2),
  );
  for (const point of starts) {
    for (const id of at.get(point)) {
      if (used.has(id)) continue;
      const points = walk(point, id);
      lines.push(points.flatMap((p) => p.split(',').map((n) => r5(Number(n)))));
    }
  }

  townships.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const file = {
    source:
      'Government of Alberta, Alberta Township System, township outlines (Open Government Licence – Alberta)',
    built: new Date().toISOString().slice(0, 10),
    // Each line its points one after another: longitude, latitude, longitude, latitude ...
    lines,
    // Each township: meridian, range, township, west, south, east, north.
    townships,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(file)}\n`);
  console.log(
    `${String(townships.length)} townships, ${String(edges.size)} edges in ${String(lines.length)} lines.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
