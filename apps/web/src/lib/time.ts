import { albertaToUtc, utcToAlberta } from '@grain/domain';

// Times in forms: typed in Alberta time whatever the computer's time zone, sent as UTC
// instants (owner's decision, 2026-10-29).

/**
 * A datetime-local value, read as Alberta time, as a UTC instant for the API; empty stays
 * empty, and anything else is sent as typed, for the API to refuse with its message.
 */
export function albertaInputToRequest(local: string | undefined): string {
  if (!local) return '';
  return albertaToUtc(local) ?? local;
}

/** Now in Alberta time, as a datetime-local input shows it. */
export function albertaNowInput(now = new Date()): string {
  return utcToAlberta(now.toISOString());
}
