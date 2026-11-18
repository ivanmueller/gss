import type { MapLayerArea, MapLayerView } from '@grain/domain';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiCache } from '../lib/useApiResource';
import { mockApi, ORG, SESSION } from '../test/api';
import { MapLayerSettings } from './MapLayerSettings';
import { MapLayersButton, MapLayersPanel, useMapLayers } from './MapLayers';

// Map layers kept apart by area, grain or oil and gas (F-240). Every layer is synthetic.
vi.mock('../lib/mapOverview', () => ({ prepareOverview: vi.fn() }));

const GRAIN = `GET /map-layers?organization_id=${ORG.id}&area=grain`;
const OIL = `GET /map-layers?organization_id=${ORG.id}&area=oil_gas`;
const ALL = `GET /map-layers?organization_id=${ORG.id}&area=all`;

const rail: MapLayerView = {
  id: '00000000-0000-4000-8000-0000000a4b01',
  name: 'Synthetic rail lines',
  kind: 'arcgis_features',
  area: 'grain',
  url: 'https://services.example.com/rest/services/Rail/FeatureServer/0',
  wmsLayers: null,
  sourceName: 'Synthetic publisher',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Public domain.',
  colour: '#2f6baa',
  colourField: null,
  colours: [],
  fileName: null,
  featureCount: null,
  createdByName: 'Adam Admin',
  createdAt: '2026-11-18T18:00:00Z',
  version: 'v1',
  alsoFields: [],
  onlyField: null,
  onlyValues: [],
  overview: null,
  lineWidth: null,
  opacity: 1,
  minZoom: null,
  maxZoom: null,
  definitionExpression: null,
  othersShown: true,
  map: null,
  mapVisible: true,
  tileLevels: null,
};
const grid: MapLayerView = {
  ...rail,
  id: '00000000-0000-4000-8000-0000000a4b02',
  name: 'Synthetic township grid',
  area: 'oil_gas',
};

function Map({ area }: { area?: MapLayerArea }) {
  const state = useMapLayers(SESSION, area);
  return (
    <>
      <MapLayersButton state={state} />
      <MapLayersPanel state={state} side="left" />
    </>
  );
}

function showAgain() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  clearApiCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a map’s layers', () => {
  it('asks for the grain layers on a grain map, and never shows another area’s', async () => {
    // A layer of the wrong area is left out even if the server sent it.
    const calls = mockApi({ [GRAIN]: () => Response.json({ layers: [rail, grid] }) });
    const user = userEvent.setup();
    render(<Map />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    expect(await screen.findByRole('switch', { name: 'Synthetic rail lines' })).toBeVisible();
    expect(screen.queryByRole('switch', { name: 'Synthetic township grid' })).toBeNull();
    expect(calls.filter((c) => c.path.startsWith('/map-layers'))).toHaveLength(1);
  });

  it('asks for the oil and gas layers on the oil and gas map, and says when there are none', async () => {
    mockApi({ [OIL]: () => Response.json({ layers: [] }) });
    const user = userEvent.setup();
    render(<Map area="oil_gas" />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    expect(await screen.findByText(/No oil and gas map layers yet/)).toBeVisible();
  });

  it('drops a layer moved to the other area when the window is shown again (Codex’s design review of F-240)', async () => {
    let layers = [rail];
    mockApi({ [GRAIN]: () => Response.json({ layers }) });
    const user = userEvent.setup();
    render(<Map />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    await user.click(await screen.findByRole('switch', { name: 'Synthetic rail lines' }));
    // An admin moves it to oil and gas in another tab.
    layers = [];
    showAgain();
    await waitFor(() => {
      expect(screen.queryByRole('switch', { name: 'Synthetic rail lines' })).toBeNull();
    });
  });

  it('drops it too when a window left in view gets the focus back (Codex’s review of 07d45b7)', async () => {
    let layers = [rail];
    mockApi({ [GRAIN]: () => Response.json({ layers }) });
    const user = userEvent.setup();
    render(<Map />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    expect(await screen.findByRole('switch', { name: 'Synthetic rail lines' })).toBeVisible();
    layers = [];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(screen.queryByRole('switch', { name: 'Synthetic rail lines' })).toBeNull();
    });
  });
});

describe('Team → Map layers', () => {
  it('lists every area, marking the oil and gas layers', async () => {
    mockApi({ [ALL]: () => Response.json({ layers: [rail, grid] }) });
    render(<MapLayerSettings session={SESSION} />);
    const gridRow = (await screen.findByText('Synthetic township grid')).closest('li');
    expect(gridRow).not.toBeNull();
    expect(within(gridRow as HTMLElement).getByText('Oil and gas')).toBeVisible();
    const railRow = screen.getByText('Synthetic rail lines').closest('li');
    expect(within(railRow as HTMLElement).queryByText('Oil and gas')).toBeNull();
  });

  it('keeps an ArcGIS map’s layers of each area in groups of their own, removed apart (Codex’s final review of F-240)', async () => {
    const map = { itemId: 'a'.repeat(32), title: 'Synthetic basin map' };
    const wells = { ...rail, id: '00000000-0000-4000-8000-0000000a4b03', name: 'Wells', map };
    const fields = { ...grid, id: '00000000-0000-4000-8000-0000000a4b04', name: 'Fields', map };
    const calls = mockApi({
      [ALL]: () => Response.json({ layers: [wells, fields] }),
      [`POST /map-layers/${fields.id}/remove`]: () => Response.json({ id: fields.id }),
      [`POST /map-layers/${wells.id}/remove`]: () => Response.json({ id: wells.id }),
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    const groups = await screen.findAllByRole('button', {
      name: 'Show the layers of Synthetic basin map',
    });
    expect(groups).toHaveLength(2);
    const oilGroup = groups
      .map((button) => button.closest('li') as HTMLElement)
      .find((li) => within(li).queryByText('Oil and gas') !== null);
    expect(oilGroup).toBeDefined();
    await user.click(within(oilGroup as HTMLElement).getByRole('button', { name: 'Remove map' }));
    await user.click(
      within(oilGroup as HTMLElement).getByRole('button', { name: /Remove all 1 layer/ }),
    );
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/map-layers/${fields.id}/remove`)).toBe(true);
    });
    expect(calls.some((c) => c.path === `/map-layers/${wells.id}/remove`)).toBe(false);
  });

  it('moves a layer to oil and gas from Edit', async () => {
    const calls = mockApi({
      [ALL]: () => Response.json({ layers: [rail] }),
      [`PATCH /map-layers/${rail.id}`]: () => Response.json({ id: rail.id }),
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Synthetic rail lines' });
    const choice = within(dialog).getByRole('group', { name: 'For' });
    expect(within(choice).getByRole('button', { name: 'Grain' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(choice).getByRole('button', { name: 'Oil and gas' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ area: 'oil_gas' });
    });
  });
});
