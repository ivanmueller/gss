import { describe, expect, it } from 'vitest';

import {
  arcgisPlainText,
  featureSetToGeoJSON,
  itemLayerDrawing,
  itemTerms,
  mapOfApp,
  neverShown,
  parseArcgisMapLink,
  readItemInfo,
  scaleToZoom,
  styleOfRenderer,
  webMapLayers,
  withoutTags,
  zoomRange,
} from './arcgisMaps';
import {
  balancedFilter,
  DEFINITION_EXPRESSION,
  normalizeFeatureCollection,
  safeFilter,
  whereOf,
} from './mapLayers';

const ID = '96ec03e4fc8546bd8a864e39a2c3fc41';

describe('parseArcgisMapLink', () => {
  it('finds the map in the links ArcGIS gives', () => {
    for (const link of [
      `https://www.arcgis.com/apps/mapviewer/index.html?webmap=${ID}`,
      `https://www.arcgis.com/home/item.html?id=${ID}`,
      `https://www.arcgis.com/home/webmap/viewer.html?webmap=${ID.toUpperCase()}&extent=1,2,3,4`,
      `https://example.maps.arcgis.com/apps/instant/basic/index.html?appid=${ID}`,
      `https://experience.arcgis.com/experience/${ID}/page/Home`,
      ` ${ID} `,
    ]) {
      expect(parseArcgisMapLink(link)).toEqual({ ok: true, itemId: ID });
    }
  });

  it('refuses addresses that are not ArcGIS maps', () => {
    for (const link of [
      '',
      `http://www.arcgis.com/home/item.html?id=${ID}`,
      `https://www.arcgis.com.example.com/home/item.html?id=${ID}`,
      `https://evil.example/home/item.html?id=${ID}`,
      'https://www.arcgis.com/home/item.html?id=nothex',
      'https://services.arcgis.com/x/ArcGIS/rest/services/Rail/FeatureServer/0',
      `https://user:pw@www.arcgis.com/home/item.html?id=${ID}`,
      `https://www.arcgis.com:8443/home/item.html?id=${ID}`,
    ]) {
      expect(parseArcgisMapLink(link).ok).toBe(false);
    }
  });
});

describe('items', () => {
  it('reads an item and its terms, as plain text', () => {
    const info = readItemInfo({
      id: ID,
      title: 'National Rail <b>Network</b> Map',
      type: 'Web Map',
      owner: 'someone',
      accessInformation: 'Synthetic Board',
      licenseInfo: '<p>Public&nbsp;domain &amp; free to use.</p>',
    });
    expect(info).toEqual({
      id: ID,
      title: 'National Rail Network Map',
      type: 'Web Map',
      credits: 'Synthetic Board',
      licence: 'Public domain & free to use.',
    });
    expect(info && itemTerms(info)).toEqual({
      sourceName: 'Synthetic Board',
      termsUrl: `https://www.arcgis.com/home/item.html?id=${ID}`,
      termsNote: 'Public domain & free to use.',
    });
    expect(readItemInfo({ error: { code: 403 } })).toBeNull();
    expect(readItemInfo({ id: '../x', type: 'Web Map' })).toBeNull();
  });

  it('says when no terms are stated, and cuts long text', () => {
    const info = readItemInfo({ id: ID, title: 'M', type: 'Web Map', owner: 'pub' });
    expect(info && itemTerms(info).termsNote).toBe('No terms are stated on the map’s ArcGIS page.');
    expect(info?.credits).toBeNull();
    expect(info && itemTerms(info).sourceName).toBe('M (ArcGIS Online)');
    expect(arcgisPlainText('a'.repeat(50), 10)).toBe('aaaaaaaaa…');
  });

  it('finds the map an app shows', () => {
    expect(mapOfApp({ values: { webmap: ID } })).toBe(ID);
    expect(mapOfApp({ values: { webmap: [ID] } })).toBe(ID);
    expect(mapOfApp({ map: { itemId: ID } })).toBe(ID);
    expect(mapOfApp({ dataSources: { a: { type: 'WEB_MAP', itemId: ID } } })).toBe(ID);
    expect(mapOfApp({ widgets: [{ type: 'mapWidget', itemId: ID }] })).toBe(ID);
    expect(mapOfApp({ values: { webmap: 'x' } })).toBeNull();
  });
});

describe('styleOfRenderer', () => {
  it('draws a simple line in its colour and width', () => {
    expect(
      styleOfRenderer({
        type: 'simple',
        symbol: { type: 'esriSLS', color: [255, 115, 223, 255], width: 0.998 },
      }),
    ).toEqual({
      colour: '#ff73df',
      colourField: null,
      colours: [],
      othersShown: true,
      lineWidth: 0.998,
      opacity: 1,
      approximate: false,
    });
  });

  it('takes a CIM line’s solid stroke, not its markers', () => {
    const style = styleOfRenderer({
      type: 'simple',
      symbol: {
        type: 'CIMSymbolReference',
        symbol: {
          type: 'CIMLineSymbol',
          symbolLayers: [
            {
              type: 'CIMVectorMarker',
              enable: true,
              markerGraphics: [
                {
                  symbol: {
                    type: 'CIMLineSymbol',
                    symbolLayers: [
                      {
                        type: 'CIMSolidStroke',
                        enable: true,
                        width: 0.4,
                        color: [34, 37, 242, 255],
                      },
                    ],
                  },
                },
              ],
            },
            { type: 'CIMSolidStroke', enable: false, width: 3, color: [1, 1, 1, 255] },
            { type: 'CIMSolidStroke', enable: true, width: 0.8, color: [104, 104, 104, 255] },
          ],
        },
      },
    });
    expect(style).toMatchObject({ colour: '#686868', lineWidth: 0.8, approximate: false });
  });

  it('falls back to a CIM marker’s colour, and CIM colour objects', () => {
    const style = styleOfRenderer({
      type: 'simple',
      symbol: {
        type: 'CIMSymbolReference',
        symbol: {
          type: 'CIMPointSymbol',
          symbolLayers: [
            {
              type: 'CIMVectorMarker',
              markerGraphics: [
                {
                  symbol: {
                    type: 'CIMPolygonSymbol',
                    symbolLayers: [
                      {
                        type: 'CIMSolidFill',
                        color: { type: 'CIMRGBColor', values: [0, 128, 0, 50] },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    });
    expect(style).toMatchObject({ colour: '#008000', opacity: 0.5, lineWidth: null });
  });

  it('colours by a field’s values, with or without others drawn', () => {
    const renderer = {
      type: 'uniqueValue',
      field1: 'RROWNER1',
      uniqueValueInfos: [
        { value: 'CN', symbol: { type: 'esriSLS', color: [255, 51, 0, 255], width: 2 } },
        { value: 'CPKC', symbol: { type: 'esriSLS', color: [255, 115, 223, 255], width: 2 } },
        { value: 'CN', symbol: { type: 'esriSLS', color: [0, 0, 0, 255], width: 2 } },
      ],
    };
    expect(styleOfRenderer(renderer)).toEqual({
      colour: '#9ca3af',
      colourField: 'RROWNER1',
      colours: [
        ['CN', '#ff3300'],
        ['CPKC', '#ff73df'],
      ],
      othersShown: false,
      lineWidth: 2,
      opacity: 1,
      approximate: false,
    });
    const withDefault = styleOfRenderer({
      ...renderer,
      defaultSymbol: { type: 'esriSLS', color: [153, 153, 153, 255], width: 1 },
    });
    expect(withDefault).toMatchObject({ colour: '#999999', othersShown: true });
  });

  it('reads unique values in groups', () => {
    const style = styleOfRenderer({
      type: 'uniqueValue',
      field1: 'NET',
      uniqueValueGroups: [
        {
          classes: [
            { values: [['M'], ['I']], symbol: { type: 'esriSLS', color: [0, 0, 255, 255] } },
          ],
        },
      ],
    });
    expect(style.colours).toEqual([
      ['M', '#0000ff'],
      ['I', '#0000ff'],
    ]);
  });

  it('shows class breaks, several fields and unknown kinds roughly, in one colour', () => {
    expect(
      styleOfRenderer({
        type: 'classBreaks',
        field: 'TONNES',
        classBreakInfos: [{ symbol: { type: 'esriSLS', color: [10, 20, 30, 255] } }],
      }),
    ).toMatchObject({ colour: '#0a141e', colourField: null, approximate: true });
    expect(
      styleOfRenderer({
        type: 'uniqueValue',
        field1: 'A',
        field2: 'B',
        uniqueValueInfos: [{ value: 'x,y', symbol: { type: 'esriSLS', color: [1, 2, 3] } }],
      }),
    ).toMatchObject({ colour: '#010203', colourField: null, approximate: true });
    expect(styleOfRenderer({ type: 'heatmap' })).toMatchObject({
      colour: '#2f6baa',
      approximate: true,
    });
    expect(styleOfRenderer(null).approximate).toBe(true);
  });

  it('draws areas by their fill, or their outline when unfilled', () => {
    expect(
      styleOfRenderer({
        type: 'simple',
        symbol: {
          type: 'esriSFS',
          color: [0, 0, 0, 0],
          outline: { type: 'esriSLS', color: [200, 0, 0, 255], width: 1.5 },
        },
      }),
    ).toMatchObject({ colour: '#c80000', lineWidth: 1.5, opacity: 1 });
  });

  it('combines the layer’s transparency and opacity with the symbol’s', () => {
    const style = styleOfRenderer(
      { type: 'simple', symbol: { type: 'esriSLS', color: [0, 0, 0, 128] } },
      50,
      0.8,
    );
    expect(style.opacity).toBe(0.201);
    expect(
      styleOfRenderer({ type: 'simple', symbol: { type: 'esriSLS', color: [0, 0, 0, 0] } }, 0, 0)
        .opacity,
    ).toBe(0.05);
  });
});

describe('zoom ranges', () => {
  it('turns ArcGIS scales into Mapbox zooms', () => {
    expect(scaleToZoom(591_657_527.591555)).toBe(0);
    expect(scaleToZoom(2_311_162.217)).toBe(7);
    expect(scaleToZoom(0)).toBeNull();
    expect(scaleToZoom('x')).toBeNull();
    expect(zoomRange(2_311_162.217, 0)).toEqual({ minZoom: 7, maxZoom: null });
    expect(zoomRange(0, 0)).toEqual({ minZoom: null, maxZoom: null });
    // Out of order: never widened to every zoom (neverShown refuses such a layer).
    expect(zoomRange(1000, 2_311_162.217)).toEqual({ minZoom: 18.17, maxZoom: 18.18 });
  });
});

describe('featureSetToGeoJSON', () => {
  it('turns web Mercator lines into longitude and latitude', () => {
    const geojson = featureSetToGeoJSON(
      {
        geometryType: 'esriGeometryPolyline',
        features: [
          {
            attributes: { FID: 1, RROWNER1: 'AMTK' },
            geometry: {
              paths: [
                [
                  [0, 0],
                  [111319.49, 0],
                ],
              ],
            },
          },
          { attributes: { FID: 2 }, geometry: { paths: [[[0, 0]]] } },
        ],
      },
      { wkid: 102100, latestWkid: 3857 },
    );
    expect(geojson?.features).toEqual([
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
        properties: { FID: 1, RROWNER1: 'AMTK' },
      },
    ]);
    expect(normalizeFeatureCollection(geojson).ok).toBe(true);
  });

  it('keeps holes with their outer ring, and points', () => {
    const outer = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ];
    const hole = [
      [2, 2],
      [4, 2],
      [4, 4],
      [2, 4],
      [2, 2],
    ];
    const polygons = featureSetToGeoJSON(
      {
        geometryType: 'esriGeometryPolygon',
        features: [{ geometry: { rings: [outer, hole, outer] } }],
      },
      { wkid: 4326 },
    );
    expect(polygons?.features[0]).toMatchObject({
      geometry: { type: 'MultiPolygon', coordinates: [[outer, hole], [outer]] },
    });
    const points = featureSetToGeoJSON(
      { geometryType: 'esriGeometryPoint', features: [{ geometry: { x: -114, y: 51 } }] },
      { wkid: 4326 },
    );
    expect(points?.features[0]).toMatchObject({
      geometry: { type: 'Point', coordinates: [-114, 51] },
    });
  });

  it('refuses coordinate systems it does not convert', () => {
    expect(featureSetToGeoJSON({ features: [] }, { wkid: 3400 })).toBeNull();
  });
});

const SERVICE = 'https://services.example.com/x/ArcGIS/rest/services/Rail_CPKC/FeatureServer/0';

describe('webMapLayers', () => {
  it('lists a map’s layers bottom to top with their drawing', () => {
    const layers = webMapLayers({
      operationalLayers: [
        {
          layerType: 'ArcGISFeatureLayer',
          title: 'Amtrak Lines',
          opacity: 1,
          featureCollection: {
            layers: [
              {
                layerDefinition: {
                  name: 'Amtrak',
                  geometryType: 'esriGeometryPolyline',
                  extent: { spatialReference: { wkid: 102100 } },
                  drawingInfo: {
                    renderer: {
                      type: 'simple',
                      symbol: { type: 'esriSLS', color: [0, 197, 255, 255] },
                    },
                  },
                },
                featureSet: {
                  geometryType: 'esriGeometryPolyline',
                  features: [
                    {
                      attributes: {},
                      geometry: {
                        paths: [
                          [
                            [0, 0],
                            [1, 1],
                          ],
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          layerType: 'GroupLayer',
          title: 'Railroads',
          opacity: 0.5,
          layers: [
            {
              layerType: 'ArcGISFeatureLayer',
              title: 'Canadian Pacific / Kansas City',
              url: `${SERVICE}?token=x`,
              itemId: 'a'.repeat(32),
              minScale: 2_311_162.217,
              layerDefinition: {
                definitionExpression: "NET IN ('M','I')",
                drawingInfo: { renderer: { type: 'simple' }, transparency: 20 },
              },
            },
          ],
        },
        { layerType: 'VectorTileLayer', title: 'Basemap labels' },
        {
          layerType: 'ArcGISFeatureLayer',
          title: 'Bad filter',
          url: SERVICE,
          layerDefinition: { definitionExpression: '1=1; drop table x' },
        },
        {
          layerType: 'ArcGISMapServiceLayer',
          title: 'Elevation',
          url: 'https://services.example.com/x/rest/services/Elevation/MapServer',
        },
        {
          layerType: 'WMS',
          title: 'Weather',
          url: 'https://geo.example.ca/geomet?service=WMS',
          layers: [{ name: 'RADAR_1KM_RRAI' }],
        },
      ],
    });
    expect(layers.map((l) => [l.title, l.kind, l.problem])).toEqual([
      ['Amtrak Lines', 'file', null],
      ['Canadian Pacific / Kansas City', 'arcgis_features', null],
      ['Basemap labels', null, 'GSS does not take ArcGIS’s vector tile layers yet.'],
      ['Bad filter', null, 'Its filter on ArcGIS is not one GSS can send.'],
      ['Elevation', 'arcgis_image', null],
      ['Weather', 'wms', null],
    ]);
    const cpkc = layers[1];
    expect(cpkc).toMatchObject({
      url: SERVICE,
      itemId: 'a'.repeat(32),
      layerIndex: 0,
      opacity: 0.5,
      transparency: 20,
      definitionExpression: "NET IN ('M','I')",
      minScale: 2_311_162.217,
    });
    expect(normalizeFeatureCollection(layers[0]?.collection).ok).toBe(true);
    expect(layers[5]?.wmsLayers).toBe('RADAR_1KM_RRAI');
  });

  it('gives nothing for a map without layers', () => {
    expect(webMapLayers({})).toEqual([]);
    expect(webMapLayers(null)).toEqual([]);
  });
});

describe('itemLayerDrawing', () => {
  it('takes the item’s drawing of the layer by its number', () => {
    const data = {
      layers: [
        {
          id: 0,
          layerDefinition: {
            drawingInfo: {
              renderer: {
                type: 'simple',
                symbol: { type: 'esriSLS', color: [153, 153, 153, 255] },
              },
            },
            minScale: 0,
          },
        },
      ],
    };
    expect(itemLayerDrawing(data, 0)?.renderer).toMatchObject({ type: 'simple' });
    expect(itemLayerDrawing(data, 5)?.renderer).toMatchObject({ type: 'simple' });
    expect(itemLayerDrawing({ layers: [] }, 0)).toBeNull();
    expect(itemLayerDrawing(null, 0)).toBeNull();
  });
});

describe('whereOf with a map’s filter', () => {
  it('combines the publisher’s filter with the layer’s limit', () => {
    expect(whereOf({ onlyField: null, onlyValues: [], definitionExpression: "STATE = 'TX'" })).toBe(
      "(STATE = 'TX')",
    );
    expect(
      whereOf({ onlyField: 'NET', onlyValues: ['M'], definitionExpression: "STATE = 'TX'" }),
    ).toBe("(STATE = 'TX') AND NET IN ('M')");
    expect(whereOf({ onlyField: null, onlyValues: [], definitionExpression: '1=1; x' })).toBe(
      '1=0',
    );
    expect(DEFINITION_EXPRESSION.test('a -- b')).toBe(false);
    expect(DEFINITION_EXPRESSION.test('a /* b')).toBe(false);
    expect(DEFINITION_EXPRESSION.test("NET IN ('M','I')")).toBe(true);
  });
});

describe('Codex’s review of 1f328f9', () => {
  it('refuses a filter that could undo the layer’s limit, wherever it is checked', () => {
    expect(balancedFilter("NET IN ('M','I')")).toBe(true);
    expect(balancedFilter("NAME = 'a)' AND (X = 1)")).toBe(true);
    expect(balancedFilter("NAME = 'it''s'")).toBe(true);
    for (const bad of ['1=1) OR (1=1', '(1=1', "NAME = 'a", ')(']) {
      expect(balancedFilter(bad)).toBe(false);
      expect(safeFilter(bad)).toBe(false);
      expect(whereOf({ onlyField: 'NET', onlyValues: ['M'], definitionExpression: bad })).toBe(
        '1=0',
      );
    }
    expect(safeFilter('1=1\u0085')).toBe(false);
  });

  it('strips markup in time growing with the length, not its square', () => {
    expect(withoutTags('a<b>c<d')).toBe('a c<d');
    expect(withoutTags('<<<x>y')).toBe(' y');
    const hostile = '<'.repeat(2_000_000);
    const started = Date.now();
    expect(arcgisPlainText(hostile, 200)?.length).toBeLessThanOrEqual(200);
    expect(withoutTags(hostile)).toHaveLength(hostile.length);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('does not add a layer whose filter it cannot keep', () => {
    const fc = {
      layers: [
        {
          layerDefinition: {
            geometryType: 'esriGeometryPoint',
            definitionExpression: "STATE = 'TX'",
            extent: { spatialReference: { wkid: 4326 } },
          },
          featureSet: { features: [{ geometry: { x: 1, y: 2 } }] },
        },
      ],
    };
    const [kept] = webMapLayers({
      operationalLayers: [{ layerType: 'ArcGISFeatureLayer', title: 'F', featureCollection: fc }],
    });
    expect(kept).toMatchObject({ kind: null, collection: null });
    expect(kept?.problem).toMatch(/filter GSS cannot apply/);
    const own = itemLayerDrawing(
      { layers: [{ id: 0, layerDefinition: { definitionExpression: '1=1) OR (1=1' } }] },
      0,
    );
    expect(own).toMatchObject({ definitionExpression: null, definitionRefused: true });
    expect(
      itemLayerDrawing({ layers: [{ id: 0, layerDefinition: {} }] }, 0)?.definitionRefused,
    ).toBe(false);
  });

  it('puts each hole in the outer ring around it, in any order', () => {
    const square = (x: number, y: number, size: number, clockwise: boolean) => {
      const ring = [
        [x, y],
        [x, y + size],
        [x + size, y + size],
        [x + size, y],
        [x, y],
      ];
      return clockwise ? ring : ring.reverse();
    };
    const a = square(0, 0, 10, true);
    const b = square(20, 0, 10, true);
    const holeInA = square(2, 2, 2, false);
    const result = featureSetToGeoJSON(
      { geometryType: 'esriGeometryPolygon', features: [{ geometry: { rings: [holeInA, a, b] } }] },
      { wkid: 4326 },
    );
    expect(result?.features[0]).toMatchObject({
      geometry: { type: 'MultiPolygon', coordinates: [[a, holeInA], [b]] },
    });
  });

  it('keeps a group’s zoom range for its layers', () => {
    const [inGroup] = webMapLayers({
      operationalLayers: [
        {
          layerType: 'GroupLayer',
          minScale: 2_311_162.217,
          maxScale: 1000,
          layers: [
            {
              layerType: 'ArcGISFeatureLayer',
              title: 'L',
              url: SERVICE,
              minScale: 5_000_000,
            },
          ],
        },
      ],
    });
    // The group's narrower outward limit wins; its inward limit applies.
    expect(inGroup).toMatchObject({ minScale: 2_311_162.217, maxScale: 1000 });
  });
});

describe('Codex’s re-review of 1a5f81c', () => {
  it('refuses quoting that could hide a parenthesis', () => {
    const dollar = '$'.repeat(2);
    for (const bad of [
      `${dollar}(${dollar} IS NOT NULL) OR (${dollar})${dollar} IS NOT NULL`,
      '"a(" = 1',
      "E'\\'' = 1",
      '[a(] = 1',
      '`a(` = 1',
      'a = 1 # (',
      '{fn x()}',
    ]) {
      expect(safeFilter(bad)).toBe(false);
    }
    for (const good of [
      "NET IN ('M','I')",
      "NAME LIKE 'Québec%' AND MILES >= 2.5",
      "UPDATED > DATE '2024-01-01'",
    ]) {
      expect(safeFilter(good)).toBe(true);
    }
  });

  it('puts an island’s hole in the island, not the shell around it', () => {
    const square = (x: number, size: number, clockwise: boolean) => {
      const ring = [
        [x, x],
        [x, x + size],
        [x + size, x + size],
        [x + size, x],
        [x, x],
      ];
      return clockwise ? ring : ring.reverse();
    };
    const shell = square(0, 100, true);
    const hole = square(10, 80, false);
    const island = square(20, 60, true);
    const islandHole = square(40, 10, false);
    const result = featureSetToGeoJSON(
      {
        geometryType: 'esriGeometryPolygon',
        features: [{ geometry: { rings: [shell, hole, island, islandHole] } }],
      },
      { wkid: 4326 },
    );
    expect(result?.features[0]).toMatchObject({
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [shell, hole],
          [island, islandHole],
        ],
      },
    });
  });

  it('knows a layer ArcGIS never draws', () => {
    expect(neverShown(10_000, 100_000)).toBe(true);
    expect(neverShown(100_000, 10_000)).toBe(false);
    expect(neverShown(null, 10_000)).toBe(false);
    const [layer] = webMapLayers({
      operationalLayers: [
        {
          layerType: 'GroupLayer',
          minScale: 10_000,
          layers: [
            { layerType: 'ArcGISFeatureLayer', title: 'L', url: SERVICE, maxScale: 100_000 },
          ],
        },
      ],
    });
    expect(neverShown(layer?.minScale ?? null, layer?.maxScale ?? null)).toBe(true);
  });
});

describe('Codex’s re-review of 813c5b6', () => {
  it('refuses a quote opened right after a letter (Oracle’s q quoting and the like)', () => {
    for (const bad of [
      "q'!'('!' IS NOT NULL) OR (q'!')'!' IS NOT NULL",
      "N'a(' = 1",
      "x_'a' = 1",
    ]) {
      expect(balancedFilter(bad)).toBe(false);
      expect(safeFilter(bad)).toBe(false);
    }
    expect(safeFilter("NAME = 'it''s' AND NET IN('M')")).toBe(true);
  });

  it('puts a hole touching its outer ring at a corner in that ring', () => {
    const shell = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ];
    const hole = [
      [10, 5],
      [8, 6],
      [8, 4],
      [10, 5],
    ];
    const other = [
      [20, 0],
      [20, 10],
      [30, 10],
      [30, 0],
      [20, 0],
    ];
    const result = featureSetToGeoJSON(
      {
        geometryType: 'esriGeometryPolygon',
        features: [{ geometry: { rings: [shell, hole, other] } }],
      },
      { wkid: 4326 },
    );
    expect(result?.features[0]).toMatchObject({
      geometry: { type: 'MultiPolygon', coordinates: [[shell, hole], [other]] },
    });
  });

  it('keeps a range narrower than the zooms’ rounding narrow', () => {
    expect(neverShown(100_001, 100_000)).toBe(false);
    const range = zoomRange(100_001, 100_000);
    expect(range.minZoom).not.toBeNull();
    expect(range.maxZoom).not.toBeNull();
    expect((range.maxZoom ?? 0) - (range.minZoom ?? 0)).toBeCloseTo(0.01);
  });
});
