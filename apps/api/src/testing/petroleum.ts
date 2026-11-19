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
      Promise.resolve({ rows: [], dates: { latestListDate: null, lastSeenAt: null } }),
    ),
    close: vi.fn<PetroleumDatabase['close']>(() => Promise.resolve()),
    abort: vi.fn<PetroleumDatabase['abort']>(() => Promise.resolve()),
  };
}
