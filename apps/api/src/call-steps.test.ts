import { describe, expect, it } from 'vitest';

import { nextCallStep, secondsBetween, type CallEvent, type CallState } from './call-steps';

// Synthetic call legs and times only.
const STAFF = 'v3:staff-leg';
const THEM = 'v3:their-leg';
const AT = '2026-11-02T16:00:00.000Z';

function call(overrides: Partial<CallState> = {}): CallState {
  return {
    status: 'calling_you',
    outcome: null,
    staffCallControlId: STAFF,
    counterpartyCallControlId: null,
    connectedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function event(type: string, leg: 'you' | 'them', overrides: Partial<CallEvent> = {}): CallEvent {
  return {
    type,
    leg,
    occurredAt: AT,
    callControlId: leg === 'you' ? STAFF : THEM,
    digits: null,
    gatherStatus: null,
    hangupCause: null,
    ...overrides,
  };
}

describe('nextCallStep', () => {
  it('asks the caller to press 1 when their cell answers', () => {
    expect(nextCallStep(call(), event('call.answered', 'you'))).toEqual({
      changes: { status: 'confirming', staffAnsweredAt: AT },
      commands: [{ kind: 'confirm', callControlId: STAFF }],
    });
  });

  it("records the caller's leg from the event when the dial response was not saved yet", () => {
    const step = nextCallStep(call({ staffCallControlId: null }), event('call.answered', 'you'));
    expect(step.changes.staffCallControlId).toBe(STAFF);
    expect(step.commands).toEqual([{ kind: 'confirm', callControlId: STAFF }]);
  });

  it('dials them when 1 is pressed', () => {
    const step = nextCallStep(
      call({ status: 'confirming' }),
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    expect(step).toEqual({
      changes: { status: 'calling_them' },
      commands: [{ kind: 'dial_them', staffCallControlId: STAFF }],
    });
  });

  it('never calls them when 1 is not pressed (a voicemail, a timeout)', () => {
    for (const gather of [
      { digits: null, gatherStatus: 'timeout' },
      { digits: '2', gatherStatus: 'invalid' },
      { digits: null, gatherStatus: 'call_hangup' },
    ]) {
      const step = nextCallStep(
        call({ status: 'confirming' }),
        event('call.gather.ended', 'you', gather),
      );
      expect(step.changes).toMatchObject({
        status: 'ended',
        outcome: 'not_confirmed',
        endedAt: AT,
      });
      expect(step.commands).toEqual([{ kind: 'hang_up', callControlId: STAFF }]);
    }
  });

  it('connects when they answer', () => {
    const step = nextCallStep(call({ status: 'calling_them' }), event('call.answered', 'them'));
    expect(step).toEqual({
      changes: { status: 'connected', connectedAt: AT, counterpartyCallControlId: THEM },
      commands: [],
    });
  });

  it('ends as talked when either side hangs up, hanging up the other', () => {
    const connected = call({
      status: 'connected',
      counterpartyCallControlId: THEM,
      connectedAt: '2026-11-02T15:54:00.000Z',
    });
    expect(
      nextCallStep(connected, event('call.hangup', 'them', { hangupCause: 'normal_clearing' })),
    ).toEqual({
      changes: { status: 'ended', outcome: 'talked', endedAt: AT, hangupCause: 'normal_clearing' },
      commands: [{ kind: 'hang_up', callControlId: STAFF }],
    });
    expect(
      nextCallStep(connected, event('call.hangup', 'you', { hangupCause: 'normal_clearing' })),
    ).toEqual({
      changes: { status: 'ended', outcome: 'talked', endedAt: AT, hangupCause: 'normal_clearing' },
      commands: [{ kind: 'hang_up', callControlId: THEM }],
    });
  });

  it('says why a call to them did not connect', () => {
    const ringing = call({ status: 'calling_them', counterpartyCallControlId: THEM });
    const outcome = (hangupCause: string) =>
      nextCallStep(ringing, event('call.hangup', 'them', { hangupCause })).changes.outcome;
    expect(outcome('user_busy')).toBe('busy');
    expect(outcome('timeout')).toBe('no_answer');
    expect(outcome('call_rejected')).toBe('no_answer');
    expect(outcome('normal_clearing')).toBe('no_answer');
    expect(outcome('originator_cancel')).toBe('cancelled');
    expect(outcome('not_found')).toBe('failed');
    expect(nextCallStep(ringing, event('call.hangup', 'them')).commands).toEqual([
      { kind: 'hang_up', callControlId: STAFF },
    ]);
  });

  it("ends when the caller's cell is not answered or hangs up before them", () => {
    expect(
      nextCallStep(call(), event('call.hangup', 'you', { hangupCause: 'timeout' })).changes,
    ).toMatchObject({ status: 'ended', outcome: 'you_missed', hangupCause: 'timeout' });
    expect(
      nextCallStep(call(), event('call.hangup', 'you', { hangupCause: 'not_found' })).changes
        .outcome,
    ).toBe('failed');
    expect(
      nextCallStep(call({ status: 'confirming' }), event('call.hangup', 'you')).changes.outcome,
    ).toBe('not_confirmed');
    expect(
      nextCallStep(
        call({ status: 'calling_them', counterpartyCallControlId: THEM }),
        event('call.hangup', 'you', { hangupCause: 'normal_clearing' }),
      ),
    ).toEqual({
      changes: {
        status: 'ended',
        outcome: 'cancelled',
        endedAt: AT,
        hangupCause: 'normal_clearing',
      },
      commands: [{ kind: 'hang_up', callControlId: THEM }],
    });
  });

  it('changes nothing for an event out of turn', () => {
    const none = { changes: {}, commands: [] };
    expect(nextCallStep(call({ status: 'connected' }), event('call.answered', 'you'))).toEqual(
      none,
    );
    expect(
      nextCallStep(
        call(),
        event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
      ),
    ).toEqual(none);
    expect(nextCallStep(call(), event('call.answered', 'them'))).toEqual({
      changes: { counterpartyCallControlId: THEM },
      commands: [],
    });
    expect(nextCallStep(call(), event('call.bridged', 'you'))).toEqual(none);
  });

  it('keeps a hangup cause only when it is a plain word', () => {
    const step = nextCallStep(
      call(),
      event('call.hangup', 'you', { hangupCause: 'timeout; drop table' }),
    );
    expect(step.changes.hangupCause).toBeUndefined();
    expect(step.changes.outcome).toBe('failed');
  });
});

describe('nextCallStep after the call ended (events out of order)', () => {
  const ENDED = '2026-11-02T16:05:00.000Z';
  const ended = (overrides: Partial<CallState> = {}) =>
    call({
      status: 'ended',
      outcome: 'no_answer',
      counterpartyCallControlId: THEM,
      endedAt: ENDED,
      ...overrides,
    });

  it('makes it talked when their answer, from before the end, arrives late', () => {
    // Codex's review of ivanmueller/gss#107, finding 3: the hangup at T2 came before the
    // answer at T1.
    const answered = event('call.answered', 'them', { occurredAt: '2026-11-02T16:01:00.000Z' });
    expect(nextCallStep(ended(), answered)).toEqual({
      changes: { outcome: 'talked', connectedAt: '2026-11-02T16:01:00.000Z' },
      commands: [{ kind: 'hang_up', callControlId: THEM }],
    });
    expect(nextCallStep(ended({ outcome: 'cancelled' }), answered).changes).toEqual({
      outcome: 'talked',
      connectedAt: '2026-11-02T16:01:00.000Z',
    });
    // Codex's re-review of ivanmueller/gss#108, finding 6: never for a call whose counterparty
    // was not dialed, nor from a leg the call does not know.
    expect(nextCallStep(ended({ outcome: 'you_missed' }), answered).changes).toEqual({});
    expect(nextCallStep(ended({ outcome: 'not_confirmed' }), answered).changes).toEqual({});
    expect(nextCallStep(ended({ counterpartyCallControlId: null }), answered)).toEqual({
      changes: {},
      commands: [{ kind: 'hang_up', callControlId: THEM }],
    });
    expect(
      nextCallStep(ended({ counterpartyCallControlId: 'v3:other' }), answered).changes,
    ).toEqual({});
  });

  it('hangs up a leg that answers or starts after the end', () => {
    expect(
      nextCallStep(ended(), event('call.answered', 'them', { occurredAt: '2026-11-02T16:06:00Z' })),
    ).toEqual({ changes: {}, commands: [{ kind: 'hang_up', callControlId: THEM }] });
    expect(nextCallStep(ended(), event('call.initiated', 'them'))).toEqual({
      changes: {},
      commands: [{ kind: 'hang_up', callControlId: THEM }],
    });
    expect(nextCallStep(ended(), event('call.answered', 'you'))).toEqual({
      changes: {},
      commands: [{ kind: 'hang_up', callControlId: STAFF }],
    });
  });

  it('leaves a talked call as it is, and ignores late hangups and gathers', () => {
    const none = { changes: {}, commands: [] };
    const talked = ended({ outcome: 'talked', connectedAt: '2026-11-02T16:01:00.000Z' });
    expect(
      nextCallStep(talked, event('call.answered', 'them', { occurredAt: '2026-11-02T16:01:00Z' }))
        .changes,
    ).toEqual({});
    expect(nextCallStep(ended(), event('call.hangup', 'you'))).toEqual(none);
    expect(nextCallStep(ended(), event('call.gather.ended', 'you', { digits: '1' }))).toEqual(none);
  });
});

describe('secondsBetween', () => {
  it('counts seconds, never below zero', () => {
    expect(secondsBetween('2026-11-02T15:54:00Z', '2026-11-02T16:00:12Z')).toBe(372);
    expect(secondsBetween('2026-11-02T16:00:12Z', '2026-11-02T15:54:00Z')).toBe(0);
  });
});
