import type { LayerLegend, MapLayerList, MapLayerView } from '@grain/domain';
import { ChevronDown, ChevronRight, Layers, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import { useLayerApi } from '../lib/layerApi';
import {
  ALL_VALUES,
  choiceOf,
  OBJECT_ID,
  useDefaultLayerChoice,
  useLayerChoice,
  useLayerOverlays,
  useValueChoices,
  valueShown,
  type MapOverlay,
  type MapView,
  type PickedFeature,
  type StaleReason,
  type ValueChoice,
} from '../lib/mapLayers';
import { signedInAs, useApiResource } from '../lib/useApiResource';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';

// Map layers on the Workspace map and Counterparties → map view (F-107, the owner's answers of
// 2026-11-07): admins add them on Team; each person switches them on and off in the Layers panel
// over the map, several at once, and within a layer coloured by a field each value too (each
// railroad, F-133), and clicks a shape to see its details. Each layer's source is credited under
// the map.

/** How many of a layer's colours the legend shows before "and N more". */
const LEGEND_VALUES = 8;

export interface MapLayersState {
  /** The person's sign-in, for a picture layer's legend (F-141). */
  token: string;
  layers: MapLayerView[];
  chosen: ReadonlySet<string>;
  toggle: (id: string) => void;
  /** Switches several layers on or off at once (a map's layers, F-138). */
  setMany: (ids: readonly string[], on: boolean) => void;
  /** Each layer's values this person shows; a layer not listed shows all. */
  values: Readonly<Record<string, ValueChoice>>;
  /** Sets a layer's choice; the layer's own (layerDefault) is forgotten rather than kept. */
  setValues: (id: string, choice: ValueChoice, layerDefault?: ValueChoice) => void;
  /** Whether the Layers panel is open. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  overlays: MapOverlay[];
  notes: Map<string, string>;
  onViewChange: (bbox: MapView['bbox'] | null, zoom: number) => void;
  picked: PickedFeature | null;
  setPicked: (picked: PickedFeature | null) => void;
  error: string | null;
  /** Reads the list again, after an admin changed it elsewhere on the page (F-247-2-D1-03). */
  reload?: () => void;
  /**
   * The server refused a layer's data or no longer has the layer (a square, a picture, a
   * shape's details): the list is read again, at most once every few seconds, and the map draws
   * only what it holds (F-247-2-R9-01, R9-02).
   */
  onStale?: (reason?: StaleReason) => void;
  /**
   * Bumped when the list is read well again after a refusal: the map asks again for the squares
   * and pictures the refusal let go (F-247-2-R12-02).
   */
  retry?: number;
}

/** The list of layers is read again at most this often on the server's refusals. */
const STALE_RELOAD_MS = 10_000;
/**
 * After a refusal or a "not found", a list read well again has the map ask again for what it let
 * go, at most this often: a layer that is listed yet keeps answering "not found" is asked for
 * once a minute at most, not in a tight circle. A request to ask again that comes sooner is
 * kept and done when the minute ends (F-247-2-R14-01).
 */
const ASK_AGAIN_MS = 60_000;

/** The organization's map layers, the ones this person has on, and their features in view. */
export function useMapLayers(
  session: { token: string; organization: { id: string } } | null,
): MapLayersState {
  const token = session?.token ?? '';
  const api = useLayerApi();
  const [list, reload] = useApiResource<MapLayerList>(
    session ? api.path(`?organization_id=${session.organization.id}`) : null,
    token,
  );
  const listed = useMemo(
    () => (list.status === 'ok' && Array.isArray(list.data.layers) ? list.data.layers : []),
    [list],
  );
  // The same list read again is the same layers to the map: nothing is asked for or drawn again
  // unless something in it changed (so a re-read after a refusal cannot set off another).
  const [layers, setLayers] = useState(listed);
  const changed = useMemo(
    () => layers !== listed && JSON.stringify(layers) !== JSON.stringify(listed),
    [layers, listed],
  );
  if (changed) setLayers(listed);
  // Both are kept (hooks run always); which one counts depends on the list (F-247).
  const remembered = useLayerChoice(token);
  const fromDefault = useDefaultLayerChoice(layers);
  const [chosen, toggle, setMany] = api.adminDefault ? fromDefault : remembered;
  const on = useMemo(() => layers.filter((layer) => chosen.has(layer.id)), [layers, chosen]);
  const [values, setValues] = useValueChoices(token, !api.adminDefault);
  const [view, setView] = useState<MapView | null>(null);
  const lastStale = useRef(0);
  const laterStale = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAfter = useRef(false);
  const lastRetry = useRef(0);
  const laterRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retry, setRetry] = useState(0);
  const onStale = useCallback(
    (reason?: StaleReason) => {
      // Refused, or "not found" (how grain's database answers a suspended member for a layer's
      // squares): either way, if the list is then read well, the map asks again
      // (F-247-2-R12-02). Not when it is only the map moving after a refused list.
      if (reason !== undefined) retryAfter.current = true;
      // Not on every refused square of one view: once at once, and, for a refusal that comes
      // during the pause after it, once more when the pause ends, so a later change (a second
      // layer removed) is never missed (F-247-2-R10-01).
      const wait = lastStale.current + STALE_RELOAD_MS - Date.now();
      if (wait <= 0) {
        lastStale.current = Date.now();
        reload();
        return;
      }
      laterStale.current ??= setTimeout(() => {
        laterStale.current = null;
        lastStale.current = Date.now();
        reload();
      }, wait);
    },
    [reload],
  );
  useEffect(
    () => () => {
      if (laterStale.current) clearTimeout(laterStale.current);
      if (laterRetry.current) clearTimeout(laterRetry.current);
    },
    [],
  );
  const listRefused = list.status === 'error';
  // The list read well again after a refusal or a "not found" (access is back, perhaps with the
  // very same layers): what was let go is asked for again, the map standing still. At most once
  // a minute; a second time within the minute waits for its end, and is not lost.
  useEffect(() => {
    if (list.status !== 'ok' || !retryAfter.current) return;
    retryAfter.current = false;
    const askAgain = () => {
      lastRetry.current = Date.now();
      setRetry((n) => n + 1);
    };
    const wait = lastRetry.current + ASK_AGAIN_MS - Date.now();
    if (wait <= 0) {
      askAgain();
      return;
    }
    laterRetry.current ??= setTimeout(() => {
      laterRetry.current = null;
      askAgain();
    }, wait);
  }, [list]);
  const { overlays, notes } = useLayerOverlays(on, view, token, values, onStale, retry);
  const [picked, setPicked] = useState<PickedFeature | null>(null);
  // A clicked shape's details go with its layer: switched off or no longer in the list, they are
  // forgotten, not hidden, so nothing of them shows when the layer is switched back on
  // (F-247-2-R9-03).
  if (picked && !on.some((layer) => layer.id === picked.layerId)) setPicked(null);
  const [panelOpen, setPanelOpen] = useState(false);
  return {
    token,
    layers,
    chosen,
    toggle,
    setMany,
    values,
    setValues,
    panelOpen,
    setPanelOpen,
    overlays,
    notes,
    onViewChange: (bbox, zoom) => {
      setView(bbox ? { bbox, zoom } : null);
      // The list could not be read (not a member, signed out, the server away): with no layers
      // nothing else would ask again, so moving the map does, and a member whose access is back
      // sees their layers without reloading the page (F-247-2-R9-01).
      if (listRefused) onStale();
    },
    picked: picked && on.some((layer) => layer.id === picked.layerId) ? picked : null,
    setPicked,
    error: list.status === 'error' ? list.error.message : null,
    reload,
    onStale,
    retry,
  };
}

/** The Layers button: opens and closes the Layers panel over the map. */
export function MapLayersButton({ state }: { state: MapLayersState }) {
  const count = state.layers.filter((layer) => state.chosen.has(layer.id)).length;
  return (
    <Button
      variant={state.panelOpen ? 'secondary' : 'outline'}
      size="sm"
      aria-expanded={state.panelOpen}
      onClick={() => {
        state.setPanelOpen(!state.panelOpen);
      }}
    >
      <Layers aria-hidden="true" />
      Layers{count > 0 ? ` (${String(count)})` : ''}
    </Button>
  );
}

/** A layer's values with a tick box each, a search, Show all and Hide all (F-133). */
function LayerValues({
  layer,
  choice,
  onChange,
}: {
  layer: MapLayerView;
  choice: ValueChoice;
  onChange: (choice: ValueChoice) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const listed = layer.colours.map(([value]) => value);
  const term = search.trim().toLowerCase();
  const matches =
    term === '' ? layer.colours : layer.colours.filter(([v]) => v.toLowerCase().includes(term));
  const shownCount = choice.shown === null ? listed.length : choice.shown.length;

  function toggle(value: string) {
    const shown = choice.shown ?? listed;
    const next = shown.includes(value) ? shown.filter((v) => v !== value) : [...shown, value];
    onChange({ ...choice, shown: next.length === listed.length ? null : next });
  }

  return (
    <div className="flex flex-col gap-2 pt-2 pl-6">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label={`Search ${layer.name}`}
          value={search}
          placeholder={`Search ${layer.colourField ?? ''}`}
          className="h-8 pl-7 text-xs"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {shownCount.toLocaleString('en-CA')} of {listed.length.toLocaleString('en-CA')} shown
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() => {
            onChange(ALL_VALUES);
          }}
        >
          Show all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => {
            onChange({ shown: [], others: false });
          }}
        >
          Hide all
        </Button>
      </div>
      <ul aria-label={`${layer.name}: values`} className="max-h-64 overflow-y-auto pr-1 text-xs">
        {matches.map(([value, colour]) => (
          <li key={value}>
            <label className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-0.5 hover:bg-accent">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={valueShown(choice, value)}
                onChange={() => {
                  toggle(value);
                }}
              />
              <span
                aria-hidden="true"
                className="h-1 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: colour }}
              />
              <span className="truncate">{value}</span>
            </label>
          </li>
        ))}
        {term === '' && (
          <li>
            <label
              htmlFor={`${id}-others`}
              className="flex cursor-pointer items-center gap-2 rounded-xs px-1 py-0.5 hover:bg-accent"
            >
              <input
                id={`${id}-others`}
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={choice.others}
                onChange={() => {
                  onChange({ ...choice, others: !choice.others });
                }}
              />
              <span
                aria-hidden="true"
                className="h-1 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: layer.colour }}
              />
              <span className="text-muted-foreground">Other values</span>
            </label>
          </li>
        )}
        {matches.length === 0 && <li className="px-1 py-0.5 text-muted-foreground">No match.</li>}
      </ul>
    </div>
  );
}

type PanelEntry =
  | { kind: 'layer'; layer: MapLayerView }
  | { kind: 'map'; itemId: string; title: string; layers: MapLayerView[] };

/**
 * The panel's entries in the list's order: a layer alone, or an ArcGIS map's layers together
 * where its first one is, top-most first as ArcGIS lists them (F-138).
 */
export function panelEntries(layers: readonly MapLayerView[]): PanelEntry[] {
  const entries: PanelEntry[] = [];
  const maps = new Map<string, MapLayerView[]>();
  for (const layer of layers) {
    if (layer.map === null) {
      entries.push({ kind: 'layer', layer });
      continue;
    }
    const group = maps.get(layer.map.itemId);
    if (group) group.unshift(layer);
    else {
      const first = [layer];
      maps.set(layer.map.itemId, first);
      entries.push({
        kind: 'map',
        itemId: layer.map.itemId,
        title: layer.map.title,
        layers: first,
      });
    }
  }
  return entries;
}

type OpenState = [
  ReadonlySet<string>,
  (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
];

/** A layer's switch in the panel, and under one coloured by a field, its values. */
function LayerSwitch({
  state,
  layer,
  open,
  setOpen,
}: {
  state: MapLayersState;
  layer: MapLayerView;
  open: OpenState[0];
  setOpen: OpenState[1];
}) {
  const on = state.chosen.has(layer.id);
  const expandable = on && layer.colourField !== null && layer.colours.length > 0;
  const expanded = expandable && open.has(layer.id);
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-primary"
            checked={on}
            onChange={() => {
              state.toggle(layer.id);
            }}
          />
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: layer.colours[0]?.[1] ?? layer.colour }}
          />
          <span className="truncate">{layer.name}</span>
        </label>
        {expandable && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Choose'} ${layer.colourField ?? 'values'} of ${layer.name}`}
            onClick={() => {
              setOpen((current) => {
                const next = new Set(current);
                if (next.has(layer.id)) next.delete(layer.id);
                else next.add(layer.id);
                return next;
              });
            }}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        )}
      </div>
      {expanded && (
        <LayerValues
          layer={layer}
          choice={choiceOf(layer, state.values)}
          onChange={(choice) => {
            state.setValues(layer.id, choice, choiceOf(layer, {}));
          }}
        />
      )}
    </li>
  );
}

/** An ArcGIS map's layers under its title, with one switch for all of them (F-138). */
function MapGroup({
  state,
  itemId,
  title,
  layers,
  open,
  setOpen,
}: {
  state: MapLayersState;
  itemId: string;
  title: string;
  layers: MapLayerView[];
  open: OpenState[0];
  setOpen: OpenState[1];
}) {
  const onCount = layers.filter((layer) => state.chosen.has(layer.id)).length;
  const ids = layers.map((layer) => layer.id);
  // Its layers folded under it until opened (the owner's request of 2026-11-09, F-142).
  const key = `map:${itemId}`;
  const expanded = open.has(key);
  return (
    <li className="py-2">
      <div className="flex items-center gap-1">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 font-medium">
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-primary"
            checked={onCount > 0}
            aria-checked={onCount === layers.length ? 'true' : onCount === 0 ? 'false' : 'mixed'}
            onChange={() => {
              // On: the layers the ArcGIS map shows at first (all when it names none, F-141);
              // off: all of them.
              if (onCount > 0) state.setMany(ids, false);
              else {
                const first = layers.filter((layer) => layer.mapVisible).map((layer) => layer.id);
                state.setMany(first.length > 0 ? first : ids, true);
              }
            }}
          />
          <span className="truncate">{title}</span>
          <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
            {onCount} of {layers.length}
          </span>
        </label>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} the layers of ${title}`}
          onClick={() => {
            setOpen((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }}
        >
          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </Button>
      </div>
      {expanded && (
        <ul aria-label={`${title}: layers`} className="flex flex-col pl-6">
          {layers.map((layer) => (
            <LayerSwitch key={layer.id} state={state} layer={layer} open={open} setOpen={setOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The Layers panel over the map (F-133): each layer with a switch, and under one coloured by a
 * field, each of its values with a tick box, so one railroad can be looked at alone. It opens
 * below the map's + and − zoom buttons, on their side, and runs down (the owner's request of
 * 2026-11-08, F-139).
 */
export function MapLayersPanel({
  state,
  side,
}: {
  state: MapLayersState;
  /** The side of the map its zoom buttons are on. */
  side: 'left' | 'right';
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const api = useLayerApi();
  if (!state.panelOpen) return null;
  return (
    <section
      aria-label="Map layers"
      className={cn(
        // Below the zoom buttons (10 px from the top, two 29 px buttons).
        'absolute top-20 bottom-3 z-10 flex w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-card border bg-card text-sm shadow-md',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="font-medium">Layers</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close layers"
          onClick={() => {
            state.setPanelOpen(false);
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {state.error !== null ? (
          <p className="text-danger">Could not load: {state.error}</p>
        ) : state.layers.length === 0 ? (
          <p className="text-muted-foreground">
            No map layers yet. Admins add them {api.managedIn}.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {panelEntries(state.layers).map((entry) =>
              entry.kind === 'layer' ? (
                <LayerSwitch
                  key={entry.layer.id}
                  state={state}
                  layer={entry.layer}
                  open={open}
                  setOpen={setOpen}
                />
              ) : (
                <MapGroup
                  key={`map-${entry.itemId}`}
                  state={state}
                  itemId={entry.itemId}
                  title={entry.title}
                  layers={entry.layers}
                  open={open}
                  setOpen={setOpen}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * A picture layer's legend from ArcGIS (F-141): each entry's small picture and words, as ArcGIS
 * shows it (a heat map's scale from most to least dense). Nothing while it loads or if ArcGIS
 * gives none.
 */
function PictureLegend({
  layerId,
  token,
  onStale,
  retry,
}: {
  layerId: string;
  token: string;
  onStale: MapLayersState['onStale'];
  retry: number;
}) {
  const api = useLayerApi();
  const path = api.path(`/${layerId}/legend`);
  // Kept only while it is shown, and never from the page's memory of earlier answers: a layer
  // switched back on shows its legend once the Worker has answered again, which it does only
  // for a member (F-247-2-R17-01; the same rule as its squares, R5-02). The browser's own copy
  // makes that quick: the Worker answers "not modified" after its check.
  const [legend, setLegend] = useState<{
    path: string;
    who: string;
    entries: LayerLegend['entries'];
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiJson<LayerLegend>(path, token, { signal: controller.signal })
      .then((answer) => {
        if (controller.signal.aborted) return;
        setLegend({ path, who: signedInAs(token), entries: answer.entries });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLegend(null);
        // Refused, or the layer is no longer there: the list says what is (F-247-2-R9-01).
        if (!(error instanceof ApiError)) return;
        if (error.status === 404) onStale?.('missing');
        else if (error.status === 401 || error.status === 403) onStale?.('refused');
      });
    return () => {
      controller.abort();
    };
  }, [path, token, onStale, retry]);
  if (legend?.path !== path || legend.who !== signedInAs(token)) return null;
  return (
    <>
      {legend.entries.map((entry, i) => (
        <span key={`${String(i)}-${entry.label}`} className="flex items-center gap-1">
          {entry.image && <img src={entry.image} alt="" className="h-4 max-w-16 object-contain" />}
          {entry.label}
        </span>
      ))}
    </>
  );
}

/**
 * Under the map: each layer that is on, the colours shown and any note. Its source and terms are
 * on Team → Map layers, not here (the owner's request of 2026-11-08, F-139).
 */
export function MapLayersLegend({ state }: { state: MapLayersState }) {
  const on = state.layers.filter((layer) => state.chosen.has(layer.id));
  if (on.length === 0) return null;
  return (
    <ul
      aria-label="Map layers shown"
      className="flex flex-col gap-1.5 text-xs text-muted-foreground"
    >
      {on.map((layer) => {
        const note = state.notes.get(layer.id);
        const choice = choiceOf(layer, state.values);
        const shown = layer.colours.filter(([value]) => valueShown(choice, value));
        const more = shown.length - LEGEND_VALUES;
        const hidden = layer.colours.length - shown.length;
        return (
          <li key={layer.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-foreground">{layer.name}</span>
            {layer.colours.length > 0 ? (
              <>
                {shown.slice(0, LEGEND_VALUES).map(([value, colour]) => (
                  <span key={value} className="flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className="h-1 w-4 rounded-full"
                      style={{ backgroundColor: colour }}
                    />
                    {value}
                  </span>
                ))}
                {more > 0 && (
                  <span>and {more.toLocaleString('en-CA')} more, each its own colour</span>
                )}
                {hidden > 0 && <span>({hidden.toLocaleString('en-CA')} hidden in Layers)</span>}
              </>
            ) : layer.kind === 'arcgis_image' || layer.kind === 'arcgis_tiles' ? (
              <PictureLegend
                layerId={layer.id}
                token={state.token}
                onStale={state.onStale}
                retry={state.retry ?? 0}
              />
            ) : (
              <span
                aria-hidden="true"
                className="h-1 w-4 rounded-full"
                style={{ backgroundColor: layer.colour }}
              />
            )}
            {note && (
              <span role="status" className="text-warning">
                {note}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Fields = [string, string | number | boolean][];

/** The plain fields of a feature from a file, as kept. */
function fileFields(properties: Record<string, unknown>): Fields {
  return Object.entries(properties).flatMap(([name, value]): Fields => {
    if (name.startsWith('__')) return [];
    if (typeof value === 'number' || typeof value === 'boolean') return [[name, value]];
    if (typeof value === 'string' && value.trim() !== '') return [[name, value]];
    return [];
  });
}

/** Over the map: the details of the shape last clicked on a layer. */
export function PickedFeatureCard({
  state,
  token,
  className,
}: {
  state: MapLayersState;
  token: string;
  /** Where it sits along the map's bottom; at the left by default. */
  className?: string;
}) {
  const api = useLayerApi();
  const { picked, setPicked } = state;
  const layer = picked ? state.layers.find((l) => l.id === picked.layerId) : undefined;
  const objectId = picked?.properties[OBJECT_ID];
  // A live feature has its id and its details are asked for; a line of a zoomed-out view (no
  // id) shows the field it carries (Codex's review of 8e0fd95).
  const live =
    layer?.kind === 'arcgis_features' &&
    (typeof objectId === 'number' || typeof objectId === 'string');
  const [details, setDetails] = useState<{ key: string; fields: Fields | 'failed' } | null>(null);
  const key = `${picked?.layerId ?? ''}/${String(objectId)}`;
  // Nothing is kept of a shape no longer picked (its layer switched off, F-247-2-R9-03).
  if (!picked && details) setDetails(null);
  const { onStale } = state;

  useEffect(() => {
    if (!live || (typeof objectId !== 'number' && typeof objectId !== 'string')) return;
    const controller = new AbortController();
    apiJson<{ fields: Fields }>(
      api.path(`/${layer.id}/details/${encodeURIComponent(String(objectId))}`),
      token,
      { signal: controller.signal },
    )
      .then((body) => {
        setDetails({ key, fields: body.fields });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDetails({ key, fields: 'failed' });
        // Refused, or the layer is no longer there: the list says what is (F-247-2-R9-01).
        if (!(error instanceof ApiError)) return;
        if (error.status === 404) onStale?.('missing');
        else if (error.status === 401 || error.status === 403) onStale?.('refused');
      });
    return () => {
      controller.abort();
    };
  }, [live, layer, objectId, key, token, api, onStale]);

  if (!picked || !layer) return null;
  const fields: Fields | 'failed' | null = live
    ? details?.key === key
      ? details.fields
      : null
    : fileFields(picked.properties);

  return (
    <section
      aria-label="Map layer details"
      className={cn(
        'absolute bottom-3 z-10 z-10 flex max-h-[60%] w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-card border bg-card text-sm shadow-md',
        className ?? 'left-3',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="truncate font-medium">{layer.name}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close details"
          onClick={() => {
            setPicked(null);
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="overflow-y-auto px-3 py-2">
        {fields === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : fields === 'failed' ? (
          <p className="text-danger">The details could not be loaded.</p>
        ) : fields.length === 0 ? (
          <p className="text-muted-foreground">No details for this shape.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {fields.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="break-words">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
