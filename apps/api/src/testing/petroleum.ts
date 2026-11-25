import { vi } from 'vitest';

import { PETROLEUM_SCHEMA_VERSION, type PetroleumDatabase } from '../petroleum-db';

/** A stand-in for the oil and gas database: reachable, migrated and empty. */
export function fakePetroleum() {
  return {
    schemaVersion: vi.fn<PetroleumDatabase['schemaVersion']>(() =>
      Promise.resolve(PETROLEUM_SCHEMA_VERSION),
    ),
    organizationSeen: vi.fn<PetroleumDatabase['organizationSeen']>((ctx) =>
      Promise.resolve(ctx.organizationId),
    ),
    listLayers: vi.fn<PetroleumDatabase['listLayers']>(() => Promise.resolve([])),
    layerSource: vi.fn<PetroleumDatabase['layerSource']>(() => Promise.resolve(null)),
    createLayer: vi.fn<PetroleumDatabase['createLayer']>(() =>
      Promise.resolve({ status: 'saved', id: '00000000-0000-4000-8000-0000000a1a01' }),
    ),
    updateLayer: vi.fn<PetroleumDatabase['updateLayer']>((_ctx, id) =>
      Promise.resolve({ status: 'saved', id }),
    ),
    removeLayer: vi.fn<PetroleumDatabase['removeLayer']>((_ctx, id) =>
      Promise.resolve({ status: 'saved', id }),
    ),
    aerCapture: vi.fn<PetroleumDatabase['aerCapture']>(() =>
      Promise.resolve({
        fileId: '00000000-0000-4000-8000-00000000f001',
        newFile: true,
        newEdition: true,
      }),
    ),
    aerFilesToRead: vi.fn<PetroleumDatabase['aerFilesToRead']>(() => Promise.resolve([])),
    aerStoreReading: vi.fn<PetroleumDatabase['aerStoreReading']>(() => Promise.resolve('stored')),
    aerSubdivisionsToLocate: vi.fn<PetroleumDatabase['aerSubdivisionsToLocate']>(() =>
      Promise.resolve([]),
    ),
    aerStorePoints: vi.fn<PetroleumDatabase['aerStorePoints']>(() => Promise.resolve()),
    aerLicences: vi.fn<PetroleumDatabase['aerLicences']>(() =>
      Promise.resolve({ rows: [], dates: { latestListDate: null, lastSeenAt: null } }),
    ),
    aerRigs: vi.fn<PetroleumDatabase['aerRigs']>(() =>
      Promise.resolve({
        rows: [],
        dates: { latestListDate: null, lastSeenAt: null },
        listDates: [],
      }),
    ),
    aerArchiveMonthsKept: vi.fn<PetroleumDatabase['aerArchiveMonthsKept']>(() =>
      Promise.resolve([]),
    ),
    aerLicencesToLocate: vi.fn<PetroleumDatabase['aerLicencesToLocate']>(() => Promise.resolve([])),
    aerStoreLicenceLocations: vi.fn<PetroleumDatabase['aerStoreLicenceLocations']>(() =>
      Promise.resolve(),
    ),
    aerTargetsToFind: vi.fn<PetroleumDatabase['aerTargetsToFind']>(() => Promise.resolve([])),
    aerStoreTargets: vi.fn<PetroleumDatabase['aerStoreTargets']>(() => Promise.resolve()),
    databaseSize: vi.fn<PetroleumDatabase['databaseSize']>(() => Promise.resolve(20_000_000)),
    latestWellLoad: vi.fn<PetroleumDatabase['latestWellLoad']>(() => Promise.resolve(null)),
    lastDoneWellLoad: vi.fn<PetroleumDatabase['lastDoneWellLoad']>(() => Promise.resolve(null)),
    startWellLoad: vi.fn<PetroleumDatabase['startWellLoad']>(() => Promise.resolve(null)),
    saveWellPage: vi.fn<PetroleumDatabase['saveWellPage']>(() => Promise.resolve('saved')),
    stopWellLoad: vi.fn<PetroleumDatabase['stopWellLoad']>(() => Promise.resolve('saved')),
    wellsStatus: vi.fn<PetroleumDatabase['wellsStatus']>(() =>
      Promise.resolve({ load: null, current: 0 }),
    ),
    st37Wells: vi.fn<PetroleumDatabase['st37Wells']>(() =>
      Promise.resolve({ loads: [], wells: [] }),
    ),
    st37Drilled: vi.fn<PetroleumDatabase['st37Drilled']>(() => Promise.resolve([])),
    st37FieldFind: vi.fn<PetroleumDatabase['st37FieldFind']>(() =>
      Promise.resolve({ field: null, pool: null, wells: 0, bounds: null }),
    ),
    st37Well3d: vi.fn<PetroleumDatabase['st37Well3d']>(() =>
      Promise.resolve({ loadedAt: null, legs: [] }),
    ),
    formationCells: vi.fn<PetroleumDatabase['formationCells']>(() =>
      Promise.resolve({ load: null, cells: [] }),
    ),
    wellProduction: vi.fn<PetroleumDatabase['wellProduction']>(() =>
      Promise.resolve({ load: null, months: [] }),
    ),
    formationProduction: vi.fn<PetroleumDatabase['formationProduction']>(() =>
      Promise.resolve({ load: null, months: [] }),
    ),
    land: vi.fn<PetroleumDatabase['land']>(() =>
      Promise.resolve({ loads: [], agreements: [], offsets: [], freehold: [] }),
    ),
    landZoneStamp: vi.fn<PetroleumDatabase['landZoneStamp']>(() => Promise.resolve('1:1')),
    landZones: vi.fn<PetroleumDatabase['landZones']>(() => Promise.resolve([])),
    facilities: vi.fn<PetroleumDatabase['facilities']>(() =>
      Promise.resolve({ load: null, rows: [] }),
    ),
    operators: vi.fn<PetroleumDatabase['operators']>(() => Promise.resolve([])),
    prices: vi.fn<PetroleumDatabase['prices']>(() => Promise.resolve({ load: null, rows: [] })),
    fracOfLicence: vi.fn<PetroleumDatabase['fracOfLicence']>(() =>
      Promise.resolve({ load: null, rows: [] }),
    ),
    geologyOfWell: vi.fn<PetroleumDatabase['geologyOfWell']>(() =>
      Promise.resolve({
        well: null,
        legs: [],
        picked: [],
        names: [],
        samples: [],
        cells: [],
        loads: { picks: null, samples: null, model: null },
      }),
    ),
    playSamples: vi.fn<PetroleumDatabase['playSamples']>(() =>
      Promise.resolve({ samples: [], load: null }),
    ),
    pipelineSquare: vi.fn<PetroleumDatabase['pipelineSquare']>(() =>
      Promise.resolve({ load: null, rows: [] }),
    ),
    pipelineSegment: vi.fn<PetroleumDatabase['pipelineSegment']>(() => Promise.resolve(null)),
    landSales: vi.fn<PetroleumDatabase['landSales']>(() =>
      Promise.resolve({ load: null, parcels: [] }),
    ),
    landSaleDots: vi.fn<PetroleumDatabase['landSaleDots']>(() =>
      Promise.resolve({ load: null, parcels: [] }),
    ),
    landAgreementDots: vi.fn<PetroleumDatabase['landAgreementDots']>(() =>
      Promise.resolve({ loads: [], agreements: [] }),
    ),
    landSaleSummary: vi.fn<PetroleumDatabase['landSaleSummary']>(() =>
      Promise.resolve({
        offered: 0,
        sold: 0,
        bonus: '0',
        hectaresSold: '0',
        averagePerHectare: null,
        highPerHectare: null,
        nextSale: null,
        sales: [],
        quarters: [],
      }),
    ),
    close: vi.fn<PetroleumDatabase['close']>(() => Promise.resolve()),
    abort: vi.fn<PetroleumDatabase['abort']>(() => Promise.resolve()),
  };
}
