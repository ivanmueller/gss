import type { QuoteSummary } from '@grain/domain';
import { describe, expect, it } from 'vitest';

import { BID, OFFER } from '../test/quotes';
import { quotedCommodities, quotesToFacilities } from './workspaceQuotes';

const NO_PLACE: QuoteSummary = {
  ...OFFER,
  id: 'q-no-place',
  counterparty: { ...OFFER.counterparty },
  current: { ...OFFER.current, basisLocation: 'Synthetic Port, BC' },
};

describe('quotesToFacilities', () => {
  it('turns a bid at a located place into a pinned buyer, keeping the terms as recorded', () => {
    const [facility] = quotesToFacilities([BID]);
    expect(facility).toMatchObject({
      id: BID.facility?.id,
      name: 'Synthetic Buyer',
      roles: ['buyer'],
      region: 'MN',
      country: 'US',
      latitude: 44.977753,
      longitude: -93.265011,
      locationPrecision: 'approximate',
      href: `/counterparties/${BID.counterparty.id}`,
      commodities: ['Flaxseed'],
    });
    expect(facility?.quotes).toEqual([
      {
        id: BID.id,
        side: 'BID',
        commodity: 'Flaxseed',
        grade: 'No. 1 CW',
        price: { amount: '730.50', currency: 'USD', unit: 'MT' },
        deliveryBasis: 'Delivered',
        status: 'indicative',
        source: 'Phone call',
        revision: 2,
        href: `/quotes/${BID.id}`,
        quotedAt: '2026-10-28T14:00:00.000Z',
        validUntil: '2099-10-30T22:00:00.000Z',
        deliveryWindow: { start: '2026-11-01', end: '2026-11-30' },
        quantityMt: { min: null, max: '84.500' },
      },
    ]);
  });

  it('groups quotes without a place under their counterparty, with no pin', () => {
    const second = { ...NO_PLACE, id: 'q-second', side: 'bid' as const };
    const facilities = quotesToFacilities([NO_PLACE, second]);
    expect(facilities).toHaveLength(1);
    expect(facilities[0]).toMatchObject({
      id: `counterparty:${OFFER.counterparty.id}`,
      region: 'Synthetic Port, BC',
      country: '',
      latitude: null,
      longitude: null,
      locationPrecision: null,
      roles: ['seller', 'buyer'],
    });
    expect(facilities[0]?.quotes.map((quote) => quote.id)).toEqual(['q-no-place', 'q-second']);
  });

  it('gives no pin to a location without coordinates', () => {
    const [facility] = quotesToFacilities([
      {
        ...BID,
        facility: {
          id: 'f',
          name: null,
          city: 'Synthetic',
          region: null,
          country: 'CA',
          latitude: null,
          longitude: null,
          locationPrecision: null,
        },
      },
    ]);
    expect(facility).toMatchObject({
      region: 'Synthetic',
      latitude: null,
      locationPrecision: null,
    });
  });
});

describe('quotedCommodities', () => {
  it('lists the commodities with quotes, in the order of the full list', () => {
    const facilities = quotesToFacilities([BID, OFFER]);
    expect(quotedCommodities(facilities, ['Canola', 'Flaxseed', 'Oats'])).toEqual([
      'Canola',
      'Flaxseed',
    ]);
    expect(quotedCommodities(facilities, [])).toEqual(['Canola', 'Flaxseed']);
  });
});
