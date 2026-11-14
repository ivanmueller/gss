import type { OpenDraftView } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { FREIGHT } from '../test/freight';
import type { DraftPlace } from './ClaudeDrafts';
import { CounterpartyFreight } from './CounterpartyFreight';

// Claude's freight rate drafts on a company's Freight rates card (F-235 part 2). Synthetic values.
const COMPANY = '00000000-0000-4000-8000-00000000c001';

const DRAFT: OpenDraftView = {
  id: '00000000-0000-4000-8000-0000000dd0f1',
  kind: 'freight',
  counterpartyId: COMPANY,
  counterpartyName: 'Synthetic Buyer',
  source: 'call',
  callId: '00000000-0000-4000-8000-0000000ca111',
  emailId: null,
  emailSubject: null,
  calledAt: '2026-11-14T15:00:00.000Z',
  callerId: null,
  callerName: 'Tess Trader',
  contactName: 'Pat Buyer',
  contactId: null,
  fields: {
    mode: 'rail',
    origin: { text: 'Morris MB', region: 'CA-MB' },
    destination: { text: 'Lacrosse WI', region: 'US-WI' },
    values: {
      firmness: 'firm',
      rate: '182',
      currency: 'CAD',
      rateUnit: 'MT',
      quotedAt: '2026-11-14T15:00:00.000Z',
      sourceType: 'phone',
    },
    checks: {},
  },
  lines: [1],
  sourceLines: [{ line: 1, text: 'Morris MB to Lacrosse WI 182/CMT by rail' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CounterpartyFreight drafts', () => {
  it('shows drafts while the card is folded, and reloads the open list after Verify', async () => {
    let verified = false;
    const calls = mockApi({
      [`GET /freight-quotes?counterparty_id=${COMPANY}`]: () =>
        Response.json({ freight: verified ? [FREIGHT] : [], truncated: false }),
      [`POST /calls/drafts/${DRAFT.id}/verify`]: () => {
        verified = true;
        return Response.json({ verified: true, kind: 'freight', resultId: FREIGHT.id });
      },
    });
    const onChanged = vi.fn<DraftPlace['onChanged']>();
    render(
      <CounterpartyFreight
        session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }}
        counterparty={{ id: COMPANY, types: ['buyer'], archived: false, facilityCount: 0 }}
        folded
        drafts={[DRAFT]}
        place={{ session: SESSION, team: null, onChanged }}
      />,
    );
    // Folded: nothing loaded, but the draft is seen.
    const draft = screen.getByRole('listitem', {
      name: 'Drafted by Claude: Freight · Morris MB → Lacrosse WI',
    });
    expect(draft).toHaveTextContent('CAD 182/MT · Rail · no end date');
    expect(calls).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /Freight rates/ }));
    expect(await screen.findByText('No live freight rates.')).toBeInTheDocument();
    await userEvent.click(within(draft).getByRole('button', { name: 'Verify' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('Verified: freight rate saved.', 'freight');
    });
    expect(
      await screen.findByRole('table', {
        name: 'Freight rates it quoted, and to and from its locations',
      }),
    ).toBeInTheDocument();
  });
});
