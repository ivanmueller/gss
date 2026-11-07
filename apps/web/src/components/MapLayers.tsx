import type { MapLayerList, MapLayerView } from '@grain/domain';
import { Layers, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  OBJECT_ID,
  useLayerChoice,
  useLayerOverlays,
  type MapOverlay,
  type MapView,
  type PickedFeature,
} from '../lib/mapLayers';
import { useApiResource } from '../lib/useApiResource';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

// Map layers on the Workspace map and Counterparties → map view (F-107, the owner's answers of
// 2026-11-07): admins add them on Team; each person switches them on and off here, several at
// once, and clicks a shape to see its details. Each layer's source is credited under the map.

/** How many of a layer's colours the legend shows before "and N more". */
const LEGEND_VALUES = 8;

export interface MapLayersState {
  layers: MapLayerView[];
  chosen: ReadonlySet<string>;
  toggle: (id: string) => void;
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
  const [view, setView] = useState<MapView | null>(null);
  const { overlays, notes } = useLayerOverlays(on, view, token);
  const [picked, setPicked] = useState<PickedFeature | null>(null);
  return {
    layers,
    chosen,
    toggle,
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

/** The Layers button: a tick box per layer. */
export function MapLayersMenu({ state }: { state: MapLayersState }) {
  const count = state.layers.filter((layer) => state.chosen.has(layer.id)).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Layers aria-hidden="true" />
          Layers{count > 0 ? ` (${String(count)})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Map layers</DropdownMenuLabel>
        {state.error !== null ? (
          <p className="px-2 py-1.5 text-sm text-danger">Could not load: {state.error}</p>
        ) : state.layers.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No map layers yet. Admins add them on Team → Map layers.
          </p>
        ) : (
          state.layers.map((layer) => (
            <DropdownMenuCheckboxItem
              key={layer.id}
              checked={state.chosen.has(layer.id)}
              onSelect={() => {
                state.toggle(layer.id);
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: layer.colours[0]?.[1] ?? layer.colour }}
                />
                <span className="truncate">{layer.name}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Under the map: each layer that is on, its colours, its source and any note. */
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
        const more = layer.colours.length - LEGEND_VALUES;
        return (
          <li key={layer.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-foreground">{layer.name}</span>
            {layer.colours.length > 0 ? (
              <>
                {layer.colours.slice(0, LEGEND_VALUES).map(([value, colour]) => (
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
export function PickedFeatureCard({ state, token }: { state: MapLayersState; token: string }) {
  const { picked, setPicked } = state;
  const layer = picked ? state.layers.find((l) => l.id === picked.layerId) : undefined;
  const objectId = picked?.properties[OBJECT_ID];
  const live = layer?.kind === 'arcgis_features';
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
      className="absolute bottom-3 left-3 z-10 flex max-h-[60%] w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-card border bg-card text-sm shadow-md"
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
