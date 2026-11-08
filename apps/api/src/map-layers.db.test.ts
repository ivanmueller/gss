import { normalizeFeatureCollection, parseLayerSource } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase } from './db';
import type { NewMapLayer } from './map-layers-db';

// Integration test: map layers as the real `app_api` role against the real migration
// (F-107). Fixtures are synthetic, in organizations of their own, removed afterwards.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const ORG_A = crypto.randomUUID();
const ORG_B = crypto.randomUUID();
const ADAM = crypto.randomUUID(); // A's admin
const VERA = crypto.randomUUID(); // A's viewer
const BOB = crypto.randomUUID(); // B's admin
const as = (userId: string) => ({ userId, requestId: crypto.randomUUID() });

const SERVICE: NewMapLayer = {
  name: 'Synthetic rail lines',
  kind: 'arcgis_features',
  url: 'https://services.example.com/rest/services/Rail/FeatureServer/0',
  wmsLayers: null,
  idField: 'OBJECTID',
  sourceName: 'Synthetic publisher',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Public domain.',
  colour: '#2f6baa',
  colourField: 'OWNER',
  colours: [
    ['AAA', '#e6194b'],
    ['BBB', '#3cb44b'],
  ],
  file: null,
};

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values
    (${ADAM}, 'adam.layers@example.test'), (${VERA}, 'vera.layers@example.test'),
    (${BOB}, 'bob.layers@example.test')`;
  await admin`insert into app.organizations (id, display_name) values
    (${ORG_A}, 'Synthetic Layers A'), (${ORG_B}, 'Synthetic Layers B')`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
    values (${ORG_A}, ${ADAM}, 'org_admin', 'active', now()),
           (${ORG_A}, ${VERA}, 'viewer', 'active', now()),
           (${ORG_B}, ${BOB}, 'org_admin', 'active', now())`;
});

afterAll(async () => {
  await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from app.map_layer_overviews where organization_id in (${ORG_A}, ${ORG_B})`;
    await tx`delete from app.map_layer_overview_parts where organization_id in (${ORG_A}, ${ORG_B})`;
    await tx`delete from app.map_layer_files where organization_id in (${ORG_A}, ${ORG_B})`;
    await tx`delete from app.map_layers where organization_id in (${ORG_A}, ${ORG_B})`;
    await tx`delete from app.audit_events where organization_id in (${ORG_A}, ${ORG_B})`;
    await tx`delete from app.organization_members where organization_id in (${ORG_A}, ${ORG_B})`;
    await tx`delete from app.organizations where id in (${ORG_A}, ${ORG_B})`;
    await tx`delete from auth.users where id in (${ADAM}, ${VERA}, ${BOB})`;
  });
  await admin.end();
});

describe('map layers as app_api', () => {
  it('lets an admin add, change and remove layers that every member sees, and no one else', async () => {
    const db = postgresDatabase(API_URL);
    try {
      expect(await db.createMapLayer(as(VERA), ORG_A, SERVICE)).toEqual({ status: 'forbidden' });
      expect(await db.createMapLayer(as(BOB), ORG_A, SERVICE)).toEqual({ status: 'forbidden' });
      const added = await db.createMapLayer(as(ADAM), ORG_A, SERVICE);
      if (added.status !== 'saved') throw new Error('not added');

      const [layer] = (await db.listMapLayers(as(VERA), ORG_A)) ?? [];
      expect(layer).toMatchObject({
        id: added.id,
        name: SERVICE.name,
        kind: 'arcgis_features',
        url: SERVICE.url,
        colours: SERVICE.colours,
        fileName: null,
        createdByName: 'adam.layers@example.test',
      });
      expect(await db.listMapLayers(as(BOB), ORG_A)).toBeNull();
      expect(await db.listMapLayers(as(BOB), ORG_B)).toEqual([]);
      expect(await db.getMapLayerSource(as(BOB), added.id)).toBeNull();
      expect(await db.getMapLayerSource(as(VERA), added.id)).toEqual({
        id: added.id,
        organizationId: ORG_A,
        kind: 'arcgis_features',
        url: SERVICE.url,
        wmsLayers: null,
        idField: 'OBJECTID',
        colourField: 'OWNER',
      });

      const version = layer?.version ?? '';
      const changes = {
        name: 'Railways',
        wmsLayers: null,
        sourceName: SERVICE.sourceName,
        termsUrl: SERVICE.termsUrl,
        termsNote: SERVICE.termsNote,
        colour: '#000000',
        colourField: null,
        colours: [] as [string, string][],
      };
      expect(await db.updateMapLayer(as(VERA), added.id, version, changes)).toEqual({
        status: 'forbidden',
      });
      expect(await db.updateMapLayer(as(BOB), added.id, version, changes)).toEqual({
        status: 'not_found',
      });
      expect(await db.updateMapLayer(as(ADAM), added.id, version, changes)).toEqual({
        status: 'saved',
        id: added.id,
      });
      expect(await db.updateMapLayer(as(ADAM), added.id, version, changes)).toEqual({
        status: 'stale',
      });
      const [changed] = (await db.listMapLayers(as(ADAM), ORG_A)) ?? [];
      expect(changed).toMatchObject({ name: 'Railways', colourField: null, colours: [] });

      expect(await db.removeMapLayer(as(VERA), added.id, changed?.version ?? '')).toEqual({
        status: 'forbidden',
      });
      expect(await db.removeMapLayer(as(ADAM), added.id, changed?.version ?? '')).toEqual({
        status: 'saved',
        id: added.id,
      });
      expect(await db.listMapLayers(as(VERA), ORG_A)).toEqual([]);
      expect(await db.getMapLayerSource(as(VERA), added.id)).toBeNull();
      const [kept] = await admin<{ archived_by: string }[]>`
        select archived_by from app.map_layers where id = ${added.id}`;
      expect(kept?.archived_by).toBe(ADAM);
    } finally {
      await db.close();
    }
  });

  it('keeps a file layer’s GeoJSON for its organization only', async () => {
    const checked = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-105, 50] },
          properties: { OWNER: 'AAA' },
        },
      ],
    });
    if (!checked.ok) throw new Error(checked.message);
    const geojson = new TextEncoder().encode(JSON.stringify(checked.collection));
    const db = postgresDatabase(API_URL);
    try {
      const added = await db.createMapLayer(as(ADAM), ORG_A, {
        ...SERVICE,
        kind: 'file',
        url: null,
        idField: null,
        file: { name: 'elevators.geojson', geojson, featureCount: 1 },
      });
      if (added.status !== 'saved') throw new Error('not added');
      const file = await db.getMapLayerFile(as(VERA), added.id);
      expect(JSON.parse(new TextDecoder().decode(file?.geojson))).toEqual(checked.collection);
      expect(file?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await db.getMapLayerFile(as(BOB), added.id)).toBeNull();
      const layer = (await db.listMapLayers(as(VERA), ORG_A))?.find((l) => l.id === added.id);
      expect(layer).toMatchObject({ kind: 'file', fileName: 'elevators.geojson', featureCount: 1 });
    } finally {
      await db.close();
    }
  });

  it('publishes a zoomed-out view only when complete and grouped by the layer’s field now', async () => {
    const db = postgresDatabase(API_URL);
    try {
      const added = await db.createMapLayer(as(ADAM), ORG_A, SERVICE);
      if (added.status !== 'saved') throw new Error('not added');
      const part = (version: string, partNo: number) => ({
        version,
        partNo,
        featureCount: 1,
        features: new TextEncoder().encode(
          JSON.stringify([
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-105, 50],
                  [-104, 50],
                ],
              },
              properties: { OWNER: `P${String(partNo)}` },
            },
          ]),
        ),
      });
      const v1 = crypto.randomUUID();
      const v2 = crypto.randomUUID();
      expect(await db.saveMapLayerOverviewPart(as(VERA), added.id, part(v1, 0))).toEqual({
        status: 'forbidden',
      });
      expect(await db.saveMapLayerOverviewPart(as(BOB), added.id, part(v1, 0))).toEqual({
        status: 'not_found',
      });
      expect(await db.saveMapLayerOverviewPart(as(ADAM), added.id, part(v1, 0))).toMatchObject({
        status: 'saved',
      });
      // Sent again, a part replaces itself.
      expect(await db.saveMapLayerOverviewPart(as(ADAM), added.id, part(v1, 0))).toMatchObject({
        status: 'saved',
      });
      const publish = (who: string, version: string, colourField: string | null, partCount = 2) =>
        db.publishMapLayerOverview(as(who), added.id, {
          version,
          colourField,
          partCount,
          sourceCount: 10,
        });
      expect(await publish(ADAM, v1, 'OWNER')).toEqual({ status: 'incomplete' });
      await db.saveMapLayerOverviewPart(as(ADAM), added.id, part(v1, 1));
      expect(await publish(VERA, v1, 'OWNER')).toEqual({ status: 'forbidden' });
      expect(await publish(ADAM, v1, 'OWNER')).toEqual({ status: 'saved', id: added.id });

      // Codex's review of d35ac90: a published preparation is sealed; a part sent to it later
      // changes nothing.
      expect(await db.saveMapLayerOverviewPart(as(ADAM), added.id, part(v1, 2))).toEqual({
        status: 'sealed',
      });
      expect(await db.saveMapLayerOverviewPart(as(ADAM), added.id, part(v1, 0))).toEqual({
        status: 'sealed',
      });
      const read = await db.getMapLayerOverview(as(VERA), added.id);
      expect(read?.version).toBe(v1);
      expect(read?.parts.map((p) => new TextDecoder().decode(p))).toHaveLength(2);
      expect(await db.getMapLayerOverview(as(BOB), added.id)).toBeNull();
      const listed = (await db.listMapLayers(as(VERA), ORG_A))?.find((l) => l.id === added.id);
      expect(listed?.overview).toMatchObject({
        colourField: 'OWNER',
        featureCount: 2,
        sourceCount: 10,
        preparedByName: 'adam.layers@example.test',
        version: v1,
      });

      // Codex's review of 8e0fd95: another admin colours the layer by TRACKS; a view grouped by
      // OWNER, prepared before that, can no longer be published over the current one.
      const version = listed?.version ?? '';
      await db.updateMapLayer(as(ADAM), added.id, version, {
        name: SERVICE.name,
        wmsLayers: null,
        sourceName: SERVICE.sourceName,
        termsUrl: SERVICE.termsUrl,
        termsNote: SERVICE.termsNote,
        colour: '#9ca3af',
        colourField: 'TRACKS',
        colours: [['1', '#e6194b']],
      });
      await db.saveMapLayerOverviewPart(as(ADAM), added.id, part(v2, 0));
      expect(await publish(ADAM, v2, 'OWNER', 1)).toEqual({ status: 'stale' });
      expect(await publish(ADAM, v2, 'TRACKS', 1)).toEqual({ status: 'saved', id: added.id });
      expect((await db.getMapLayerOverview(as(VERA), added.id))?.version).toBe(v2);
      // The earlier preparation's parts are dropped.
      const [left] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.map_layer_overview_parts
        where layer_id = ${added.id} and version = ${v1}`;
      expect(left?.n).toBe(0);
    } finally {
      await db.close();
    }
  });

  it('re-sends a part while a publication drops it, without a deadlock (Codex’s review of d0e8463)', async () => {
    const db = postgresDatabase(API_URL);
    const publisher = postgres(API_URL, { max: 1, onnotice: () => undefined });
    try {
      const added = await db.createMapLayer(as(ADAM), ORG_A, SERVICE);
      if (added.status !== 'saved') throw new Error('not added');
      const old = crypto.randomUUID();
      const part = {
        version: old,
        partNo: 0,
        featureCount: 1,
        features: new TextEncoder().encode(
          JSON.stringify([
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-105, 50],
                  [-104, 50],
                ],
              },
              properties: { OWNER: 'AAA' },
            },
          ]),
        ),
      };
      expect(await db.saveMapLayerOverviewPart(as(ADAM), added.id, part)).toMatchObject({
        status: 'saved',
      });
      // A publication: it holds the layer, then drops other preparations' parts. Meanwhile the
      // browser re-sends part 0 of the old preparation.
      let retry: Promise<unknown> | undefined;
      await publisher.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${ADAM}, true)`;
        await tx`select 1 from app.map_layers where id = ${added.id} for update`;
        retry = db.saveMapLayerOverviewPart(as(ADAM), added.id, part);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx`delete from app.map_layer_overview_parts
                 where layer_id = ${added.id} and version = ${old}`;
      });
      // The re-sent part waited for the publication and then went in; nothing was aborted.
      await expect(retry).resolves.toMatchObject({ status: 'saved' });
    } finally {
      await publisher.end();
      await db.close();
    }
  });

  it('accepts every address parseLayerSource takes', async () => {
    const pasted = [
      'https://services.example.com/abc/ArcGIS/rest/services/NTAD_Rail_Lines/FeatureServer/0',
      'https://services.example.com/rest/services/Rail/FeatureServer?f=pjson',
      'https://Maps-Cartes.example.ca/arcgis/rest/services/Soil Zones/MapServer/12',
      'https://maps.example.ca/arcgis/rest/services/Crops_2025/ImageServer',
      'https://maps.example.ca/geoserver/ows?service=WMS&layers=a:b',
      'https://maps.example.ca/cgi-bin/%C3%A9/wms',
      `https://maps.example.ca/${'a'.repeat(1900)}/MapServer`,
    ];
    for (const text of pasted) {
      const parsed = parseLayerSource(text);
      if (!parsed.ok) continue;
      // Added for real, then rolled back, so the table's own check decides.
      const refused = await admin
        .begin(async (tx) => {
          await tx`
            insert into app.map_layers (organization_id, name, kind, source_url, wms_layers,
              source_name, terms_url, terms_note, colour, created_by, updated_by)
            values (${ORG_A}, 'Check', ${parsed.kind}, ${parsed.url},
              ${parsed.kind === 'wms' ? 'a' : null}, 'P', 'https://example.com/t', 'T',
              '#000000', ${ADAM}, ${ADAM})`;
          throw new Error('rollback');
        })
        .catch((error: unknown) =>
          error instanceof Error && error.message === 'rollback' ? null : error,
        );
      expect(refused, parsed.url).toBeNull();
    }
  });
});
