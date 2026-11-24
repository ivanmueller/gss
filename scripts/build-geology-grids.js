#!/usr/bin/env node
// Builds a formation's depth and thickness maps for the oil and gas map's Geology section
// (F-287 part 3, docs/FEATURES_OIL_GAS.md): apps/web/public/geology/<key>-grid.bin (both grids,
// gzipped, packages/domain/src/geologyGrid.ts) and <key>-depth.geojson and
// <key>-thickness.geojson (their contour lines). From the Alberta Geological Survey's
// Geological Framework of Alberta, Version 4: the zone's own package of its bulk download, of
// which only the grids "Depth_to_…" (metres from the ground to the zone's top) and
// "Vertical_Thickness_…" are used. Open data (Open Government Licence – Alberta), so the files
// are kept with the app, as the formation outlines are; the Survey is named under Sources &
// licence. Run again only if the Survey changes the model. For the Duvernay (zone 68), with
// Docker for GDAL:
//
//   B=https://aercclrsuatagsgispub01.blob.core.windows.net/arcgis-online/projects/GFA/Bulk_download
//   curl -o z.zip $B/68_D_Dv_Mu_v4_10tm.zip && unzip -j z.zip -d z && cd z
//   docker run --rm -v "$PWD:/data" -w /data ghcr.io/osgeo/gdal:alpine-small-3.10.0 sh -c '
//     for f in Depth_to Vertical_Thickness; do
//       gdalwarp -q -t_srs EPSG:3857 -tr 1770 1770 -tap -r average -ot Float32 \
//         -dstnodata -9999 ${f}_68_D_Dv_Mu_v4_10tm.tif $f.tif
//       gdal_translate -q -of ENVI $f.tif $f.bil
//     done
//     gdal_contour -q -a value -i 250 Depth_to.tif depth.gpkg
//     gdal_contour -q -a value -i 25 Vertical_Thickness.tif thickness.gpkg
//     for c in depth thickness; do
//       ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco COORDINATE_PRECISION=3 -lco RFC7946=YES \
//         $c.geojson $c.gpkg
//     done'
//   node --experimental-strip-types scripts/build-geology-grids.js duvernay z/Depth_to.bil \
//     z/Vertical_Thickness.bil z/depth.geojson z/thickness.geojson
//
// Squares of 1,770 m in web mercator are about 1 km on the ground in Alberta (the owner,
// 2026-11-24); each takes the average of the Survey's 280 m cells in it. Contour intervals are
// GEOLOGY_MAPS's.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  GEOLOGY_GRID_ABSENT,
  GEOLOGY_MAPS,
  encodeGeologyGrid,
} from '../packages/domain/src/geologyGrid.ts';

const OUT = (name) => fileURLToPath(new URL(`../apps/web/public/geology/${name}`, import.meta.url));
const NO_DATA = -9999;

export function usage() {
  return 'usage: build-geology-grids.js <key> <depth.bil> <thickness.bil> <depth.geojson> <thickness.geojson>';
}

/** An ENVI header's size and place: 32-bit floats, little-endian, web mercator. */
export function enviHeader(text) {
  const field = (name) => {
    const match = new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm').exec(text);
    if (!match) throw new Error(`The header has no "${name}".`);
    return match[1].trim();
  };
  if (field('data type') !== '4' || field('byte order') !== '0' || field('bands') !== '1') {
    throw new Error('Expected one band of little-endian 32-bit floats.');
  }
  const info = /^\{\s*([^,]+),([^}]*)\}$/.exec(field('map info'));
  if (!info || !/mercator/i.test(info[1])) throw new Error('Expected web mercator.');
  const [refX, refY, west, north, sizeX, sizeY] = info[2].split(',').map((n) => Number(n));
  if (refX !== 1 || refY !== 1 || sizeX !== sizeY || !(sizeX > 0)) {
    throw new Error('Expected square cells measured from the north-west corner.');
  }
  return {
    columns: Number(field('samples')),
    rows: Number(field('lines')),
    west,
    north,
    cell: sizeX,
  };
}

/** A grid of floats as 16-bit integers, each multiplied by `scale`; no data as absent. */
export function packValues(bytes, scale) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Int16Array(bytes.byteLength / 4);
  for (let i = 0; i < values.length; i += 1) {
    const value = view.getFloat32(i * 4, true);
    const absent = !Number.isFinite(value) || value <= NO_DATA + 1;
    const scaled = Math.round(value * scale);
    if (!absent && (scaled < -32767 || scaled > 32767)) {
      throw new Error(`A value (${String(value)}) does not fit the file.`);
    }
    values[i] = absent ? GEOLOGY_GRID_ABSENT : scaled;
  }
  return values;
}

/** The contour lines with only their value, in whole metres. */
export function contourLines(collection) {
  return {
    type: 'FeatureCollection',
    features: collection.features
      .filter((f) => f.geometry && /LineString$/.test(f.geometry.type))
      .map((f) => ({
        type: 'Feature',
        properties: { value: Math.round(Number(f.properties?.value)) },
        geometry: f.geometry,
      }))
      .filter((f) => Number.isFinite(f.properties.value)),
  };
}

function readGrid(path) {
  const header = enviHeader(readFileSync(path.replace(/\.bil$/, '.hdr'), 'utf8'));
  const bytes = readFileSync(path);
  if (bytes.byteLength !== header.columns * header.rows * 4) {
    throw new Error(`${path} is not the size its header gives.`);
  }
  return { header, bytes };
}

function main(argv) {
  const [key, depthPath, thicknessPath, depthLines, thicknessLines] = argv;
  if (!thicknessLines) throw new Error(usage());
  if (!GEOLOGY_MAPS.some((m) => m.key === key)) throw new Error(`No map is named ${key}.`);
  const depth = readGrid(depthPath);
  const thickness = readGrid(thicknessPath);
  if (JSON.stringify(depth.header) !== JSON.stringify(thickness.header)) {
    throw new Error('The depth and thickness grids do not line up.');
  }
  const grid = {
    ...depth.header,
    depth: packValues(depth.bytes, 1),
    thickness: packValues(thickness.bytes, 10),
  };
  const packed = gzipSync(encodeGeologyGrid(grid), { level: 9 });
  writeFileSync(OUT(`${key}-grid.bin`), packed);
  const present = grid.depth.filter((v) => v !== GEOLOGY_GRID_ABSENT).length;
  console.log(
    `${key}: ${String(grid.columns)} by ${String(grid.rows)} squares, ${String(present)} with a depth; ${String(Math.round(packed.byteLength / 1024))} kB`,
  );
  for (const [measure, path] of [
    ['depth', depthLines],
    ['thickness', thicknessLines],
  ]) {
    const lines = contourLines(JSON.parse(readFileSync(path, 'utf8')));
    const text = JSON.stringify(lines);
    writeFileSync(OUT(`${key}-${measure}.geojson`), `${text}\n`);
    console.log(
      `${measure}: ${String(lines.features.length)} lines, ${String(Math.round(text.length / 1024))} kB`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
