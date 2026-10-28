import type { QuoteDetail, QuoteRevision } from '@grain/domain';

// Synthetic bids and offers for the web tests; not market prices.

export const QUOTE_ID = '00000000-0000-4000-8000-00000000a001';
export const COUNTERPARTY_ID = '00000000-0000-4000-8000-00000000c001';

export const REVISION_1: QuoteRevision = {
  id: '00000000-0000-4000-8000-0000000000e1',
  revisionNumber: 1,
  firmness: 'firm',
  price: '725.00',
  currency: 'USD',
  priceUnit: 'MT',
  grade: 'No. 1 CW',
  deliveryBasis: 'delivered',
  basisLocation: 'Synthetic Town, MN',
  quantityMinMt: '21.000',
  quantityMaxMt: '84.500',
  deliveryStart: '2026-11-01',
  deliveryEnd: '2026-11-30',
  quotedAt: '2026-10-28T14:00:00.000Z',
  validUntil: '2099-10-30T22:00:00.000Z',
  sourceType: 'phone',
  sourceReference: 'Synthetic call',
  notes: 'Line one\nLine two',
  recordedByName: 'Tess Trader',
  recordedAt: '2026-10-28T14:01:00.000Z',
};

export const REVISION_2: QuoteRevision = {
  ...REVISION_1,
  id: '00000000-0000-4000-8000-0000000000e2',
  revisionNumber: 2,
  firmness: 'indicative',
  price: '730.50',
  quantityMinMt: null,
  recordedByName: 'Adam Admin',
  recordedAt: '2026-10-28T16:00:00.000Z',
};

export const BID: QuoteDetail = {
  id: QUOTE_ID,
  side: 'bid',
  commodity: { code: 'flaxseed', name: 'Flaxseed' },
  counterparty: {
    id: COUNTERPARTY_ID,
    legalName: 'Synthetic Buyer',
    tradingName: null,
    archived: false,
  },
  facility: {
    id: '00000000-0000-4000-8000-000000000f01',
    name: 'Synthetic Mill',
    city: 'Synthetic Town',
    region: 'MN',
    country: 'US',
  },
  status: 'indicative',
  withdrawnAt: null,
  createdAt: '2026-10-28T14:01:00.000Z',
  current: REVISION_2,
  revisions: [REVISION_2, REVISION_1],
  withdrawnByName: null,
};

export const OFFER: QuoteDetail = {
  ...BID,
  id: '00000000-0000-4000-8000-00000000a002',
  side: 'offer',
  commodity: { code: 'canola', name: 'Canola' },
  counterparty: {
    ...BID.counterparty,
    id: '00000000-0000-4000-8000-00000000c002',
    legalName: 'Synthetic Seller',
  },
  facility: null,
  status: 'firm',
  current: { ...REVISION_1, currency: 'CAD', price: '15.25', priceUnit: 'BU', grade: null },
  revisions: [],
};
