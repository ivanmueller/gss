import {
  FILTER_REFUSED,
  itemLayerDrawing,
  itemTerms,
  mapOfApp,
  neverShown,
  MAP_LAYER_KIND_LABELS,
  normalizeFeatureCollection,
  OVERVIEW_BELOW_ZOOM,
  parseArcgisMapLink,
  readItemInfo,
  styleOfRenderer,
  webMapLayers,
  zoomRange,
  type ArcgisItemInfo,
  type LayerFeatureCollection,
  type LayerInspection,
  type LayerStyle,
  type MapLayerKind,
} from '@grain/domain';
import { useId, useState, type SubmitEvent } from 'react';

import { sendJson } from '../lib/api';
import { message, prepareWithProgress, takesOverview } from '../lib/mapLayerPrepare';
import { forgetApiAnswers } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';

// Layers from an ArcGIS map, presented as ArcGIS presents them (the owner's request and answers
// of 2026-11-08, F-138). An admin pastes a map's link; the Worker reads the map from ArcGIS
// Online; each of its layers is listed with ArcGIS's drawing (its colours, line width, opacity
// and zoom range, from the map, else the layer's own item, else its service) and added as a GSS
// layer, bottom to top, so the Layers panel lists them under the map's title in ArcGIS's order.
// Live lines layers then get their zoomed-out views, one after another.

/** One of the map's layers as it will be added. */
interface PlannedLayer {
  key: string;
  title: string;
  kind: MapLayerKind | null;
  url: string | null;
  wmsLayers: string | null;
  collection: LayerFeatureCollection | null;
  style: LayerStyle;
  minZoom: number | null;
  maxZoom: number | null;
  definitionExpression: string | null;
  /** How many pieces (a live layer) or shapes (a layer kept in the map). */
  count: number | null;
  /** Why it is not added. */
  problem: string | null;
}

interface Plan {
  map: ArcgisItemInfo;
  /** Bottom to top, as ArcGIS draws them. */
  layers: PlannedLayer[];
}

interface Added {
  title: string;
  id: string;
  planned: PlannedLayer;
}

function readItem(
  token: string,
  query: string,
  itemId: string,
  part: 'info' | 'data',
): Promise<unknown> {
  return sendJson<unknown>(`/map-layers/arcgis-item${query}`, token, 'POST', { itemId, part });
}

/** The map an item is, or the map an app item shows; an error message otherwise. */
async function findMap(
  token: string,
  query: string,
  itemId: string,
): Promise<{ info: ArcgisItemInfo; data: unknown } | string> {
  const info = readItemInfo(await readItem(token, query, itemId, 'info'));
  if (!info) return 'ArcGIS did not give this map. It may be private or removed.';
  const data = await readItem(token, query, itemId, 'data');
  if (info.type === 'Web Map') return { info, data };
  const shown = mapOfApp(data);
  if (shown === null) {
    return `This ArcGIS item is a ${info.type}, not a map. Open the map itself and copy its link.`;
  }
  const mapInfo = readItemInfo(await readItem(token, query, shown, 'info'));
  if (mapInfo?.type !== 'Web Map') return 'ArcGIS did not give the map this app shows.';
  return { info: mapInfo, data: await readItem(token, query, shown, 'data') };
}

/**
 * Each of a map's layers with ArcGIS's drawing: the map's, else its own item's, else its
 * service's; and how many pieces it has.
 */
async function planLayers(
  token: string,
  query: string,
  data: unknown,
  say: (text: string) => void,
): Promise<PlannedLayer[]> {
  const found = webMapLayers(data);
  const itemData = new Map<string, unknown>();
  const planned: PlannedLayer[] = [];
  for (const [i, layer] of found.entries()) {
    say(`Reading layer ${String(i + 1)} of ${String(found.length)}: ${layer.title}…`);
    const base = {
      key: `${String(i)}-${layer.title}`,
      title: layer.title,
      kind: layer.kind,
      url: layer.url,
      wmsLayers: layer.wmsLayers,
      collection: null,
      definitionExpression: layer.definitionExpression,
      count: null,
      problem: layer.problem,
    };
    if (layer.kind === null) {
      planned.push({ ...base, style: styleOfRenderer(null), minZoom: null, maxZoom: null });
      continue;
    }
    let renderer = layer.renderer;
    let transparency = layer.transparency;
    let { minScale, maxScale } = layer;
    let { definitionExpression } = layer;
    let fields: string[] | null = null;
    let count: number | null = null;
    let collection: LayerFeatureCollection | null = null;
    let problem: string | null = null;
    try {
      if (layer.kind === 'file') {
        const checked = normalizeFeatureCollection(layer.collection);
        if (checked.ok) {
          collection = checked.collection;
          count = checked.collection.features.length;
        } else problem = checked.message;
      } else {
        // The layer's own item gives its drawing and filter where the map gives none, as on
        // ArcGIS; it is read even when the map has a drawing, for its filter (Codex's review of
        // 1f328f9: a filter dropped there widened the layer).
        if (layer.itemId !== null) {
          if (!itemData.has(layer.itemId)) {
            itemData.set(layer.itemId, await readItem(token, query, layer.itemId, 'data'));
          }
          const own = itemLayerDrawing(itemData.get(layer.itemId), layer.layerIndex);
          if (own) {
            if (renderer === null || renderer === undefined) {
              renderer = own.renderer;
              transparency = own.transparency;
            }
            minScale ??= own.minScale;
            maxScale ??= own.maxScale;
            if (definitionExpression === null && own.definitionRefused) problem = FILTER_REFUSED;
            definitionExpression ??= own.definitionExpression;
          }
        }
        if (layer.kind !== 'wms' && layer.url !== null) {
          const inspection = await sendJson<LayerInspection>(
            `/map-layers/inspect${query}`,
            token,
            'POST',
            { url: layer.url, field: null },
          );
          // Last, the service's own drawing.
          if (renderer === null || renderer === undefined) {
            renderer = inspection.drawing?.renderer ?? null;
            transparency = inspection.drawing?.transparency ?? 0;
          }
          minScale ??= inspection.drawing?.minScale ?? null;
          maxScale ??= inspection.drawing?.maxScale ?? null;
          fields = inspection.fields;
          count = inspection.count;
        }
      }
    } catch (reason) {
      problem = `Its service did not answer: ${message(reason, 'no answer.')}`;
    }
    let style = styleOfRenderer(renderer, transparency, layer.opacity);
    // Coloured by a field the service does not give: one colour, shown roughly.
    if (style.colourField !== null && fields !== null && !fields.includes(style.colourField)) {
      style = { ...style, colourField: null, colours: [], othersShown: true, approximate: true };
    }
    if (layer.kind !== 'arcgis_features' && layer.kind !== 'file') {
      style = { ...style, colourField: null, colours: [], othersShown: true };
    }
    planned.push({
      ...base,
      collection,
      style,
      ...zoomRange(minScale, maxScale),
      definitionExpression: layer.kind === 'arcgis_features' ? definitionExpression : null,
      count,
      problem,
      // A layer ArcGIS never draws is not added drawn at every zoom (Codex's re-review of
      // 1a5f81c).
      ...(neverShown(minScale, maxScale) && {
        kind: null,
        problem: 'ArcGIS never shows it: its zoom range and its group’s do not overlap.',
      }),
    });
  }
  return planned;
}

/** The colour swatch of a planned layer: its first colours, or its one colour. */
function Swatch({ style }: { style: LayerStyle }) {
  const colours =
    style.colours.length > 0 ? style.colours.slice(0, 4).map(([, c]) => c) : [style.colour];
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-0.5">
      {colours.map((colour, i) => (
        <span
          key={`${colour}-${String(i)}`}
          className="h-1.5 w-4 rounded-full"
          style={{ backgroundColor: colour, opacity: style.opacity }}
        />
      ))}
    </span>
  );
}

function plannedDetails(layer: PlannedLayer): string {
  const parts: string[] = [layer.kind ? MAP_LAYER_KIND_LABELS[layer.kind] : 'Not added'];
  if (layer.count !== null) {
    parts.push(
      `${layer.count.toLocaleString('en-CA')} ${layer.kind === 'file' ? 'shapes, kept in the map' : 'pieces'}`,
    );
  }
  if (layer.style.colourField !== null) {
    parts.push(
      `coloured by ${layer.style.colourField} (${layer.style.colours.length.toLocaleString('en-CA')} values)`,
    );
  }
  if (layer.definitionExpression !== null) parts.push(`only where ${layer.definitionExpression}`);
  if (layer.minZoom !== null || layer.maxZoom !== null) {
    parts.push(
      `shown ${layer.minZoom !== null ? `from zoom ${String(layer.minZoom)}` : ''}${layer.minZoom !== null && layer.maxZoom !== null ? ' ' : ''}${layer.maxZoom !== null ? `up to zoom ${String(layer.maxZoom)}` : ''}`,
    );
  }
  return parts.join(' · ');
}

/** Team → Map layers → Add map layer → ArcGIS map. */
export function ImportArcgisMapForm({
  session,
  onAdded,
}: {
  session: DirectorySession;
  onAdded: () => void;
}) {
  const { token, organization } = session;
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const query = `?organization_id=${organization.id}`;
  const [link, setLink] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const [sourceName, setSourceName] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [termsNote, setTermsNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [finished, setFinished] = useState<string[] | null>(null);

  function read() {
    const parsed = parseArcgisMapLink(link);
    if (!parsed.ok) {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    setPlan(null);
    setBusy('Reading the map from ArcGIS…');
    void (async () => {
      try {
        const found = await findMap(token, query, parsed.itemId);
        if (typeof found === 'string') {
          setProblem(found);
          return;
        }
        const layers = await planLayers(token, query, found.data, setBusy);
        if (layers.length === 0) {
          setProblem('This map has no layers of its own (only a basemap).');
          return;
        }
        const terms = itemTerms(found.info);
        setSourceName(terms.sourceName);
        setTermsUrl(terms.termsUrl);
        setTermsNote(terms.termsNote);
        setSkipped(new Set());
        setPlan({ map: found.info, layers });
      } catch (reason) {
        setProblem(message(reason, 'The map could not be read.'));
      } finally {
        setBusy(null);
      }
    })();
  }

  const addable = plan?.layers.filter((l) => l.kind !== null && l.problem === null) ?? [];
  const chosen = addable.filter((l) => !skipped.has(l.key));

  function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || chosen.length === 0) return;
    setProblem(null);
    void (async () => {
      const added: Added[] = [];
      const notes: string[] = [];
      try {
        // Bottom to top, so they are drawn and listed in ArcGIS's order.
        for (const [i, layer] of chosen.entries()) {
          setBusy(`Adding layer ${String(i + 1)} of ${String(chosen.length)}: ${layer.title}…`);
          const common = {
            name: layer.title,
            sourceName: sourceName.trim(),
            termsUrl: termsUrl.trim(),
            termsNote: termsNote.trim(),
            colour: layer.style.colour,
            colourField: layer.style.colourField,
            colours: layer.style.colours,
            alsoFields: [],
            onlyField: null,
            onlyValues: [],
            lineWidth: layer.style.lineWidth,
            opacity: layer.style.opacity,
            minZoom: layer.minZoom,
            maxZoom: layer.maxZoom,
            othersShown: layer.style.othersShown,
            map: { itemId: plan.map.id, title: plan.map.title },
          };
          const body =
            layer.kind === 'file'
              ? {
                  ...common,
                  source: 'file',
                  fileName: `${layer.title} (kept in the ArcGIS map)`.slice(0, 200),
                  geojson: layer.collection,
                }
              : {
                  ...common,
                  source: 'web',
                  url: layer.url,
                  wmsLayers: layer.wmsLayers,
                  definitionExpression: layer.definitionExpression,
                };
          try {
            const { id: layerId } = await sendJson<{ id: string }>(
              `/map-layers${query}`,
              token,
              'POST',
              body,
            );
            added.push({ title: layer.title, id: layerId, planned: layer });
          } catch (reason) {
            notes.push(`${layer.title} was not added: ${message(reason, 'no answer.')}`);
          }
        }
        forgetApiAnswers('/map-layers');
        // Each live lines layer shown zoomed out gets its zoomed-out view (F-134).
        const live = added.filter(
          (a) =>
            a.planned.kind !== null &&
            takesOverview(a.planned.kind) &&
            (a.planned.minZoom === null || a.planned.minZoom < OVERVIEW_BELOW_ZOOM),
        );
        for (const [i, layer] of live.entries()) {
          const failed = await prepareWithProgress(
            {
              id: layer.id,
              colourField: layer.planned.style.colourField,
              alsoFields: [],
              onlyField: null,
              onlyValues: [],
            },
            token,
            (text) => {
              setBusy(`${layer.title} (${String(i + 1)} of ${String(live.length)}): ${text}`);
            },
          );
          if (failed !== null) {
            notes.push(
              `${layer.title}: its zoomed-out view could not be prepared (${failed}) Try again with Prepare zoomed-out view in the list.`,
            );
          }
        }
        forgetApiAnswers('/map-layers');
      } finally {
        setBusy(null);
      }
      if (notes.length === 0) onAdded();
      else {
        setFinished([
          `${String(added.length)} of ${String(chosen.length)} layers were added.`,
          ...notes,
        ]);
      }
    })();
  }

  if (finished !== null) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <div role="alert" className="flex flex-col gap-1 text-warning">
          {finished.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={onAdded}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={add}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={field('link')} className="font-medium">
          ArcGIS map link
        </label>
        <div className="flex gap-2">
          <Input
            id={field('link')}
            value={link}
            placeholder="https://www.arcgis.com/apps/mapviewer/index.html?webmap=…"
            onChange={(event) => {
              setLink(event.target.value);
              setPlan(null);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null || link.trim() === ''}
            onClick={read}
          >
            Read map
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The map’s link from ArcGIS (Share, or the address bar while the map is open), or its item
          page. Each of its layers is added as ArcGIS shows it: its colours, line widths, opacity
          and the zooms it shows at.
        </p>
      </div>

      {plan && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">{plan.map.title}</span>
            <p className="text-xs text-muted-foreground">
              Its layers, top first as ArcGIS lists them. Untick any you do not want.
            </p>
            <ul
              aria-label="The map’s layers"
              className="flex flex-col divide-y rounded-card border"
            >
              {[...plan.layers].reverse().map((layer) => {
                const takes = layer.kind !== null && layer.problem === null;
                return (
                  <li key={layer.key} className="flex flex-col gap-0.5 px-3 py-2">
                    <label
                      className={`flex items-center gap-2 ${takes ? 'cursor-pointer' : 'text-muted-foreground'}`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        disabled={!takes}
                        checked={takes && !skipped.has(layer.key)}
                        onChange={() => {
                          setSkipped((current) => {
                            const next = new Set(current);
                            if (next.has(layer.key)) next.delete(layer.key);
                            else next.add(layer.key);
                            return next;
                          });
                        }}
                      />
                      {takes && <Swatch style={layer.style} />}
                      <span className="truncate">{layer.title}</span>
                    </label>
                    <span className="pl-6 text-xs text-muted-foreground">
                      {layer.problem ?? plannedDetails(layer)}
                    </span>
                    {takes && layer.style.approximate && (
                      <span className="pl-6 text-xs text-warning">
                        ArcGIS draws this in a way GSS shows only roughly (in one colour, or its own
                        colours without patterns or symbols).
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('source')} className="font-medium">
              Source
            </label>
            <Input
              id={field('source')}
              value={sourceName}
              onChange={(event) => {
                setSourceName(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('terms')} className="font-medium">
              Terms of use (link)
            </label>
            <Input
              id={field('terms')}
              value={termsUrl}
              onChange={(event) => {
                setTermsUrl(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={field('note')} className="font-medium">
              What the terms allow
            </label>
            <Textarea
              id={field('note')}
              rows={3}
              value={termsNote}
              onChange={(event) => {
                setTermsNote(event.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              From the map’s ArcGIS page. Check it allows GSS’s use before adding.
            </p>
          </div>
        </>
      )}

      {busy && (
        <p role="status" className="text-muted-foreground">
          {busy}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      {plan && (
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={
              busy !== null ||
              chosen.length === 0 ||
              sourceName.trim() === '' ||
              termsUrl.trim() === '' ||
              termsNote.trim() === ''
            }
          >
            Add {chosen.length} {chosen.length === 1 ? 'layer' : 'layers'}
          </Button>
        </div>
      )}
    </form>
  );
}
