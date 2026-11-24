import { MAP_ASK_INSTRUCTIONS, MAP_ASK_JSON_SCHEMA } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAP_ASK_MODEL, ReadingDeadlineError, type ClaudeClient } from './anthropic';
import type { Database } from './db';
import { createApp } from './index';
import { ASK_PER_MINUTE, AskLimiter } from './map-ask';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Ask the map, read by Claude (F-254 part 2): members only, the fixed instructions and the typed
// words sent, the answer checked against the map's settings, names kept only as typed.

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let claude: { readCall: ReturnType<typeof vi.fn<ClaudeClient['readCall']>> };
let app = createApp(openDatabase);

const WITH_KEY = { ...ENV, ANTHROPIC_API_KEY: 'sk-ant-synthetic' };
const PATH = '/api/v1/petroleum/ask';
const ask = (text: unknown, env: Record<string, unknown> = WITH_KEY, path = PATH) =>
  app.request(
    path,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
    env,
  );

const read = (json: unknown) =>
  Promise.resolve({
    status: 'read' as const,
    json,
    model: MAP_ASK_MODEL,
    inputTokens: 3000,
    outputTokens: 200,
  });

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  claude = {
    readCall: vi.fn<ClaudeClient['readCall']>(() =>
      read({
        settings: { goTo: 'duvernay', wells: { on: true, spudFrom: 2020 }, open: 'wells' },
        reasons: [],
      }),
    ),
  };
  app = createApp(openDatabase, {
    claude: (env) => (env.ANTHROPIC_API_KEY ? claude : null),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
});

describe('POST /api/v1/petroleum/ask', () => {
  it('reads a member’s request with the fast model, the fixed instructions and the words only', async () => {
    const res = await ask('Duvernay wells drilled since 2020');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      settings: { goTo: 'duvernay', wells: { on: true, spudFrom: 2020 }, open: 'wells' },
      reasons: [],
    });
    expect(claude.readCall).toHaveBeenCalledTimes(1);
    expect(claude.readCall).toHaveBeenCalledWith({
      system: MAP_ASK_INSTRUCTIONS,
      user: 'Duvernay wells drilled since 2020',
      schema: MAP_ASK_JSON_SCHEMA,
      model: 'claude-haiku-5-5',
      effort: 'low',
      maxTokens: expect.any(Number) as number,
      deadlineMs: expect.any(Number) as number,
    });
    expect(db.memberships).toHaveBeenCalledWith(USER_ID);
  });

  it('drops a name that is not in the request', async () => {
    claude.readCall.mockReturnValueOnce(
      read({
        settings: {
          wells: { on: true, operator: 'Chevron Canada Limited' },
          rigs: { contractor: 'ensign' },
        },
        reasons: [],
      }),
    );
    const res = await ask('wells of chevron canada, rigs of Ensign');
    expect(await res.json()).toEqual({
      settings: { wells: { on: true }, rigs: { contractor: 'ensign' } },
      reasons: [],
    });
  });

  it('refuses an answer outside the map’s settings', async () => {
    for (const json of [
      { settings: { zoom: 5 }, reasons: [] },
      { settings: { wells: { statuses: ['flowing'] } }, reasons: [] },
      { settings: { wells: { spudFrom: 2024, spudTo: 2020 } }, reasons: [] },
      { settings: {}, reasons: ['weather'] },
      { settings: {} },
      'wells',
    ]) {
      claude.readCall.mockReturnValueOnce(read(json));
      const res = await ask('anything');
      expect(res.status, JSON.stringify(json)).toBe(502);
      expect(await res.json()).toMatchObject({ error: { code: 'CLAUDE_FAILED' } });
    }
  });

  it('says when Claude declined, failed, was too slow or is not set up', async () => {
    claude.readCall.mockResolvedValueOnce({ status: 'refused', model: MAP_ASK_MODEL });
    expect((await ask('wells')).status).toBe(502);
    claude.readCall.mockRejectedValueOnce(new Error('network'));
    expect((await ask('wells')).status).toBe(502);
    claude.readCall.mockRejectedValueOnce(new ReadingDeadlineError('late'));
    expect((await ask('wells')).status).toBe(504);
    const res = await ask('wells', ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'CLAUDE_NOT_CONFIGURED' } });
  });

  it('refuses an empty or long request, someone not a member and someone not signed in', async () => {
    expect((await ask('   ')).status).toBe(422);
    expect((await ask('x'.repeat(501))).status).toBe(422);
    expect((await ask(42)).status).toBe(422);
    db.memberships.mockResolvedValueOnce([]);
    expect((await ask('wells')).status).toBe(403);
    expect((await ask('wells', WITH_KEY, `${PATH}?organization_id=org-b`)).status).toBe(403);
    const anonymous = await app.request(
      PATH,
      { method: 'POST', body: JSON.stringify({ text: 'wells' }) },
      WITH_KEY,
    );
    expect(anonymous.status).toBe(401);
    expect(claude.readCall).not.toHaveBeenCalled();
  });

  it('stops a person after a dozen requests a minute', async () => {
    for (let i = 0; i < ASK_PER_MINUTE; i += 1) expect((await ask('wells')).status).toBe(200);
    const res = await ask('wells');
    expect(res.status).toBe(429);
    expect(claude.readCall).toHaveBeenCalledTimes(ASK_PER_MINUTE);
  });
});

describe('AskLimiter', () => {
  it('counts each person apart, over the last minute', () => {
    const limiter = new AskLimiter();
    for (let i = 0; i < ASK_PER_MINUTE; i += 1) expect(limiter.take('a', 1_000)).toBe(true);
    expect(limiter.take('a', 1_000)).toBe(false);
    expect(limiter.take('b', 1_000)).toBe(true);
    expect(limiter.take('a', 61_001)).toBe(true);
  });
});
