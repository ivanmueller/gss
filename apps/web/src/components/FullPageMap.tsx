import { formatAlberta, LAND_RIGHTS } from '@grain/domain';
import { CircleCheck, Minus, Plus, Settings, TriangleAlert, Waves } from 'lucide-react';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';

import { LayerApiContext, petroleumLayers } from '../lib/layerApi';
import {
  BASEMAPS,
  mapboxToken,
  type Basemap,
  type MapBounds,
  type MapboxToken,
} from '../lib/mapbox';
import { useTheme } from '../lib/theme';
import { cn } from '../lib/utils';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import type { St37Hover } from './FacilityMap';
import {
  MapLayersButton,
  MapLayersLegend,
  MapLayersPanel,
  PickedFeatureCard,
  useMapLayers,
} from './MapLayers';
import { MapLayerSettings } from './MapLayerSettings';
import { Button } from './ui/button';
import { Callout } from './ui/callout';
import { useFacilities } from './Facilities';
import { usePrices } from './Prices';
import { FacilityPanel, FacilityTip } from './FacilityPanel';
import { useFormations } from './Formations';
import { useGeologyMaps } from './GeologyMaps';
import { PipelinePanel, PipelineTip } from './PipelinePanel';
import { usePipelines, type PipelineEntry } from './Pipelines';
import { useLand, type LandPick } from './Land';
import { LandPanel, LandTip } from './LandPanel';
import { saleDay, useLandSales } from './LandSales';
import { SIDE_LABEL } from './MapSide';
import { RigPanel, RigTip } from './RigPanel';
import { useRigs } from './Rigs';
import { St37Panel, St37Tip } from './St37Panel';
import { useSt37Wells } from './St37Wells';
import { GridPanel, useTownshipGrid } from './TownshipGrid';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('./FacilityMap'));

/**
 * The starting view: Canada from the Pacific to the Atlantic, up to 70°N. The Arctic islands
 * (to 83°N) are left out on purpose: on a Mercator map they would take most of the window and
 * shrink the provinces where oil and gas is produced to half their height (F-239-R1-01).
 */
export const CANADA: MapBounds = [-141, 41.7, -52.6, 70];

const NO_PINS = [] as const;

/**
 * The map on its own page (F-238, map.torvenco.com), for the oil and gas side of the platform
 * (F-239): the map filling the window, one side card for everything on it (F-267), with map
 * styles and the oil and gas map layers (F-247 part 2), which are its own, kept in the oil and gas database: grain's map layers are neither
 * asked for nor offered here. Everyone switches layers on and off under Layers; admins add and
 * manage them under Settings, and choose which are on when the map opens.
 */
export function FullPageMap({
  session,
  mapbox = mapboxToken(),
}: {
  session: DirectorySession;
  mapbox?: MapboxToken;
}) {
  const organizationId = session.organization.id;
  const api = useMemo(() => petroleumLayers(organizationId), [organizationId]);
  return (
    <LayerApiContext value={api}>
      <OilAndGasMap session={session} mapbox={mapbox} />
    </LayerApiContext>
  );
}

function OilAndGasMap({ session, mapbox }: { session: DirectorySession; mapbox: MapboxToken }) {
  const [refused, setRefused] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('map');
  const [theme] = useTheme();
  const layers = useMapLayers(mapbox.status === 'ok' && !refused ? session : null);
  // The AER's new licences (F-243 part 2) are off the map for now (the owner, 2026-11-19); their
  // code and daily job stay. The ST37 wells take their place (F-243 part 4).
  const wells = useSt37Wells(session.organization.id, session.token);
  // The well or leg under the pointer: a box at the pointer with its simple lines (F-265).
  const [hover, setHover] = useState<St37Hover | null>(null);
  // A clicked well's panel stays open on the right, to choose a leg on it (F-258), while the
  // well is loaded.
  const [clicked, setClicked] = useState<St37Hover | null>(null);
  const kept = clicked && wells.byUwi.has(clicked.uwis[0] ?? '') ? clicked : null;
  const locked = kept ? (wells.byUwi.get(kept.uwis[0] ?? '')?.licenceNumber ?? null) : null;
  // Land held today, under the wells (F-241); a click on land with no well opens its card.
  const land = useLand(session.organization.id, session.token);
  const [landPick, setLandPick] = useState<LandPick | null>(null);
  // Crown land sales, over the land held (F-242); a clicked parcel leads the same card.
  const sales = useLandSales(session.organization.id, session.token);
  // The township grid (F-240, F-271): on by default, its switch in the legend.
  const grid = useTownshipGrid(session.organization.id, session.token);
  // The AER's facilities (F-278): their keys answer the pointer and the click as land does.
  const facilities = useFacilities(session.organization.id, session.token);
  // Alberta's royalty prices (F-285): a section of charts, nothing on the map.
  const prices = usePrices(session.organization.id, session.token);
  // The AER's pipelines (F-249), square by square: their keys answer after the facilities'.
  const pipelines = usePipelines(session.organization.id, session.token);
  // The segment a click opened, kept as it was: the map may move on past its square.
  const [pipelinePicked, setPipelinePicked] = useState<PipelineEntry | null>(null);
  // The formations' outlines (F-280), each switched by itself, not tied to the wells.
  const formations = useFormations();
  // A formation's depth or thickness (F-287 part 3), off when the map opens.
  const geology = useGeologyMaps();
  // Rigs, all of Alberta (F-282): their keys answer the pointer and the click before the wells.
  const rigs = useRigs(session.organization.id, session.token);
  const pickLand = (pick: LandPick | null) => {
    if (pick) grid.clearPick();
    setLandPick(pick);
    land.setPicked(pick?.keys ?? []);
    sales.setPicked(pick?.keys ?? []);
    facilities.setPicked(pick?.keys.slice(0, 1) ?? []);
    pipelines.setPicked(pick?.keys.slice(0, 1) ?? []);
    rigs.setPicked(pick?.keys.slice(0, 1) ?? []);
    const first = pick?.keys[0];
    setPipelinePicked(first?.startsWith('pipeline:') ? (pipelines.byKey.get(first) ?? null) : null);
  };
  // A click whose topmost shape is a facility opens the facility's panel; a pipeline, the
  // pipeline's; else the land's.
  const facilityPicked =
    landPick?.keys[0]?.startsWith('facility:') === true
      ? (facilities.byKey.get(landPick.keys[0]) ?? null)
      : null;
  const pipelineOpen = landPick?.keys[0]?.startsWith('pipeline:') === true ? pipelinePicked : null;
  const rigPicked =
    landPick?.keys[0]?.startsWith('rig:') === true
      ? (rigs.byKey.get(landPick.keys[0]) ?? null)
      : null;
  // The land under the pointer, where no well is: a box at the pointer, and its outline.
  const [landHover, setLandHover] = useState<string | null>(null);
  const hoverShape = useMemo(() => {
    if (landHover === null) return null;
    return landHover.startsWith('sale:')
      ? (sales.parcels.get(landHover.slice(5))?.shape ?? null)
      : land.shapeOf(landHover);
  }, [landHover, sales.parcels, land]);
  const [fitTo, setFitTo] = useState<MapBounds | null>(null);
  // The map moves only when the bounds it is given change: a second click on a Zoom button,
  // after the map was moved away, hands it the same place a hair off, so it moves again.
  const goTo = useCallback((bounds: MapBounds) => {
    setFitTo((before) => {
      const [west, south, east, north] = bounds;
      return before?.join(',') === bounds.join(',') ? [west, south, east, north + 1e-9] : bounds;
    });
  }, []);
  const admin = session.organization.role === 'org_admin';
  const tone = theme === 'dark' || basemap === 'satellite' ? 'dark' : 'light';

  // The side card (F-267): its sections open one at a time, and the legend leads with the one
  // open. On a narrow screen the card starts folded, so the map is seen first.
  const [section, setSection] = useState<SideSection | null>('wells');
  const [folded, setFolded] = useState(startsFolded);
  const [legendOpen, setLegendOpen] = useState(true);
  const openOnly = (name: SideSection) => () => {
    setSection((before) => (before === name ? null : name));
  };
  const updated =
    [
      wells.updated,
      land.updated,
      sales.updated,
      facilities.updated,
      pipelines.updated,
      rigs.updated,
    ]
      .filter((at): at is string => at !== null)
      .sort()
      .at(-1) ?? null;

  if (mapbox.status !== 'ok' || refused) {
    const text = refused
      ? 'Mapbox refused the token. An administrator needs to check the token and the web addresses it allows (README, “Map”).'
      : 'The map is not set up yet: it needs a Mapbox public token (README, “Map”).';
    return (
      <div className="p-4">
        <Callout variant="warning" icon={TriangleAlert}>
          <p>{text}</p>
        </Callout>
      </div>
    );
  }

  const legends = sideOrder(section).map((name) => ({
    name,
    node:
      name === 'sales'
        ? sales.legend()
        : name === 'land'
          ? land.legend()
          : name === 'facilities'
            ? facilities.legend()
            : name === 'pipelines'
              ? pipelines.legend()
              : name === 'rigs'
                ? rigs.legend()
                : name === 'formations'
                  ? formations.legend(tone)
                  : name === 'geology'
                    ? geology.legend()
                    : wells.legend(tone),
  }));
  // Beside the card, or at the map's edge while the card is folded.
  const beside = folded ? 'left-3' : 'left-3 md:left-[24rem]';

  return (
    <div className="relative h-full overflow-hidden bg-muted">
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
        <FacilityMap
          token={mapbox.token}
          basemap={basemap}
          theme={theme}
          pins={NO_PINS}
          selectedId={null}
          start={CANADA}
          scale
          paper
          onSelect={() => undefined}
          overlays={layers.overlays}
          authToken={session.token}
          st37={wells.view}
          onSt37Hover={setHover}
          onSt37Click={(found) => {
            if (found) grid.clearPick();
            setClicked(found);
          }}
          st37Locked={locked}
          land={land.view}
          landSales={sales.view}
          grid={grid.view}
          gridTownships={grid.townships}
          onEmptyClick={grid.identify}
          facilities={facilities.view}
          pipelines={pipelines.view}
          rigs={rigs.view}
          formations={formations.view}
          geology={geology.view}
          geologyTipAt={geology.tipAt}
          onLandClick={pickLand}
          onLandHover={setLandHover}
          landHover={hoverShape}
          hoverBox={
            hover ? (
              <St37Tip hover={hover} byUwi={wells.byUwi} legsOf={wells.legsOf} />
            ) : landHover?.startsWith('facility:') ? (
              <FacilityTip facility={facilities.byKey.get(landHover) ?? null} />
            ) : landHover?.startsWith('pipeline:') ? (
              <PipelineTip pipeline={pipelines.byKey.get(landHover) ?? null} />
            ) : landHover?.startsWith('rig:') ? (
              <RigTip move={rigs.byKey.get(landHover) ?? null} />
            ) : (
              <LandTip landKey={landHover} land={land} sales={sales} />
            )
          }
          fitTo={fitTo}
          onViewChange={(bbox, zoom) => {
            layers.onViewChange(bbox, zoom);
            wells.onViewChange(bbox);
            land.onViewChange(bbox, zoom);
            sales.onViewChange(bbox, zoom);
            grid.onViewChange(bbox, zoom);
            facilities.onViewChange(bbox, zoom);
            pipelines.onViewChange(bbox, zoom);
            rigs.onViewChange(bbox, zoom);
          }}
          onOverlayClick={layers.setPicked}
          onLayersStale={layers.onStale}
          layersRetry={layers.retry}
          onTokenRefused={() => {
            setRefused(true);
          }}
        />
        {/* Shown with the map itself, so it never covers the loading message (F-238-R1-02). */}
        {folded ? (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-card border bg-card/95 py-1.5 pr-1.5 pl-3 shadow-xs">
            <span className="text-sm font-semibold">Alberta oil and gas</span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Show the menu"
              onClick={() => {
                setFolded(false);
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <aside
            aria-label="Map menu"
            className="absolute top-3 bottom-3 left-3 z-20 flex w-[22.5rem] max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto rounded-card border bg-card/95 shadow-md"
          >
            <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
              <div className="flex items-center gap-2">
                <span className={`${SIDE_LABEL} grow`}>Oil and gas</span>
                {/* Admins only; the API refuses everyone else whatever the page shows. */}
                {admin && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Settings aria-hidden="true" />
                        Settings
                      </Button>
                    </DialogTrigger>
                    <DialogContent
                      title="Map settings"
                      description="The layers of the oil and gas map. Only admins see this."
                      className="max-w-2xl"
                    >
                      {/* The map reads its list again after each change (F-247-2-D1-03). */}
                      <MapLayerSettings session={session} onChanged={layers.reload} />
                    </DialogContent>
                  </Dialog>
                )}
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Hide the menu"
                  onClick={() => {
                    setFolded(true);
                  }}
                >
                  <Minus aria-hidden="true" />
                </Button>
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Alberta oil and gas</h1>
                <p className="text-[0.8125rem] text-muted-foreground">
                  Crown land sales, who holds the land, wells, rigs and production
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <MapLayersButton state={layers} />
                <SegmentedControl
                  label="Map style"
                  options={(Object.keys(BASEMAPS) as Basemap[]).map((key) => ({
                    value: key,
                    label: BASEMAPS[key].label,
                  }))}
                  value={basemap}
                  onChange={setBasemap}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className={SIDE_LABEL}>Jump to</p>
                <div className="grid grid-cols-2 gap-2">
                  <JumpButton
                    title="Next sale"
                    note={
                      sales.nextSale
                        ? `${saleDay(sales.nextSale.date)} · ${sales.nextSale.parcels.toLocaleString('en-CA')} ${sales.nextSale.parcels === 1 ? 'parcel' : 'parcels'}`
                        : 'none posted'
                    }
                    mark={<span className="size-2 rounded-full bg-[#d9541e]" />}
                    disabled={sales.nextSale === null}
                    onClick={() => {
                      if (!sales.nextSale) return;
                      setSection('sales');
                      sales.showSale(sales.nextSale.date, goTo);
                    }}
                  />
                  <JumpButton
                    title="Last sale"
                    note={
                      sales.lastSale
                        ? `${saleDay(sales.lastSale.date)} · ${sales.lastSale.sold.toLocaleString('en-CA')} sold`
                        : 'none held'
                    }
                    mark={<CircleCheck className="size-3.5 text-[#d9541e]" />}
                    disabled={sales.lastSale === null}
                    onClick={() => {
                      if (!sales.lastSale) return;
                      setSection('sales');
                      sales.showSale(sales.lastSale.date, goTo);
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.values(LAND_RIGHTS).map((play) => (
                    <JumpButton
                      key={play.key}
                      title={play.name}
                      note="past year"
                      mark={<Waves className="size-3.5 text-muted-foreground" />}
                      onClick={() => {
                        setSection('sales');
                        sales.showPastYear(play.key);
                        land.setRights(play.key);
                        const loaded = wells.formations.find((f) => f.key === play.key);
                        if (!loaded) return;
                        wells.choose(loaded.key);
                        const a = loaded.area;
                        goTo([a.west, a.south, a.east, a.north]);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {sales.section({ open: section === 'sales', onToggle: openOnly('sales'), goTo })}
            {land.section({ open: section === 'land', onToggle: openOnly('land') })}
            {facilities.section({
              open: section === 'facilities',
              onToggle: openOnly('facilities'),
            })}
            {pipelines.section({
              open: section === 'pipelines',
              onToggle: openOnly('pipelines'),
            })}
            {rigs.section({ open: section === 'rigs', onToggle: openOnly('rigs') })}
            {wells.section({
              open: section === 'wells',
              onToggle: openOnly('wells'),
              tone,
              goTo,
            })}
            {formations.section({
              open: section === 'formations',
              onToggle: openOnly('formations'),
              tone,
            })}
            {prices.section({ open: section === 'prices', onToggle: openOnly('prices') })}
            {geology.section({ open: section === 'geology', onToggle: openOnly('geology') })}
            {/* What the card shows and where it comes from, out of the way until asked for.
                The sources stay here: their terms ask that they be named. */}
            <details className="mt-auto border-t px-4 py-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none hover:text-foreground">
                Sources &amp; licence
                {updated ? ` · updated ${formatAlberta(updated, { weekday: false })}` : ''}
              </summary>
              <div className="mt-2 flex flex-col gap-1.5">
                {sales.about()}
                {land.about()}
                {wells.about()}
                {facilities.about()}
                {pipelines.about()}
                {rigs.about()}
                {formations.about()}
                {grid.about()}
                {prices.about()}
                {geology.about()}
              </div>
            </details>
          </aside>
        )}
      </Suspense>
      {/* Below the zoom buttons, top right (F-139). */}
      <MapLayersPanel state={layers} side="right" />
      <LandPanel
        // A panel of its own for each click: it starts on the first piece of land under it.
        key={landPick ? `land:${landPick.keys.join(',')}` : 'land'}
        pick={kept || facilityPicked || pipelineOpen || rigPicked ? null : landPick}
        land={land}
        sales={sales}
        goTo={goTo}
        onClose={() => {
          pickLand(null);
        }}
      />
      {/* A square of the grid a click on nothing else named (F-271). */}
      {!kept && !landPick && <GridPanel pick={grid.pick} goTo={goTo} onClose={grid.clearPick} />}
      <FacilityPanel
        facility={kept ? null : facilityPicked}
        fileDate={facilities.fileDate}
        goTo={goTo}
        onClose={() => {
          pickLand(null);
        }}
      />
      <PipelinePanel
        key={pipelineOpen ? pipelineOpen.key : 'pipeline'}
        pipeline={kept ? null : pipelineOpen}
        member={{ organizationId: session.organization.id, token: session.token }}
        fileDate={pipelines.fileDate}
        goTo={goTo}
        onClose={() => {
          pickLand(null);
        }}
      />
      <RigPanel
        move={kept ? null : rigPicked}
        movesOf={rigs.movesOf}
        goTo={goTo}
        onClose={() => {
          pickLand(null);
        }}
      />
      <St37Panel
        // A panel of its own for each click: the leg clicked is the one it starts on (F-258).
        key={kept ? `${kept.uwis[0] ?? ''}@${String(kept.x)},${String(kept.y)}` : 'well'}
        pick={kept}
        onClose={() => {
          setClicked(null);
        }}
        byUwi={wells.byUwi}
        legsOf={wells.legsOf}
        member={{ organizationId: session.organization.id, token: session.token }}
        goTo={goTo}
      />
      <PickedFeatureCard state={layers} token={session.token} className={beside} />
      {/* One legend, bottom left beside the card: what the open section's colours mean first,
          then the other sections', then the map layers that are on. It makes way for a clicked
          shape's details, so it never covers their fields or their close button
          (F-247-2-R3-02), and with many layers on it scrolls within the space it has
          (F-247-2-R13-02). */}
      {/* Always there: the township grid's switch is in it (F-271). */}
      {layers.picked === null && (
        <div
          role="group"
          aria-label="Legend"
          className={cn(
            'absolute bottom-8 z-10 flex max-h-[calc(100%-9rem)] w-64 max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto rounded-card border bg-card/95 text-xs shadow-xs',
            beside,
            !folded && 'hidden md:flex',
          )}
        >
          <button
            type="button"
            aria-expanded={legendOpen}
            aria-label={legendOpen ? 'Hide the legend' : 'Show the legend'}
            onClick={() => {
              setLegendOpen((before) => !before);
            }}
            className={cn(
              'z-10 rounded-sm px-1.5 leading-none text-muted-foreground hover:bg-muted hover:text-foreground',
              legendOpen ? 'absolute top-2.5 right-2' : 'flex items-center gap-2 p-2.5',
            )}
          >
            {legendOpen ? '−' : 'Legend +'}
          </button>
          {legendOpen && (
            <div className="flex flex-col divide-y [&>*]:px-3 [&>*]:py-2.5">
              {legends.map(
                (legend) => legend.node !== null && <div key={legend.name}>{legend.node}</div>,
              )}
              <MapLayersLegend state={layers} />
              <div>{grid.legend()}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SideSection =
  | 'sales'
  | 'land'
  | 'facilities'
  | 'pipelines'
  | 'rigs'
  | 'wells'
  | 'formations'
  | 'prices'
  | 'geology';

/** The sections' legends in order: the open one first, the rest as the card lists them. */
export function sideOrder(open: SideSection | null): SideSection[] {
  // Prices draws nothing on the map, so it has no legend: never among them.
  const all: SideSection[] = [
    'sales',
    'land',
    'facilities',
    'pipelines',
    'rigs',
    'wells',
    'formations',
    'geology',
  ];
  return open === null || !all.includes(open)
    ? all
    : [open, ...all.filter((name) => name !== open)];
}

/** Whether the card starts folded: on a screen too narrow to show it beside the map. */
function startsFolded(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
}

/** A Jump to button: where it leads, and a few words of what is there. */
function JumpButton({
  title,
  note,
  mark,
  disabled,
  onClick,
}: {
  title: string;
  note: string;
  mark: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-start rounded-lg border bg-card px-3 py-2 text-left shadow-xs hover:bg-muted disabled:opacity-60 disabled:hover:bg-card"
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <span aria-hidden="true" className="flex items-center">
          {mark}
        </span>
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </button>
  );
}
