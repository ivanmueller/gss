import { z } from 'zod';

import { normalizeEmailAddress } from './emails';

// Forwarding addresses (F-233): each team member's own personal addresses (the owner's answer 2
// of 2026-11-13), confirmed by a code the platform emails to them. Mail forwarded from a confirmed
// address to GSS's domain is filed under the original sender's company (emailForward.ts).

/** At most this many live forwarding addresses per member (the database checks it too). */
export const FORWARDING_ADDRESSES_MAX = 5;
/** The code's digits. */
export const FORWARDING_CODE_DIGITS = 6;

/** One of the signed-in member's forwarding addresses. */
export interface ForwardingAddressView {
  id: string;
  address: string;
  /** UTC instant; null while waiting for its code. */
  confirmedAt: string | null;
  /** UTC instant until which the last code sent works; null when none is waiting. */
  codeExpiresAt: string | null;
  createdAt: string;
}

export const addForwardingAddressSchema = z.strictObject({
  address: z
    .string()
    .max(254)
    .transform((value, context) => {
      const address = normalizeEmailAddress(value);
      if (address === null) {
        context.addIssue({ code: 'custom', message: 'Enter one email address.' });
        return z.NEVER;
      }
      return address;
    }),
});

export const confirmForwardingAddressSchema = z.strictObject({
  code: z
    .string()
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(z.string().regex(new RegExp(`^[0-9]{${String(FORWARDING_CODE_DIGITS)}}$`))),
});
