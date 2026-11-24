// Tests of scripts/load-formation-layers.js (F-261 part 2): the lattice around the wells, and
// the grids turned into one transaction that replaces the copy under the size guard. Made-up
// wells and grids only; the download and the cutting of the Survey's grids are tried by hand.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./load-formation-layers.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-formation-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });

// One well at a cell's own centre: column -7306, row 6043.
const wells = join(dir, 'wells.csv');
writeFileSync(wells, '-116.896,54.387,-116.896,54.387\nnot,a,well,line\n');
const URL_ = 'https://example.blob.core.windows.net/gfa/Modelled%20elevation%20surfaces.zip';

/** The lattice the script prints for the wells: its edges and its size. */
function lattice() {
  const result = run('lattice', wells);
  assert.equal(result.status, 0, result.stderr);
  const [west, south, east, north, columns, rows] = result.stdout.trim().split(' ').map(Number);
  return { west, south, east, north, columns, rows };
}

/** Writes the 180 grids: every cell the same, from the tops and bases given by zone. */
function writeGrids(into, cells, layers, change = () => undefined) {
  for (let zone = 1; zone <= 90; zone += 1) {
    const [top, base] = layers[zone] ?? [-9999, -9999];
    for (const [kind, value] of [
      ['top', top],
      ['base', base],
    ]) {
      const grid = new Float32Array(cells).fill(value);
      change(kind, zone, grid);
      writeFileSync(
        join(into, `${kind}_${String(zone).padStart(2, '0')}.bil`),
        new Uint8Array(grid.buffer),
      );
    }
  }
}

// Sealed, as the model's zones are: each base is the top of the layer beneath.
const LAYERS = {
  1: [840.6, 830.2],
  3: [830.2, -2252.1],
  68: [-2252.1, -2722.3],
  90: [-2722.3, -6000],
};

describe('load-formation-layers', () => {
  test('prints the lattice that holds the wells with 10 km about them', () => {
    const { west, south, east, north, columns, rows } = lattice();
    // About 1 km a cell: 10 km each way and the well's own cell, edges half a cell beyond.
    assert.equal(columns, 21);
    assert.equal(rows, 23);
    assert.ok(Math.abs(west - (-7306 - 10.5) * 0.016) < 1e-6);
    assert.ok(Math.abs(east - (-7306 + 10.5) * 0.016) < 1e-6);
    assert.ok(Math.abs(south - (6043 - 11.5) * 0.009) < 1e-6);
    assert.ok(Math.abs(north - (6043 + 11.5) * 0.009) < 1e-6);
  });

  test('keeps the cells within 10 km, each zone in whole metres, absent zones empty', () => {
    const { columns, rows } = lattice();
    const grids = join(dir, 'grids');
    mkdirSync(grids);
    writeGrids(grids, columns * rows, LAYERS);
    const result = run('load', grids, wells, URL_, '2026-11-02', '1000');
    assert.equal(result.status, 0, result.stderr);
    const sql = result.stdout;
    const rowsOut = sql.split('\n').filter((line) => /^-?\d+,\d+,"\{/.test(line));
    // A disc of 10 km on a lattice of about 1 km: some 300 cells, never the corners.
    assert.ok(rowsOut.length > 250 && rowsOut.length < columns * rows, String(rowsOut.length));
    assert.match(
      result.stderr,
      new RegExp(`${String(rowsOut.length)} cells within 10 km of 1 wells`),
    );
    assert.match(result.stderr, / 0 cells whose layers do not stack exactly/);
    // The well's own cell, with its four layers in whole metres and nothing between.
    const own = rowsOut.find((line) => line.startsWith('-7306,6043,'));
    assert.ok(own);
    const [tops, bases] = [...own.matchAll(/"\{([^}]*)\}"/g)].map((m) => m[1].split(','));
    assert.equal(tops.length, 90);
    assert.equal(bases.length, 90);
    assert.deepEqual([tops[0], bases[0]], ['841', '830']);
    assert.deepEqual([tops[2], bases[2]], ['830', '-2252']);
    assert.deepEqual([tops[67], bases[67]], ['-2252', '-2722']);
    assert.deepEqual([tops[89], bases[89]], ['-2722', '-6000']);
    assert.equal(tops.filter((value) => value === 'NULL').length, 86);
    // One transaction: the copy emptied, the load recorded, the size guard inside it.
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;/);
    assert.ok(
      sql.indexOf('truncate petro.formation_cells;') < sql.indexOf('copy petro.formation_cells'),
    );
    assert.match(
      sql,
      /values \('https:\/\/example\.blob\.core\.windows\.net\/gfa\/Modelled%20elevation%20surfaces\.zip', '2026-11-02'::date, 'Geological Framework of Alberta, Version 4', 0\.016, 0\.009, \d+\);/,
    );
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 471859200/);
    assert.ok(sql.indexOf('raise exception') < sql.indexOf('commit;'));
  });

  test('counts a cell whose layers do not stack, and drops a zone with no thickness', () => {
    const { columns, rows } = lattice();
    const grids = join(dir, 'gap');
    mkdirSync(grids);
    const middle = 11 * columns + 10;
    writeGrids(grids, columns * rows, { ...LAYERS, 50: [100, 100] }, (kind, zone, grid) => {
      // In the well's own cell the third zone's base lies above the next layer's top.
      if (kind === 'base' && zone === 3) grid[middle] = -2000;
    });
    const result = run('load', grids, wells, URL_, '-', '0');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, / 1 cells whose layers do not stack exactly/);
    const own = result.stdout.split('\n').find((line) => line.startsWith('-7306,6043,'));
    const [tops] = [...own.matchAll(/"\{([^}]*)\}"/g)].map((m) => m[1].split(','));
    assert.equal(tops[49], 'NULL');
    assert.match(result.stdout, /values \('https:[^']+', null, /);
  });

  test('refuses a missing grid, a grid of the wrong size and bad arguments', () => {
    const { columns, rows } = lattice();
    const grids = join(dir, 'short');
    mkdirSync(grids);
    let result = run('load', grids, wells, URL_, '-', '0');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /top_01\.bil is missing/);
    writeGrids(grids, columns * rows - 1, LAYERS);
    result = run('load', grids, wells, URL_, '-', '0');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /holds \d+ bytes, not \d+/);
    assert.equal(run('load', grids, wells, 'http://example.test/x.zip', '-', '0').status, 2);
    assert.equal(run('load', grids, wells, URL_, 'yesterday', '0').status, 2);
    assert.equal(run('load', grids, wells, URL_, '-', '-5').status, 2);
    assert.equal(run().status, 2);
    // No well: nothing to build a lattice around.
    const none = join(dir, 'none.csv');
    writeFileSync(none, '');
    assert.equal(run('lattice', none).status, 1);
  });
});
