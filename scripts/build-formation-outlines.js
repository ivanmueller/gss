#!/usr/bin/env node
// Builds the formation outlines of the oil and gas map's Formations section (F-280), one file a
// formation in apps/web/public/outlines/, from the Alberta Geological Survey's Digital Dataset
// 2013-0024 (Rokosh et al., 2013, "Alberta Shale Report: Outlines of Evaluated Shale and
// Siltstone Units": the areas its 2012 shale report evaluated), which the AER/AGS licenses under
// the Open Government Licence – Alberta (its metadata, read 2026-11-20; credited on the map under
// Sources & licence). Open data, so the shapes are kept with the app. Run again only if the
// Survey changes the dataset:
//
//   curl -o dig.zip https://static.ags.aer.ca/files/document/DIG/DIG_2013_0024.zip
//   unzip dig.zip -d dig
//   node --experimental-strip-types scripts/build-formation-outlines.js \
//     dig/shalegas_fms_py_ll.shp dig/shalegas_fms_py_ll.dbf
//   pnpm exec prettier --write apps/web/public/outlines
//
// The other formations (F-281) are zones of the Survey's 3D model, the Geological Framework of
// Alberta, Version 4 (Open Government Licence – Alberta): each zone's package from the model's
// bulk download, of which only `Extent_Top_<code>_v4_wgs84.*` (where the zone is present, in
// web-map coordinates despite the name) is used, each in a folder named for its code:
//
//   B=https://aercclrsuatagsgispub01.blob.core.windows.net/arcgis-online/projects/GFA/Bulk_download
//   curl -o 28_K_Ca.zip $B/28_K_Ca_v4_wgs84.zip && unzip -j 28_K_Ca.zip -d zones/28_K_Ca
//   (one for each `model` code of FORMATION_OUTLINES)
//   node --experimental-strip-types scripts/build-formation-outlines.js --model zones
//
// Each outline keeps the Survey's rings as they are (longitude and latitude, NAD83, to four
// decimal places, about 10 m), each hole with the ring it lies in.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { dbaseTable } from '../packages/domain/src/facilities.ts';
import { FORMATION_OUTLINES } from '../packages/domain/src/formationOutlines.ts';

const OUT = (key) =>
  fileURLToPath(new URL(`../apps/web/public/outlines/${key}.geojson`, import.meta.url));

/** The polygons (type 5) of a shapefile, each a list of rings. */
export function shapefileRings(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 100 || view.getInt32(0, false) !== 9994) {
    throw new Error('not a shapefile');
  }
  if (view.getInt32(32, true) !== 5) throw new Error('not a shapefile of polygons');
  const shapes = [];
  let at = 100;
  while (at + 8 <= bytes.byteLength) {
    const length = view.getInt32(at + 4, false) * 2;
    const s = at + 8;
    at = s + length;
    if (view.getInt32(s, true) !== 5) {
      shapes.push(null);
      continue;
    }
    const count = view.getInt32(s + 36, true);
    const points = view.getInt32(s + 40, true);
    const first = s + 44 + 4 * count;
    const rings = [];
    for (let p = 0; p < count; p += 1) {
      const from = view.getInt32(s + 44 + 4 * p, true);
      const to = p + 1 < count ? view.getInt32(s + 48 + 4 * p, true) : points;
      const ring = [];
      for (let i = from; i < to; i += 1) {
        ring.push([
          view.getFloat64(first + 16 * i, true),
          view.getFloat64(first + 16 * i + 8, true),
        ]);
      }
      rings.push(ring);
    }
    shapes.push(rings);
  }
  return shapes;
}

/** Twice the signed area: negative for a clockwise ring, an outer ring in a shapefile. */
const signedArea = (ring) => {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum;
};

const inside = ([x, y], ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** The rings as polygons: each outer ring with the holes that lie in it. */
export function polygonsOf(rings) {
  const polygons = [];
  const holes = [];
  for (const ring of rings) {
    if (signedArea(ring) < 0) polygons.push([ring]);
    else holes.push(ring);
  }
  for (const hole of holes) {
    const home = polygons.find((polygon) => inside(hole[0], polygon[0]));
    if (home) home.push(hole);
    else polygons.push([hole]);
  }
  return polygons;
}

const round = (n) => Math.round(n * 1e4) / 1e4;

/** A point of web-map coordinates (EPSG:3857, metres) as longitude and latitude. */
export function fromWebMercator([x, y]) {
  const R = 6378137;
  return [
    (x / R) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
  ];
}

/** A zone's outline of the 3D model as its file is written: its `Zone` code, longitude and latitude. */
export function modelOutline(code, rings) {
  return {
    type: 'FeatureCollection',
    name: `Extent_Top_${code}_v4`,
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    xy_coordinate_resolution: 0.0001,
    features: [
      {
        type: 'Feature',
        properties: { Zone: code },
        geometry: {
          type: 'MultiPolygon',
          coordinates: polygonsOf(rings).map((polygon) =>
            polygon.map((ring) => ring.map((point) => fromWebMercator(point).map(round))),
          ),
        },
      },
    ],
  };
}

/** The model's zones: each `<dir>/<code>/Extent_Top_<code>_v4_wgs84.shp`, in web-map coordinates. */
function buildModel(dir) {
  for (const outline of FORMATION_OUTLINES.filter((f) => f.source === 'model')) {
    const base = `${dir}/${outline.unit}/Extent_Top_${outline.unit}_v4_wgs84`;
    if (!readFileSync(`${base}.prj`, 'utf8').includes('Web_Mercator')) {
      throw new Error(`${outline.unit}: not in web-map coordinates`);
    }
    const rings = shapefileRings(new Uint8Array(readFileSync(`${base}.shp`))).flatMap(
      (shape) => shape ?? [],
    );
    writeFileSync(OUT(outline.key), `${JSON.stringify(modelOutline(outline.unit, rings))}\n`);
    console.log(`${outline.key}: ${String(rings.length)} rings`);
  }
}

function main([shp, dbf]) {
  if (shp === '--model' && dbf) {
    buildModel(dbf);
    return;
  }
  if (!shp || !dbf) {
    console.error(
      'usage: build-formation-outlines.js <outlines.shp> <outlines.dbf> | --model <zones dir>',
    );
    process.exit(2);
  }
  const shapes = shapefileRings(new Uint8Array(readFileSync(shp)));
  const table = dbaseTable(new Uint8Array(readFileSync(dbf)));
  for (let n = 0; n < table.count; n += 1) {
    const record = table.record(n);
    const rings = shapes[n];
    if (!record || !rings) continue;
    const outline = FORMATION_OUTLINES.find(
      (f) => f.source === 'shale-report' && f.unit === record.Shale_Unit,
    );
    if (!outline) throw new Error(`a unit not on the list: ${record.Shale_Unit}`);
    const collection = {
      type: 'FeatureCollection',
      name: 'shalegas_fms_py_ll',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      xy_coordinate_resolution: 0.0001,
      features: [
        {
          type: 'Feature',
          properties: {
            Shale_Unit: record.Shale_Unit,
            Figure_Ref: record.Figure_Ref,
            Report_Ref: record.Report_Ref,
          },
          geometry: {
            type: 'MultiPolygon',
            coordinates: polygonsOf(rings).map((polygon) =>
              polygon.map((ring) => ring.map(([x, y]) => [round(x), round(y)])),
            ),
          },
        },
      ],
    };
    writeFileSync(OUT(outline.key), `${JSON.stringify(collection)}\n`);
    console.log(`${outline.key}: ${String(rings.length)} rings`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
