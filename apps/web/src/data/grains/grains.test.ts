import { COMMODITIES } from '@grain/domain';
import { describe, expect, it } from 'vitest';

import { GRAINS, GRAIN_FAMILIES, GRAIN_SOURCES } from '.';
import type { Citation, GrainTable } from './types';

// The reference's own consistency. Whether each value matches its source is checked against
// the downloaded sources before a change (the PR says how); these keep the shape sound.

const tables = GRAINS.flatMap((grain) => [
  ...grain.tables.map((table) => ({ grain, table })),
  ...grain.classes.flatMap((grainClass) =>
    (grainClass.tables ?? []).map((table) => ({ grain, table })),
  ),
]);

function citations(): { grain: string; citation: Citation }[] {
  return GRAINS.flatMap((grain) => [
    ...grain.facts,
    ...grain.tables,
    ...grain.classes.flatMap((grainClass) => [
      ...(grainClass.facts ?? []),
      ...(grainClass.tables ?? []),
      ...(grainClass.gradesCitation ? [grainClass.gradesCitation] : []),
      ...(grainClass.varietiesCitation ? [grainClass.varietiesCitation] : []),
    ]),
  ].map((citation) => ({ grain: grain.id, citation })));
}

describe('the grains reference', () => {
  it('numbers the grains 1 to n with distinct ids, symbols and addresses', () => {
    expect(GRAINS.map((grain) => grain.number)).toEqual(GRAINS.map((_, index) => index + 1));
    expect(new Set(GRAINS.map((grain) => grain.id)).size).toBe(GRAINS.length);
    expect(new Set(GRAINS.map((grain) => grain.symbol)).size).toBe(GRAINS.length);
    for (const grain of GRAINS) expect(grain.id).toMatch(/^[a-z][a-z-]*$/);
  });

  it('puts every grain in a known family', () => {
    const families = GRAIN_FAMILIES.map((entry) => entry.family);
    for (const grain of GRAINS) expect(families).toContain(grain.family);
  });

  it('links each of GSS’s commodities to exactly one grain', () => {
    for (const { code } of COMMODITIES) {
      const owners = GRAINS.filter((grain) => (grain.commodities as string[]).includes(code));
      expect(owners.map((grain) => grain.id), code).toHaveLength(1);
    }
  });

  it('cites a known source, and where in it, for every fact and table', () => {
    for (const { grain, citation } of citations()) {
      expect(Object.keys(GRAIN_SOURCES), grain).toContain(citation.source);
      expect(citation.where.trim(), `${grain}: ${citation.source}`).not.toBe('');
    }
  });

  it('gives grades and varieties their citations', () => {
    for (const grain of GRAINS) {
      for (const grainClass of grain.classes) {
        if (grainClass.grades) expect(grainClass.gradesCitation, grainClass.name).toBeDefined();
        if (grainClass.varieties)
          expect(grainClass.varietiesCitation, grainClass.name).toBeDefined();
      }
    }
  });

  it('fills every table row to its columns, with no empty cells', () => {
    const check = ({ grain, table }: { grain: { id: string }; table: GrainTable }) => {
      expect(table.columns.length, `${grain.id}: ${table.title}`).toBeGreaterThan(0);
      for (const row of table.rows) {
        expect(row, `${grain.id}: ${table.title}`).toHaveLength(table.columns.length);
        for (const cell of row) expect(cell.trim(), `${grain.id}: ${table.title}`).not.toBe('');
      }
    };
    tables.forEach(check);
  });

  it('shows on each tile only facts the grain has', () => {
    for (const grain of GRAINS) {
      for (const label of grain.tileFacts ?? []) {
        expect(
          grain.facts.map((fact) => fact.label),
          grain.id,
        ).toContain(label);
      }
    }
  });

  it('dates every source’s check', () => {
    for (const source of Object.values(GRAIN_SOURCES)) {
      expect(source.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.url).toMatch(/^https:\/\//);
    }
  });
});
