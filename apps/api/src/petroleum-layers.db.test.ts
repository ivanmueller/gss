import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { connectionOptions } from './db';
import type { MapLayerChanges, NewMapLayer } from './map-layers-db';
import { createPetroleumDatabase, type PetroleumContext } from './petroleum-db';

// Integration test (F-247 part 2): the oil and gas map layer queries as the real `petro_api`
// role, against the real migration. Each test uses its own made-up organization, so the rows it
// leaves behind (nothing is ever deleted) never meet another test's. Synthetic values only.
const PETRO_URL = process.env.PETROLEUM_TEST_DATABASE_URL;
if (!PETRO_URL) {
  throw new Error(
    'Set PETROLEUM_TEST_DATABASE_URL (petro_api login on the local petroleum database).',
  );
}

const sql = postgres(PETRO_URL, connectionOptions(PETRO_URL));
const db = createPetroleumDatabase(sql);

afterAll(async () => {
  await db.close();
});

function member(role: string, organizationId: string = crypto.randomUUID()): PetroleumContext {
  return {
    userId: crypto.randomUUID(),
    organizationId,
    role,
    requestId: crypto.randomUUID(),
  };
}

const SERVICE = 'https://services.example.com/rest/services/Land/MapServer/8';

function layer(changes: Partial<NewMapLayer> = {}): NewMapLayer {
  return {
    name: 'Agreements',
    kind: 'arcgis_features',
    url: SERVICE,
    wmsLayers: null,
    idField: 'OBJECTID',
    sourceName: 'Synthetic publisher',
    termsUrl: 'https://example.com/terms',
    termsNote: 'Open licence.',
    colour: '#2f6baa',
    colourField: 'STATUS',
    colours: [['Active', '#e6194b']],
    alsoFields: ['STATUS2'],
    onlyField: 'KIND',
    onlyValues: ['A', 'B'],
    lineWidth: 2,
    opacity: 0.5,
    minZoom: 4,
    maxZoom: 12,
    definitionExpression: "KIND = 'A'",
    othersShown: false,
    map: null,
    mapVisible: true,
    tileLevels: null,
    file: null,
    ...changes,
  };
}

async function added(admin: PetroleumContext, changes: Partial<NewMapLayer> = {}) {
  const result = await db.createLayer(admin, layer(changes));
  if (result.status !== 'saved') throw new Error(`not saved: ${result.status}`);
  return result.id;
}

describe('oil and gas map layers as petro_api', () => {
  it('keeps a layer as it was added and lists it for every role of its organization', async () => {
    const admin = member('org_admin');
    const id = await added(admin);
    for (const role of ['viewer', 'analyst', 'trader', 'operations', 'org_admin']) {
      const layers = await db.listLayers(member(role, admin.organizationId));
      expect(layers).toHaveLength(1);
      expect(layers[0]).toMatchObject({
        id,
        name: 'Agreements',
        kind: 'arcgis_features',
        url: SERVICE,
        wmsLayers: null,
        sourceName: 'Synthetic publisher',
        termsUrl: 'https://example.com/terms',
        termsNote: 'Open licence.',
        colour: '#2f6baa',
        colourField: 'STATUS',
        colours: [['Active', '#e6194b']],
        alsoFields: ['STATUS2'],
        onlyField: 'KIND',
        onlyValues: ['A', 'B'],
        fileName: null,
        createdByName: null,
        overview: null,
        lineWidth: 2,
        opacity: 0.5,
        minZoom: 4,
        maxZoom: 12,
        definitionExpression: "KIND = 'A'",
        othersShown: false,
        map: null,
        mapVisible: true,
        tileLevels: null,
      });
    }
    expect(await db.layerSource(member('viewer', admin.organizationId), id)).toEqual({
      id,
      organizationId: admin.organizationId,
      kind: 'arcgis_features',
      url: SERVICE,
      wmsLayers: null,
      idField: 'OBJECTID',
      colourField: 'STATUS',
      alsoFields: ['STATUS2'],
      onlyField: 'KIND',
      onlyValues: ['A', 'B'],
      definitionExpression: "KIND = 'A'",
      tileLevels: null,
    });
  });

  it('keeps a pre-drawn layer with its levels', async () => {
    const admin = member('org_admin');
    const id = await added(admin, {
      kind: 'arcgis_tiles',
      url: 'https://services.example.com/rest/services/Heat/MapServer',
      idField: null,
      colourField: null,
      colours: [],
      alsoFields: [],
      onlyField: null,
      onlyValues: [],
      definitionExpression: null,
      tileLevels: { min: 0, max: 9 },
    });
    expect((await db.layerSource(admin, id))?.tileLevels).toEqual({ min: 0, max: 9 });
    expect((await db.listLayers(admin))[0]?.tileLevels).toEqual({ min: 0, max: 9 });
  });

  it('shows another organization nothing, and lets it change nothing', async () => {
    const admin = member('org_admin');
    const id = await added(admin);
    const version = (await db.listLayers(admin))[0]?.version ?? '';
    const other = member('org_admin');
    expect(await db.listLayers(other)).toEqual([]);
    expect(await db.layerSource(other, id)).toBeNull();
    expect(await db.updateLayer(other, id, version, layer({ name: 'Taken' }))).toEqual({
      status: 'not_found',
    });
    expect(await db.removeLayer(other, id, version)).toEqual({ status: 'not_found' });
    expect((await db.listLayers(admin))[0]?.name).toBe('Agreements');
  });

  it('lets only an admin add, change and remove', async () => {
    const admin = member('org_admin');
    const id = await added(admin);
    const version = (await db.listLayers(admin))[0]?.version ?? '';
    for (const role of ['viewer', 'analyst', 'trader', 'operations']) {
      const person = member(role, admin.organizationId);
      expect(await db.createLayer(person, layer())).toEqual({ status: 'forbidden' });
      expect(await db.updateLayer(person, id, version, layer({ name: 'Mine' }))).toEqual({
        status: 'forbidden',
      });
      expect(await db.removeLayer(person, id, version)).toEqual({ status: 'forbidden' });
    }
    expect(await db.listLayers(admin)).toHaveLength(1);
  });

  it('changes a layer once per version, the opening default included', async () => {
    const admin = member('org_admin');
    const id = await added(admin, { mapVisible: false });
    const first = (await db.listLayers(admin))[0]?.version ?? '';
    const changes = layer({ name: 'Crown agreements', mapVisible: true, colourField: null });
    expect(
      await db.updateLayer(admin, id, first, { ...changes, colours: [], alsoFields: [] }),
    ).toEqual({ status: 'saved', id });
    const [now] = await db.listLayers(admin);
    expect(now).toMatchObject({ name: 'Crown agreements', mapVisible: true, colourField: null });
    expect(now?.version).not.toBe(first);
    // The version someone else saw is refused; so is a second removal with it.
    expect(await db.updateLayer(admin, id, first, changes)).toEqual({ status: 'stale' });
    expect(await db.removeLayer(admin, id, first)).toEqual({ status: 'stale' });
    // What was set when it was added stays: the update does not touch it.
    expect(now).toMatchObject({ lineWidth: 2, opacity: 0.5, definitionExpression: "KIND = 'A'" });
  });

  it('leaves the opening default alone when a change does not name it', async () => {
    const admin = member('org_admin');
    const id = await added(admin, { mapVisible: true });
    const version = (await db.listLayers(admin))[0]?.version ?? '';
    const changes: MapLayerChanges = { ...layer({ name: 'Renamed' }), mapVisible: undefined };
    expect(await db.updateLayer(admin, id, version, changes)).toEqual({ status: 'saved', id });
    expect((await db.listLayers(admin))[0]).toMatchObject({ name: 'Renamed', mapVisible: true });
  });

  it('removes a layer for good: gone from the list, never changed again', async () => {
    const admin = member('org_admin');
    const id = await added(admin);
    const version = (await db.listLayers(admin))[0]?.version ?? '';
    expect(await db.removeLayer(admin, id, version)).toEqual({ status: 'saved', id });
    expect(await db.listLayers(admin)).toEqual([]);
    expect(await db.layerSource(admin, id)).toBeNull();
    expect(await db.updateLayer(admin, id, version, layer())).toEqual({ status: 'not_found' });
    expect(await db.removeLayer(admin, id, version)).toEqual({ status: 'not_found' });
  });

  it('gives two people at once one winner', async () => {
    const admin = member('org_admin');
    const id = await added(admin);
    const version = (await db.listLayers(admin))[0]?.version ?? '';
    const results = await Promise.all([
      db.updateLayer(admin, id, version, layer({ name: 'First' })),
      db.updateLayer(
        member('org_admin', admin.organizationId),
        id,
        version,
        layer({ name: 'Second' }),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['saved', 'stale']);
  });

  it('never carries one person’s organization to the next query on the connection', async () => {
    const first = member('org_admin');
    const second = member('org_admin');
    await added(first, { name: 'Of the first' });
    await added(second, { name: 'Of the second' });
    const [a, b] = await Promise.all([db.listLayers(first), db.listLayers(second)]);
    expect(a.map((l) => l.name)).toEqual(['Of the first']);
    expect(b.map((l) => l.name)).toEqual(['Of the second']);
  });
});
