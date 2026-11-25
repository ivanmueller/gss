// Tests of scripts/load-st37.js's pick step (F-300): one pool of one field takes the production
// strings of that field's pool only, as pool codes repeat from field to field. Made-up licences.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ST37_FORMATIONS } from '../packages/domain/src/st37.ts';
import { pick } from './load-st37.js';

const LICENCE_HEADER =
  'LicenceType,LicenceNumber,LicenceIssueDate,LicenceStatus,DrillingOperationType,ProjectedFormation,ProjectedTotalDepth';
const string = (licence, field, pool) => ({
  properties: { Well_Licence_Number: licence, Field_Code: field, Pool_Code: pool },
  geometry: null,
});

describe('load-st37.js pick', () => {
  test("one pool: its field's strings only, and no licence aimed at a formation", () => {
    const pool = ST37_FORMATIONS.stettler_nisku_a;
    const picked = pick(
      pool,
      [
        string('0999001', 866, 696001),
        // The same pool code in another field, another pool of the field.
        string('0999002', 123, 696001),
        string('0999003', 866, 696002),
        string('0999004', 866, 696001),
      ],
      `${LICENCE_HEADER}\nWELL,0999009,2026-11-19,ISSUED,Vertical,NISKU FM,1500\n`,
    );
    assert.equal(picked.csv, 'licence\n0999001\n0999004\n');
    assert.equal(picked.inPools, 2);
    assert.equal(picked.aimed, 0);
  });

  test('a formation: its pools in every field, as before', () => {
    const picked = pick(
      ST37_FORMATIONS.duvernay,
      [
        string('0999001', 866, 728001),
        string('0999002', 123, 728050),
        string('0999003', 1, 696001),
      ],
      `${LICENCE_HEADER}\n`,
    );
    assert.equal(picked.csv, 'licence\n0999001\n0999002\n');
  });
});
