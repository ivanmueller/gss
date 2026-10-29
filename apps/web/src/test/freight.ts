import type { FreightDetail, FreightRevision } from '@grain/domain';

// Synthetic freight rates for the web tests; not real carrier rates.

export const FREIGHT_ID = '00000000-0000-4000-8000-00000000e001';
export const CARRIER_ID = '00000000-0000-4000-8000-00000000d001';

export const FREIGHT_REVISION_1: FreightRevision = {
  id: '00000000-0000-4000-8000-0000000000f1',
  revisionNumber: 1,
  firmness: 'firm',
  rate: '4200.00',
  currency: 'USD',
  rateUnit: 'LOAD',
  payload: '90.500',
  payloadUnit: 'MT',
  inclusions: 'Fuel surcharge included',
  quotedAt: '2026-10-29T14:00:00.000Z',
  validUntil: '2099-11-05T22:00:00.000Z',
  sourceType: 'email',
  sourceReference: 'Synthetic dispatch email',
  notes: 'Line one\nLine two',
  recordedByName: 'Olivia Operations',
  recordedAt: '2026-10-29T14:01:00.000Z',
};

export const FREIGHT_REVISION_2: FreightRevision = {
  ...FREIGHT_REVISION_1,
  id: '00000000-0000-4000-8000-0000000000f2',
  revisionNumber: 2,
  firmness: 'indicative',
  rate: '105.00',
  currency: 'CAD',
  rateUnit: 'MT',
  payload: null,
  payloadUnit: null,
  inclusions: null,
  notes: null,
  recordedByName: 'Tess Trader',
  recordedAt: '2026-10-29T15:00:00.000Z',
};

export const FREIGHT: FreightDetail = {
  id: FREIGHT_ID,
  mode: 'rail',
  carrier: { id: CARRIER_ID, legalName: 'Synthetic Carrier', tradingName: null, archived: false },
  origin: {
    id: '00000000-0000-4000-8000-000000000f02',
    name: 'Synthetic Elevator',
    city: 'Synthetic City',
    region: 'SK',
    country: 'CA',
    counterparty: {
      id: '00000000-0000-4000-8000-00000000c002',
      legalName: 'Synthetic Seller',
      archived: false,
    },
  },
  destination: {
    id: '00000000-0000-4000-8000-000000000f01',
    name: 'Synthetic Mill',
    city: 'Synthetic Town',
    region: 'MN',
    country: 'US',
    counterparty: {
      id: '00000000-0000-4000-8000-00000000c001',
      legalName: 'Synthetic Buyer',
      archived: false,
    },
  },
  status: 'indicative',
  withdrawnAt: null,
  createdAt: '2026-10-29T14:00:00.000Z',
  current: FREIGHT_REVISION_2,
  revisions: [FREIGHT_REVISION_2, FREIGHT_REVISION_1],
  withdrawnByName: null,
};
