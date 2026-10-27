import type { Facility } from './types';

// SYNTHETIC DEMO DATA. Every facility and quote here is fictional. The two
// prices are the golden fixture from docs/TRADING_RULES.md, not market prices.
export const SYNTHETIC_FACILITIES: readonly Facility[] = [
  {
    id: 'fac-demo-seller-a',
    name: 'Demo Seller A',
    roles: ['seller'],
    region: 'Saskatchewan',
    country: 'CA',
    locationPrecision: 'approximate',
    quotes: [
      {
        id: 'quote-demo-offer-1',
        side: 'OFFER',
        commodity: 'Flaxseed',
        grade: 'No. 1 CW',
        price: { amount: '820.00', currency: 'CAD', unit: 'MT' },
        deliveryBasis: 'Ex-farm',
        status: 'indicative',
        sourceType: 'manual',
        revision: 1,
        quotedAt: '2026-10-26T15:00:00Z',
        validUntil: '2026-11-09T23:59:00Z',
        deliveryWindow: { start: '2026-11-15', end: '2026-12-15' },
        quantityMt: { min: '21.000', max: '42.000' },
      },
    ],
  },
  {
    id: 'fac-demo-seller-b',
    name: 'Demo Seller B',
    roles: ['seller'],
    region: 'Manitoba',
    country: 'CA',
    locationPrecision: 'approximate',
    quotes: [],
  },
  {
    id: 'fac-demo-buyer-c',
    name: 'Demo Buyer C',
    roles: ['buyer'],
    region: 'North Dakota',
    country: 'US',
    locationPrecision: 'exact',
    quotes: [
      {
        id: 'quote-demo-bid-1',
        side: 'BID',
        commodity: 'Flaxseed',
        grade: 'No. 1 CW',
        price: { amount: '725.00', currency: 'USD', unit: 'MT' },
        deliveryBasis: 'Delivered',
        status: 'indicative',
        sourceType: 'manual',
        revision: 1,
        quotedAt: '2026-10-26T16:30:00Z',
        validUntil: '2026-11-09T23:59:00Z',
        deliveryWindow: { start: '2026-11-15', end: '2026-12-31' },
        quantityMt: { min: '21.000', max: '84.000' },
      },
    ],
  },
  {
    id: 'fac-demo-buyer-d',
    name: 'Demo Buyer D',
    roles: ['buyer'],
    region: 'Minnesota',
    country: 'US',
    locationPrecision: 'exact',
    quotes: [],
  },
];
