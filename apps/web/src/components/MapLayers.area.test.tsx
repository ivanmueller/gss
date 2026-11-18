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

function Map({
  area,
  session = SESSION,
}: {
  area?: MapLayerArea;
  session?: { token: string; organization: { id: string } };
}) {
  const state = useMapLayers(session, area);
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

  it('never shows another organization’s layers while the new one’s load (Codex’s final review of F-240)', async () => {
    const other = '00000000-0000-4000-8000-0000000000bb';
    mockApi({
      [GRAIN]: () => Response.json({ layers: [rail] }),
      [`GET /map-layers?organization_id=${other}&area=grain`]: () =>
        new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    const { rerender } = render(<Map />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    expect(await screen.findByRole('switch', { name: 'Synthetic rail lines' })).toBeVisible();
    rerender(<Map session={{ ...SESSION, organization: { id: other } }} />);
    expect(screen.queryByRole('switch', { name: 'Synthetic rail lines' })).toBeNull();
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
      .map((button) => button.closest('li'))
      .find((li) => li !== null && within(li).queryByText('Oil and gas') !== null);
    if (!oilGroup) throw new Error('no oil and gas group');
    await user.click(within(oilGroup).getByRole('button', { name: 'Remove map' }));
    await user.click(within(oilGroup).getByRole('button', { name: /Remove all 1 layer/ }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/map-layers/${fields.id}/remove`)).toBe(true);
    });
    expect(calls.some((c) => c.path === `/map-layers/${wells.id}/remove`)).toBe(false);
  });

  it('removes what the confirmation showed, even if the list changes while it is open (Codex’s final review of F-240)', async () => {
    const map = { itemId: 'b'.repeat(32), title: 'Synthetic pipeline map' };
    const a = { ...rail, id: '00000000-0000-4000-8000-0000000a4c01', name: 'Pipes A', map };
    const b = { ...rail, id: '00000000-0000-4000-8000-0000000a4c02', name: 'Pipes B', map };
    const c = { ...rail, id: '00000000-0000-4000-8000-0000000a4c03', name: 'Pipes C', map };
    let layers: MapLayerView[] = [a, b, { ...c, area: 'oil_gas' }];
    const calls = mockApi({
      [ALL]: () => Response.json({ layers }),
      [`POST /map-layers/${a.id}/remove`]: () => Response.json({ id: a.id }),
      [`POST /map-layers/${b.id}/remove`]: () =>
        Response.json(
          { error: { code: 'STALE', message: 'This layer was changed meanwhile.' } },
          { status: 409 },
        ),
      [`POST /map-layers/${c.id}/remove`]: () => Response.json({ id: c.id }),
    });
    const jwt = (n: number) =>
      `x.${btoa(JSON.stringify({ sub: 'synthetic-admin', n })).replace(/=+$/, '')}.y`;
    const user = userEvent.setup();
    const { rerender } = render(<MapLayerSettings session={{ ...SESSION, token: jwt(1) }} />);
    const grainGroup = (
      await screen.findAllByRole('button', { name: 'Show the layers of Synthetic pipeline map' })
    )
      .map((button) => button.closest('li'))
      .find((li) => li !== null && within(li).queryByText('Oil and gas') === null);
    if (!grainGroup) throw new Error('no grain group');
    await user.click(within(grainGroup).getByRole('button', { name: 'Remove map' }));
    // Meanwhile another admin moves B to oil and gas and C to grain: still two grain layers.
    layers = [a, { ...c, version: 'v2' }, { ...b, area: 'oil_gas', version: 'v2' }];
    rerender(<MapLayerSettings session={{ ...SESSION, token: jwt(2) }} />);
    await waitFor(() => {
      expect(calls.filter((call) => call.path.endsWith('&area=all'))).toHaveLength(2);
    });
    await user.click(within(grainGroup).getByRole('button', { name: /Remove all 2 layers/ }));
    await waitFor(() => {
      expect(calls.some((call) => call.path === `/map-layers/${b.id}/remove`)).toBe(true);
    });
    // A and B as shown, B at the version shown (refused as changed); never C.
    await waitFor(() => {
      expect(calls.some((call) => call.path === `/map-layers/${a.id}/remove`)).toBe(true);
    });
    const removals = calls.filter((call) => call.path.endsWith('/remove'));
    expect(removals.map((call) => call.path).sort()).toEqual(
      [`/map-layers/${a.id}/remove`, `/map-layers/${b.id}/remove`].sort(),
    );
    expect(removals.find((call) => call.path.includes(b.id))?.body).toEqual({ version: 'v1' });
  });

  it('ends a Remove selected confirmation when the ticks change (Codex’s re-review of 3090003)', async () => {
    const map = { itemId: 'c'.repeat(32), title: 'Synthetic well map' };
    const a = { ...rail, id: '00000000-0000-4000-8000-0000000a4d01', name: 'Wells A', map };
    const b = { ...rail, id: '00000000-0000-4000-8000-0000000a4d02', name: 'Wells B', map };
    const calls = mockApi({ [ALL]: () => Response.json({ layers: [a, b] }) });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(
      await screen.findByRole('button', { name: 'Show the layers of Synthetic well map' }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select Wells A' }));
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));
    expect(screen.getByRole('button', { name: 'Remove 1 layer for everyone' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Select none' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Wells B' }));
    expect(screen.queryByRole('button', { name: 'Remove 1 layer for everyone' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove selected' })).toBeVisible();
    expect(calls.some((call) => call.path.endsWith('/remove'))).toBe(false);
  });

  it('saves an open edit against the version it was opened on (Codex’s final review of F-240)', async () => {
    let layers = [rail];
    const calls = mockApi({
      [ALL]: () => Response.json({ layers }),
      [`PATCH /map-layers/${rail.id}`]: () =>
        Response.json(
          { error: { code: 'STALE', message: 'This layer was changed meanwhile.' } },
          { status: 409 },
        ),
    });
    // Two sign-ins of the same person (a token and its renewal).
    const jwt = (n: number) =>
      `x.${btoa(JSON.stringify({ sub: 'synthetic-admin', n })).replace(/=+$/, '')}.y`;
    const user = userEvent.setup();
    const { rerender } = render(<MapLayerSettings session={{ ...SESSION, token: jwt(1) }} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Synthetic rail lines' });
    // Another admin moves it meanwhile; a renewed sign-in asks for the list again.
    layers = [{ ...rail, area: 'oil_gas', version: 'v2' }];
    rerender(<MapLayerSettings session={{ ...SESSION, token: jwt(2) }} />);
    await waitFor(() => {
      expect(calls.filter((c) => c.path.endsWith('&area=all'))).toHaveLength(2);
    });
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Railways');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        version: 'v1',
        area: 'grain',
      });
    });
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
