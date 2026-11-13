import type { ForwardingAddressView } from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// Forwarding addresses in Postgres (20261118010000_email_forwarding.sql, F-233). Every write goes
// through the database's own functions, as the signed-in member, on their own rows only.

export type AddForwardingResult =
  | { status: 'added' | 'exists'; id: string; confirmed: boolean }
  | { status: 'invalid' | 'on_own_domain' | 'taken' | 'too_many' | 'forbidden' };

export type ReserveCodeResult =
  | { status: 'reserved'; sendId: string; address: string }
  | { status: 'too_soon' | 'too_many' | 'not_found' | 'already_confirmed' | 'forbidden' };

export type ConfirmForwardingResult = 'confirmed' | 'wrong' | 'expired' | 'not_found' | 'forbidden';

export interface ForwardingDatabase {
  myForwardingAddresses: (
    ctx: RequestContext,
    organizationId: string,
  ) => Promise<ForwardingAddressView[] | null>;
  addForwardingAddress: (
    ctx: RequestContext,
    organizationId: string,
    address: string,
    ownDomain: string,
  ) => Promise<AddForwardingResult>;
  /** Reserves a code email before it is sent (Codex's design review of F-233, D1-03). */
  reserveForwardingCode: (
    ctx: RequestContext,
    organizationId: string,
    addressId: string,
  ) => Promise<ReserveCodeResult>;
  /** After the send: the reservation marked sent and the code's hash kept. */
  finishForwardingCode: (
    ctx: RequestContext,
    organizationId: string,
    sendId: string,
    codeHash: string,
  ) => Promise<'done' | 'not_found'>;
  failForwardingCode: (
    ctx: RequestContext,
    organizationId: string,
    sendId: string,
  ) => Promise<'done' | 'not_found'>;
  confirmForwardingAddress: (
    ctx: RequestContext,
    organizationId: string,
    addressId: string,
    codeHash: string,
  ) => Promise<ConfirmForwardingResult>;
  removeForwardingAddress: (
    ctx: RequestContext,
    organizationId: string,
    addressId: string,
  ) => Promise<'done' | 'not_found'>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

const ADD_STATUSES = ['invalid', 'on_own_domain', 'taken', 'too_many', 'forbidden'] as const;
const RESERVE_STATUSES = [
  'too_soon',
  'too_many',
  'not_found',
  'already_confirmed',
  'forbidden',
] as const;
const CONFIRM_RESULTS: readonly ConfirmForwardingResult[] = [
  'confirmed',
  'wrong',
  'expired',
  'not_found',
  'forbidden',
];

function doneOrNotFound(value: unknown): 'done' | 'not_found' {
  if (value === 'done' || value === 'not_found') return value;
  throw new Error('Unexpected answer from the database');
}

export function forwardingQueries(asUser: AsUser): ForwardingDatabase {
  return {
    myForwardingAddresses(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ list: ForwardingAddressView[] | null }[]>`
          select app.my_forwarding_addresses(${organizationId}) as list`;
        const list = row?.list ?? null;
        return list === null
          ? null
          : list.map((item) => ({
              ...item,
              confirmedAt:
                item.confirmedAt === null ? null : new Date(item.confirmedAt).toISOString(),
              codeExpiresAt:
                item.codeExpiresAt === null ? null : new Date(item.codeExpiresAt).toISOString(),
              createdAt: new Date(item.createdAt).toISOString(),
            }));
      });
    },

    addForwardingAddress(ctx, organizationId, address, ownDomain) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<
          { result: { status?: unknown; id?: unknown; confirmed?: unknown } }[]
        >`
          select app.add_forwarding_address(${organizationId}, ${address}, ${ownDomain}) as result`;
        const result = row?.result ?? {};
        if (
          (result.status === 'added' || result.status === 'exists') &&
          typeof result.id === 'string'
        )
          return { status: result.status, id: result.id, confirmed: result.confirmed === true };
        const status = ADD_STATUSES.find((value) => value === result.status);
        if (status === undefined) throw new Error('Unexpected answer from add_forwarding_address');
        return { status };
      });
    },

    reserveForwardingCode(ctx, organizationId, addressId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<
          { result: { status?: unknown; sendId?: unknown; address?: unknown } }[]
        >`select app.reserve_forwarding_code(${organizationId}, ${addressId}) as result`;
        const result = row?.result ?? {};
        if (
          result.status === 'reserved' &&
          typeof result.sendId === 'string' &&
          typeof result.address === 'string'
        )
          return { status: 'reserved', sendId: result.sendId, address: result.address };
        const status = RESERVE_STATUSES.find((value) => value === result.status);
        if (status === undefined) throw new Error('Unexpected answer from reserve_forwarding_code');
        return { status };
      });
    },

    finishForwardingCode(ctx, organizationId, sendId, codeHash) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.finish_forwarding_code(${organizationId}, ${sendId}, ${codeHash}) as result`;
        return doneOrNotFound(row?.result);
      });
    },

    failForwardingCode(ctx, organizationId, sendId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.fail_forwarding_code(${organizationId}, ${sendId}) as result`;
        return doneOrNotFound(row?.result);
      });
    },

    confirmForwardingAddress(ctx, organizationId, addressId, codeHash) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.confirm_forwarding_address(${organizationId}, ${addressId}, ${codeHash})
            as result`;
        const result = CONFIRM_RESULTS.find((value) => value === row?.result);
        if (result === undefined)
          throw new Error('Unexpected answer from confirm_forwarding_address');
        return result;
      });
    },

    removeForwardingAddress(ctx, organizationId, addressId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.remove_forwarding_address(${organizationId}, ${addressId}) as result`;
        return doneOrNotFound(row?.result);
      });
    },
  };
}
