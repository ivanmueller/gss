import { vi } from 'vitest';

import type { Database } from '../db';

// Shared by the API unit tests. Everything here is synthetic.

export const ENV = {
  SUPABASE_URL: 'https://example-project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  DATABASE_URL: 'postgresql://app_api.ref:secret@db.example.test:6543/postgres',
};
export const USER_ID = '00000000-0000-4000-8000-00000000a11c';

/** An unsigned token with the given claims; only Supabase Auth (mocked here) judges validity. */
export function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.signature`;
}

/** A signed-in user with two-factor authentication. */
export const VALID_TOKEN = token({ sub: USER_ID, aal: 'aal2' });

/** Answers every Supabase Auth call with a fresh copy of the response (or the error). */
export function mockAuthServer(response: Response | Error) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone()),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? ReturnType<typeof vi.fn<T[K]>>
    : never;
};

const saved = () => Promise.resolve({ status: 'saved' } as const);

/** A Database whose every method is a mock; reads return empty results and writes succeed by default. */
export function fakeDatabase(): Mocked<Database> {
  const db: Mocked<Database> = {
    memberships: vi.fn<Database['memberships']>(() =>
      Promise.resolve([
        { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'trader' },
      ]),
    ),
    canEditDirectory: vi.fn<Database['canEditDirectory']>(() => Promise.resolve(true)),
    listCounterparties: vi.fn<Database['listCounterparties']>(() => Promise.resolve([])),
    getCounterparty: vi.fn<Database['getCounterparty']>(() => Promise.resolve(null)),
    facilitiesInBbox: vi.fn<Database['facilitiesInBbox']>(() =>
      Promise.resolve({ facilities: [], withoutCoordinates: 0 }),
    ),
    facilitiesWithoutCoordinates: vi.fn<Database['facilitiesWithoutCoordinates']>(() =>
      Promise.resolve([]),
    ),
    saveCoordinates: vi.fn<Database['saveCoordinates']>(() => Promise.resolve([])),
    getLogo: vi.fn<Database['getLogo']>(() => Promise.resolve(null)),
    putLogo: vi.fn<Database['putLogo']>(() =>
      Promise.resolve({ status: 'saved', sha256: 'f'.repeat(64) }),
    ),
    existingCounterparties: vi.fn<Database['existingCounterparties']>(() => Promise.resolve([])),
    // Plans against existingCounterparties, as the real one does under its lock.
    importCounterparties: vi.fn<Database['importCounterparties']>(
      async (ctx, organizationId, plan, check) => {
        const batch = plan(await db.existingCounterparties(ctx, organizationId));
        await check?.(batch);
        if (batch === null) return null;
        return '00000000-0000-4000-8000-0000000ba7c4';
      },
    ),
    listMapLayers: vi.fn<Database['listMapLayers']>(() => Promise.resolve([])),
    getMapLayerSource: vi.fn<Database['getMapLayerSource']>(() => Promise.resolve(null)),
    getMapLayerFile: vi.fn<Database['getMapLayerFile']>(() => Promise.resolve(null)),
    createMapLayer: vi.fn<Database['createMapLayer']>(() =>
      Promise.resolve({ status: 'saved', id: '00000000-0000-4000-8000-0000000a1a01' }),
    ),
    updateMapLayer: vi.fn<Database['updateMapLayer']>(() =>
      Promise.resolve({ status: 'saved', id: '00000000-0000-4000-8000-0000000a1a01' }),
    ),
    removeMapLayer: vi.fn<Database['removeMapLayer']>(() =>
      Promise.resolve({ status: 'saved', id: '00000000-0000-4000-8000-0000000a1a01' }),
    ),
    getMapLayerOverview: vi.fn<Database['getMapLayerOverview']>(() => Promise.resolve(null)),
    saveMapLayerOverviewPart: vi.fn<Database['saveMapLayerOverviewPart']>(() =>
      Promise.resolve({ status: 'saved', id: '00000000-0000-4000-8000-0000000a1a01' }),
    ),
    publishMapLayerOverview: vi.fn<Database['publishMapLayerOverview']>(() =>
      Promise.resolve({ status: 'saved', id: '00000000-0000-4000-8000-0000000a1a01' }),
    ),
    isOrgAdmin: vi.fn<Database['isOrgAdmin']>(() => Promise.resolve(true)),
    setMemberNames: vi.fn<Database['setMemberNames']>(() => Promise.resolve(true)),
    listMembers: vi.fn<Database['listMembers']>(() => Promise.resolve([])),
    addMember: vi.fn<Database['addMember']>(() =>
      Promise.resolve({ status: 'added', id: '00000000-0000-4000-8000-00000000ae01' }),
    ),
    updateMember: vi.fn<Database['updateMember']>(() => saved()),
    createCounterparty: vi.fn<Database['createCounterparty']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000c0de' }),
    ),
    updateCounterparty: vi.fn<Database['updateCounterparty']>(() => saved()),
    setArchived: vi.fn<Database['setArchived']>(() => saved()),
    listImports: vi.fn<Database['listImports']>(() => Promise.resolve([])),
    undoImport: vi.fn<Database['undoImport']>(() => Promise.resolve({ status: 'not_found' })),
    deleteCounterparty: vi.fn<Database['deleteCounterparty']>(() =>
      Promise.resolve({ status: 'deleted' as const }),
    ),
    addContact: vi.fn<Database['addContact']>(() => saved()),
    updateContact: vi.fn<Database['updateContact']>(() => saved()),
    removeContact: vi.fn<Database['removeContact']>(() => saved()),
    setMainContact: vi.fn<Database['setMainContact']>(() => saved()),
    changeCommodities: vi.fn<Database['changeCommodities']>(() => saved()),
    changeLanes: vi.fn<Database['changeLanes']>(() => saved()),
    addFacility: vi.fn<Database['addFacility']>(() => saved()),
    updateFacility: vi.fn<Database['updateFacility']>(() => saved()),
    removeFacility: vi.fn<Database['removeFacility']>(() => saved()),
    listCommodities: vi.fn<Database['listCommodities']>(() => Promise.resolve([])),
    canEnterQuotes: vi.fn<Database['canEnterQuotes']>(() => Promise.resolve(true)),
    listQuotes: vi.fn<Database['listQuotes']>(() => Promise.resolve([])),
    getQuote: vi.fn<Database['getQuote']>(() => Promise.resolve(null)),
    createQuote: vi.fn<Database['createQuote']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000a001' }),
    ),
    reviseQuote: vi.fn<Database['reviseQuote']>(() => saved()),
    withdrawQuote: vi.fn<Database['withdrawQuote']>(() => saved()),
    listFreight: vi.fn<Database['listFreight']>(() => Promise.resolve([])),
    getFreight: vi.fn<Database['getFreight']>(() => Promise.resolve(null)),
    createFreight: vi.fn<Database['createFreight']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000e001' }),
    ),
    reviseFreight: vi.fn<Database['reviseFreight']>(() => saved()),
    withdrawFreight: vi.fn<Database['withdrawFreight']>(() => saved()),
    listContactLog: vi.fn<Database['listContactLog']>(() => Promise.resolve([])),
    getContactLogEntry: vi.fn<Database['getContactLogEntry']>(() => Promise.resolve(null)),
    createContactLog: vi.fn<Database['createContactLog']>(() =>
      Promise.resolve({
        status: 'created',
        id: '00000000-0000-4000-8000-00000000e101',
        followUpId: null,
      }),
    ),
    correctContactLog: vi.fn<Database['correctContactLog']>(() => saved()),
    listFollowUps: vi.fn<Database['listFollowUps']>(() => Promise.resolve([])),
    countFollowUps: vi.fn<Database['countFollowUps']>(() =>
      Promise.resolve({ overdue: 0, dueToday: 0 }),
    ),
    teamNames: vi.fn<Database['teamNames']>(() => Promise.resolve([])),
    getFollowUp: vi.fn<Database['getFollowUp']>(() => Promise.resolve(null)),
    createFollowUp: vi.fn<Database['createFollowUp']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000f101' }),
    ),
    updateFollowUp: vi.fn<Database['updateFollowUp']>(() => saved()),
    finishFollowUp: vi.fn<Database['finishFollowUp']>(() => saved()),
    removeFollowUp: vi.fn<Database['removeFollowUp']>(() => saved()),
    pinContactLog: vi.fn<Database['pinContactLog']>(() => saved()),
    removeContactLog: vi.fn<Database['removeContactLog']>(() => saved()),
    listFxQuotes: vi.fn<Database['listFxQuotes']>(() => Promise.resolve([])),
    storeBankOfCanadaRates: vi.fn<Database['storeBankOfCanadaRates']>((rates) =>
      Promise.resolve(rates.map((rate) => ({ rate, outcome: 'stored' as const }))),
    ),
    getMemberPhone: vi.fn<Database['getMemberPhone']>(() => Promise.resolve(null)),
    saveMemberPhone: vi.fn<Database['saveMemberPhone']>(() => Promise.resolve('saved')),
    placeCall: vi.fn<Database['placeCall']>(() =>
      Promise.resolve({
        status: 'created',
        callId: '00000000-0000-4000-8000-0000000ca11a',
        staffPhone: '+14035550142',
        counterpartyPhone: '+14035550100',
      }),
    ),
    getCall: vi.fn<Database['getCall']>(() => Promise.resolve(null)),
    recordLeg: vi.fn<Database['recordLeg']>(() => Promise.resolve()),
    failCall: vi.fn<Database['failCall']>(() => Promise.resolve()),
    callPlacer: vi.fn<Database['callPlacer']>(() => Promise.resolve(null)),
    applyCallEvent: vi.fn<Database['applyCallEvent']>(() =>
      Promise.resolve({ status: 'not_found' }),
    ),
    unsettledCommands: vi.fn<Database['unsettledCommands']>(() => Promise.resolve([])),
    callLegs: vi.fn<Database['callLegs']>(() => Promise.resolve([])),
    keepStrayLeg: vi.fn<Database['keepStrayLeg']>(() => Promise.resolve()),
    keepCallRecording: vi.fn<Database['keepCallRecording']>(() => Promise.resolve()),
    keepCallTranscript: vi.fn<Database['keepCallTranscript']>(() => Promise.resolve()),
    recordingsToDelete: vi.fn<Database['recordingsToDelete']>(() => Promise.resolve([])),
    claimRecordingsToTranscribe: vi.fn<Database['claimRecordingsToTranscribe']>(() =>
      Promise.resolve([]),
    ),
    keepTranscriptLines: vi.fn<Database['keepTranscriptLines']>(() => Promise.resolve()),
    markRecordingDeleted: vi.fn<Database['markRecordingDeleted']>(() => Promise.resolve()),
    listRecordings: vi.fn<Database['listRecordings']>(() => Promise.resolve([])),
    playableRecording: vi.fn<Database['playableRecording']>(() => Promise.resolve(null)),
    claimCommand: vi.fn<Database['claimCommand']>(() => Promise.resolve({ status: 'skipped' })),
    finishCommand: vi.fn<Database['finishCommand']>(() => Promise.resolve({ followUp: null })),
    claimCallReadings: vi.fn<Database['claimCallReadings']>(() => Promise.resolve([])),
    releaseCallReading: vi.fn<Database['releaseCallReading']>(() => Promise.resolve()),
    callReadingContext: vi.fn<Database['callReadingContext']>(() => Promise.resolve(null)),
    keepCallReading: vi.fn<Database['keepCallReading']>(() => Promise.resolve(true)),
    decideCallDraft: vi.fn<Database['decideCallDraft']>(() => Promise.resolve('decided')),
    listOpenDrafts: vi.fn<Database['listOpenDrafts']>(() => Promise.resolve([])),
    verifyCallDraft: vi.fn<Database['verifyCallDraft']>(() =>
      Promise.resolve({
        status: 'verified' as const,
        kind: 'follow_up' as const,
        resultId: '00000000-0000-4000-8000-000000000001',
      }),
    ),
    correctCallVoicemail: vi.fn<Database['correctCallVoicemail']>(() => Promise.resolve('saved')),
    claimCounterpartySummaries: vi.fn<Database['claimCounterpartySummaries']>(() =>
      Promise.resolve([]),
    ),
    releaseCounterpartySummary: vi.fn<Database['releaseCounterpartySummary']>(() =>
      Promise.resolve(),
    ),
    counterpartySummaryContext: vi.fn<Database['counterpartySummaryContext']>(() =>
      Promise.resolve(null),
    ),
    keepCounterpartySummary: vi.fn<Database['keepCounterpartySummary']>(() =>
      Promise.resolve(true),
    ),
    counterpartySummary: vi.fn<Database['counterpartySummary']>(() => Promise.resolve(null)),
    requestCounterpartySummary: vi.fn<Database['requestCounterpartySummary']>(() =>
      Promise.resolve('requested'),
    ),
    receiveCallback: vi.fn<Database['receiveCallback']>(() =>
      Promise.resolve({ status: 'not_ours' }),
    ),
    callbackByLeg: vi.fn<Database['callbackByLeg']>(() => Promise.resolve(null)),
    applyCallbackEvent: vi.fn<Database['applyCallbackEvent']>(() =>
      Promise.resolve({ status: 'applied', commands: [] }),
    ),
    claimCallbackCommand: vi.fn<Database['claimCallbackCommand']>(() =>
      Promise.resolve({ status: 'skipped' }),
    ),
    finishCallbackCommand: vi.fn<Database['finishCallbackCommand']>(() =>
      Promise.resolve({ commands: [], unresolved: false }),
    ),
    callbackOpenCommands: vi.fn<Database['callbackOpenCommands']>(() => Promise.resolve([])),
    keepCallbackRecording: vi.fn<Database['keepCallbackRecording']>(() => Promise.resolve(false)),
    settleLateCallbacks: vi.fn<Database['settleLateCallbacks']>(() => Promise.resolve(0)),
    getCallbackSettings: vi.fn<Database['getCallbackSettings']>(() => Promise.resolve(null)),
    saveCallbackSettings: vi.fn<Database['saveCallbackSettings']>(() => Promise.resolve('saved')),
    getEmailSettings: vi.fn<Database['getEmailSettings']>(() => Promise.resolve(null)),
    saveEmailSettings: vi.fn<Database['saveEmailSettings']>(() => Promise.resolve('saved')),
    saveMemberEmail: vi.fn<Database['saveMemberEmail']>(() => Promise.resolve('saved')),
    startOutgoingEmail: vi.fn<Database['startOutgoingEmail']>(() =>
      Promise.resolve({ status: 'started', id: 'email-1' } as const),
    ),
    finishOutgoingEmail: vi.fn<Database['finishOutgoingEmail']>(() => Promise.resolve('done')),
    listEmails: vi.fn<Database['listEmails']>(() => Promise.resolve([])),
    getEmail: vi.fn<Database['getEmail']>(() => Promise.resolve(null)),
    listCallbackReturns: vi.fn<Database['listCallbackReturns']>(() => Promise.resolve([])),
    countCallbackReturns: vi.fn<Database['countCallbackReturns']>(() => Promise.resolve(0)),
    settleCallbackReturn: vi.fn<Database['settleCallbackReturn']>(() => Promise.resolve('done')),
    myCallback: vi.fn<Database['myCallback']>(() => Promise.resolve(null)),
    close: vi.fn<Database['close']>(() => Promise.resolve()),
  };
  return db;
}
