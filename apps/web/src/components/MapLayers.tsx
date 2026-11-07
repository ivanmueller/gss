import type { MapLayerList, MapLayerView } from '@grain/domain';
import { ChevronDown, ChevronRight, Layers, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  ALL_VALUES,
  OBJECT_ID,
  useLayerChoice,
  useLayerOverlays,
  useValueChoices,
  valueShown,
  type MapOverlay,
  type MapView,
  type PickedFeature,
  type ValueChoice,
} from '../lib/mapLayers';
import { useApiResource } from '../lib/useApiResource';
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
  layers: MapLayerView[];
  chosen: ReadonlySet<string>;
  toggle: (id: string) => void;
  /** Each layer's values this person shows; a layer not listed shows all. */
  values: Readonly<Record<string, ValueChoice>>;
  setValues: (id: string, choice: ValueChoice) => void;
  /** Whether the Layers panel is open. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  overlays: MapOverlay[];
  notes: Map<string, string>;
  onViewChange: (bbox: MapView['bbox'] | null, zoom: number) => void;
  picked: PickedFeature | null;
  setPicked: (picked: PickedFeature | null) => void;
  error: string | null;
}

/** The organization's map layers, the ones this person has on, and their features in view. */
export function useMapLayers(
  session: { token: string; organization: { id: string } } | null,
): MapLayersState {
  const token = session?.token ?? '';
  const [list] = useApiResource<MapLayerList>(
    session ? `/map-layers?organization_id=${session.organization.id}` : null,
    token,
  );
  const layers = useMemo(
    () => (list.status === 'ok' && Array.isArray(list.data.layers) ? list.data.layers : []),
    [list],
  );
  const [chosen, toggle] = useLayerChoice(token);
  const on = useMemo(() => layers.filter((layer) => chosen.has(layer.id)), [layers, chosen]);
  const [values, setValues] = useValueChoices(token);
  const [view, setView] = useState<MapView | null>(null);
  const { overlays, notes } = useLayerOverlays(on, view, token, values);
  const [picked, setPicked] = useState<PickedFeature | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  return {
    layers,
    chosen,
    toggle,
    values,
    setValues,
    panelOpen,
    setPanelOpen,
    overlays,
    notes,
    onViewChange: (bbox, zoom) => {
      setView(bbox ? { bbox, zoom } : null);
    },
    picked: picked && chosen.has(picked.layerId) ? picked : null,
    setPicked,
    error: list.status === 'error' ? list.error.message : null,
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

/**
 * The Layers panel over the map (F-133): each layer with a switch, and under one coloured by a
 * field, each of its values with a tick box, so one railroad can be looked at alone.
 */
export function MapLayersPanel({
  state,
  className,
}: {
  state: MapLayersState;
  className?: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  if (!state.panelOpen) return null;
  return (
    <section
      aria-label="Map layers"
      className={cn(
        'absolute top-3 bottom-3 z-10 flex w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-card border bg-card text-sm shadow-md',
        className,
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
            No map layers yet. Admins add them on Team → Map layers.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {state.layers.map((layer) => {
              const on = state.chosen.has(layer.id);
              const expandable = on && layer.colourField !== null && layer.colours.length > 0;
              const expanded = expandable && open.has(layer.id);
              return (
                <li key={layer.id} className="py-2">
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
                        {expanded ? (
                          <ChevronDown aria-hidden="true" />
                        ) : (
                          <ChevronRight aria-hidden="true" />
                        )}
                      </Button>
                    )}
                  </div>
                  {expanded && (
                    <LayerValues
                      layer={layer}
                      choice={state.values[layer.id] ?? ALL_VALUES}
                      onChange={(choice) => {
                        state.setValues(layer.id, choice);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Under the map: each layer that is on, the colours shown, its source and any note. */
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
        const choice = state.values[layer.id] ?? ALL_VALUES;
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
            ) : (
              <span
                aria-hidden="true"
                className="h-1 w-4 rounded-full"
                style={{ backgroundColor: layer.colour }}
              />
            )}
            <span>
              Source:{' '}
              <a
                href={layer.termsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {layer.sourceName}
              </a>
            </span>
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

  useEffect(() => {
    if (!live || (typeof objectId !== 'number' && typeof objectId !== 'string')) return;
    const controller = new AbortController();
    apiJson<{ fields: Fields }>(
      `/map-layers/${layer.id}/details/${encodeURIComponent(String(objectId))}`,
      token,
      { signal: controller.signal },
    )
      .then((body) => {
        setDetails({ key, fields: body.fields });
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetails({ key, fields: 'failed' });
      });
    return () => {
      controller.abort();
    };
  }, [live, layer, objectId, key, token]);

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
