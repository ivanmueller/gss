import type { Facility, Quote } from '../data/types';

export function latestQuote(facility: Facility): Quote | undefined {
  return facility.quotes[0];
}

export function noQuoteText(facility: Facility): string {
  return facility.roles.includes('seller') ? 'No active offer' : 'No active bid';
}
