import {
  FORMATION_PLAY_ZONES,
  FORMATION_ROCK_SOURCE_NAME,
  FORMATION_ROCKS,
  FORMATION_SOURCE_NAME,
  formationLayerAt,
  formationZone,
  ST37_STATUS_LABELS,
  type FormationLayer,
  type FormationRock,
} from '@grain/domain';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  layerField,
  layersAt,
  layerScene,
  pickLayer,
  type FormationAnswer,
  type LayerHit,
  type LayerScene,
} from '../lib/formationLayers';
import { cn } from '../lib/utils';
import {
  between,
  fitCamera,
  lens,
  lineLength,
  orbit,
  pan,
  pickLine,
  sceneLonLat,
  trueZ,
  well3dScene,
  zoom,
  type Camera,
  type Scene,
  type Size,
  type Well3dAnswer,
  type Well3dHit,
} from '../lib/well3d';
import { drawWell3d, WELL3D_COLOURS } from '../lib/well3dDraw';

/**
 * A well under the ground, in 3D, on its panel (F-261; the owner, 2026-11-22: "displayed in the
 * details panel when the user clicks on the well … super cool and you can free move/zoom the
 * chart"). Two views to switch between (the owner, 2026-11-22):
 *
 * - **Wells:** the well's legs along their real paths, with the other wells nearby, in a block
 *   of ground. The AER's ST37 paths, used on the owner's decision (docs/DECISIONS.md,
 *   2026-11-19): members only, nothing downloaded.
 * - **Layers:** the ground as a solid block seen from outside (the owner, 2026-11-22, from three
 *   pictures of such blocks): its faces show the layers at their real depths, each a band with
 *   its rock type's texture and its name on it, the real ground on top, the wells as pipes
 *   through the faces; opened at the Duvernay, the part beneath is drawn lower, so the top of
 *   the play shows with the legs that run in it; and every layer under the well is listed.
 *   Depths from the Alberta Geological Survey's 3D model, rock types from its Table of
 *   Formations (open data, the Survey named here; docs/DECISIONS.md, 2026-11-22).
 *
 * The block turns with a drag, moves with a right or Shift drag (or two fingers) and zooms with
 * the wheel (or a pinch). True to scale unless the person asks for the depths to be stretched.
 */

const metres = (n: number) => `${Math.round(n).toLocaleString('en-CA')} m`;

/** Answers already read in this visit, by address. */
const cache = new Map<string, unknown>();

/** For tests: forget the answers read. */
export function clearWell3dCache() {
  cache.clear();
}

function useAnswer<T>(path: string | null, token: string) {
  const [loaded, setLoaded] = useState<{ path: string; failed: boolean } | null>(null);
  useEffect(() => {
    if (path === null || cache.has(path)) return;
    const controller = new AbortController();
    apiJson<T>(path, token, { signal: controller.signal })
      .then((answer) => {
        cache.set(path, answer);
        setLoaded({ path, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ path, failed: true });
      });
    return () => {
      controller.abort();
    };
  }, [path, token]);
  if (path === null) return { answer: null, state: 'idle' as const };
  const answer = cache.get(path) as T | undefined;
  if (answer) return { answer, state: 'ok' as const };
  if (loaded?.path === path && loaded.failed) return { answer: null, state: 'failed' as const };
  return { answer: null, state: 'loading' as const };
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A depth below the surface for reading: never above it. */
const below = (scene: Scene, elevation: number) => metres(Math.max(0, scene.ground - elevation));

interface Told {
  title: string;
  lines: string[];
}

/** A layer in words: its name, and its rock type as the Table of Formations gives it. */
function layerWords(zone: number): { name: string; rock: string } {
  const found = formationZone(zone);
  return {
    name: found?.name ?? `Zone ${String(zone)}`,
    rock: FORMATION_ROCKS[found?.rock ?? 'unknown'].label,
  };
}

/** What the pointer is on, in words: the leg, how deep the point lies, and in which layer. */
function hitText(scene: Scene, hit: Well3dHit, layers: LayerScene | null): Told {
  const [x, y, z] = hit.point;
  // With the block opened, what lies under the opening is drawn lower than it is.
  const elevation = layers?.elevation(x, y, z) ?? trueZ(scene, z);
  const layer = layers
    ? formationLayerAt(layersAt(layers.field, ...sceneLonLat(scene, x, y)), elevation)
    : null;
  return {
    title: hit.line.uwi,
    lines: [
      [ST37_STATUS_LABELS[hit.line.statusClass], hit.line.own ? null : hit.line.licensee]
        .filter(Boolean)
        .join(' · '),
      `${below(scene, elevation)} below the surface · ${
        elevation >= 0 ? metres(elevation) : `−${metres(-elevation)}`
      } above sea level`,
      ...(layer ? [`In the ${layerWords(layer.zone).name}`] : []),
    ],
  };
}

function layerText(hit: LayerHit): Told {
  const { name, rock } = layerWords(hit.zone);
  const down = (elevation: number) => metres(Math.max(0, hit.surface - elevation));
  return {
    title: name,
    lines: [
      rock,
      `${down(hit.top)} to ${down(hit.base)} below the surface here · ${metres(
        hit.top - hit.base,
      )} thick`,
    ],
  };
}

/**
 * The canvas and its controls. The camera lives in a ref and the picture is painted on the
 * next frame after anything changes, so a drag never waits on React.
 */
function Well3dCanvas({
  scene,
  layers,
  playZone,
  chosen,
  large,
  label,
}: {
  scene: Scene;
  /** The ground's layers, when the Layers view is on. */
  layers: LayerScene | null;
  playZone: number | null;
  chosen: string | null;
  large: boolean;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef<Size>({ width: 0, height: 0 });
  const camera = useRef<Camera | null>(null);
  const hit = useRef<Well3dHit | null>(null);
  const layerHit = useRef<LayerHit | null>(null);
  const frame = useRef(0);
  const sweep = useRef<{ from: Camera; to: Camera; start: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; move: boolean }>());
  const chosenRef = useRef(chosen);
  const drawn = useRef<{ scene: Scene; layers: LayerScene | null }>({ scene, layers });
  // The painter itself, for the frame that asks for another while a sweep runs.
  const again = useRef<() => void>(() => undefined);
  const [told, setTold] = useState<Told | null>(null);
  const [touched, setTouched] = useState(false);
  // The depth marks need room beside the block; the solid block a little more.
  const room = useMemo(
    () => (layers ? { side: large ? 80 : 56, top: 36 } : { side: 44, top: 30 }),
    [layers, large],
  );
  // With the layers on, the legs are where the block shows them (lower under its opening).
  const shown = useMemo(
    () => (layers ? { ...scene, lines: layers.lines } : scene),
    [scene, layers],
  );

  const paint = useCallback(() => {
    if (frame.current !== 0) return;
    frame.current = window.requestAnimationFrame((now) => {
      frame.current = 0;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || size.current.width === 0) return;
      const moving = sweep.current;
      if (moving) {
        const t = Math.min(1, (now - moving.start) / 1100);
        // Fast at first, settling at the end.
        camera.current = between(moving.from, moving.to, 1 - (1 - t) ** 3);
        if (t >= 1) sweep.current = null;
      }
      camera.current ??= fitCamera(scene, size.current, room);
      const ratio = window.devicePixelRatio || 1;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawWell3d(ctx, scene, camera.current, size.current, {
        hit: hit.current,
        chosen: chosenRef.current,
        layers,
        layerHit: layerHit.current,
        playZone,
        // Held or sweeping: the quick textures; the frame after it is let go, the whole ones.
        moving: pointers.current.size > 0 || sweep.current !== null,
      });
      if (sweep.current) again.current();
      else if (moving) again.current();
    });
  }, [scene, layers, playZone, room]);
  useEffect(() => {
    again.current = paint;
  }, [paint]);

  // The opening view: from straight above, as the map shows the well, down to the side.
  const open = useCallback(
    (animate: boolean) => {
      const to = fitCamera(scene, size.current, room);
      if (animate && !reducedMotion()) {
        const from: Camera = { ...to, yaw: 0, pitch: 1.5, distance: to.distance * 1.5 };
        camera.current = from;
        sweep.current = { from, to, start: window.performance.now() };
      } else {
        sweep.current = null;
        camera.current = to;
      }
      paint();
    },
    [scene, room, paint],
  );

  useEffect(() => {
    chosenRef.current = chosen;
    paint();
  }, [chosen, paint]);

  // Another scene (the layers on or off, the other wells, the depths stretched): the block is
  // held whole again, seen from the side the person had turned it to.
  useEffect(() => {
    const before = drawn.current;
    drawn.current = { scene, layers };
    if (before.scene === scene && before.layers === layers) return;
    hit.current = null;
    layerHit.current = null;
    setTold(null);
    if (camera.current && size.current.width > 0) {
      sweep.current = null;
      camera.current = fitCamera(scene, size.current, room, camera.current);
    }
    paint();
  }, [scene, layers, room, paint]);

  // The canvas follows its box: sharp on any screen, refitted when the box changes.
  const opened = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      size.current = { width: box.width, height: box.height };
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
      if (!opened.current && box.width > 0) {
        opened.current = true;
        open(true);
      } else {
        paint();
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [open, paint]);

  // The wheel zooms the scene, not the panel: a listener that may stop the page's own scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!camera.current) return;
      sweep.current = null;
      const lines = event.deltaMode === 1 ? 32 : 1;
      camera.current = zoom(camera.current, Math.exp(event.deltaY * lines * 0.0014), scene);
      setTouched(true);
      paint();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [scene, paint]);

  const at = (event: React.PointerEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const forget = () => {
    if (!hit.current && !layerHit.current) return false;
    hit.current = null;
    layerHit.current = null;
    setTold(null);
    return true;
  };

  // A leg first; with the layers on, else the layer of the far face under the pointer.
  const point = (event: React.PointerEvent) => {
    if (!camera.current) return;
    const { x, y } = at(event);
    const view = lens(camera.current, size.current);
    const found = pickLine(shown, view, x, y, 9);
    const layer = !found && layers ? pickLayer(scene, layers, view, x, y) : null;
    if (!found && !layer) {
      if (forget()) paint();
      return;
    }
    hit.current = found;
    layerHit.current = layer;
    setTold(found ? hitText(scene, found, layers) : layer ? layerText(layer) : null);
    paint();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      ...at(event),
      move: event.button === 2 || event.button === 1 || event.shiftKey,
    });
    sweep.current = null;
    setTouched(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const held = pointers.current.get(event.pointerId);
    if (!held || !camera.current) {
      point(event);
      return;
    }
    const now = at(event);
    const [dx, dy] = [now.x - held.x, now.y - held.y];
    if (pointers.current.size >= 2) {
      // Two fingers: apart or together zooms, together across the screen moves.
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(held.x - other.x, held.y - other.y);
        const after = Math.hypot(now.x - other.x, now.y - other.y);
        if (before > 0 && after > 0) {
          camera.current = zoom(camera.current, before / after, scene);
        }
        camera.current = pan(camera.current, dx / 2, dy / 2, size.current);
      }
    } else if (held.move) {
      camera.current = pan(camera.current, dx, dy, size.current);
    } else {
      camera.current = orbit(camera.current, dx, dy);
    }
    pointers.current.set(event.pointerId, { ...held, ...now });
    forget();
    paint();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture(event.pointerId);
    // Let go: one more frame, with the textures laid whole.
    paint();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!camera.current) return;
    const turn: Record<string, [number, number]> = {
      // As a drag to that side.
      ArrowLeft: [-24, 0],
      ArrowRight: [24, 0],
      ArrowUp: [0, 24],
      ArrowDown: [0, -24],
    };
    const step = turn[event.key];
    if (step) {
      camera.current = event.shiftKey
        ? pan(camera.current, step[0], step[1], size.current)
        : orbit(camera.current, step[0], step[1]);
    } else if (event.key === '+' || event.key === '=') {
      camera.current = zoom(camera.current, 0.85, scene);
    } else if (event.key === '-' || event.key === '_') {
      camera.current = zoom(camera.current, 1 / 0.85, scene);
    } else if (event.key === '0') {
      camera.current = fitCamera(scene, size.current, room);
    } else {
      return;
    }
    event.preventDefault();
    sweep.current = null;
    setTouched(true);
    paint();
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-[#334155] bg-[#0a0f16]',
        large ? 'h-full w-full' : 'h-80 w-full',
      )}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        tabIndex={0}
        className="block h-full w-full cursor-grab touch-none outline-none select-none focus-visible:ring-2 focus-visible:ring-[#38bdf8] active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (pointers.current.size === 0 && forget()) paint();
        }}
        onDoubleClick={() => {
          open(false);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onKeyDown={onKeyDown}
      />
      <p className="pointer-events-none absolute top-2 left-2.5 font-mono text-[0.625rem] tracking-wider text-[#cbd5e1]/80 uppercase">
        {scene.stretch === 1 ? 'True scale' : `Depths drawn ×${String(scene.stretch)}`}
        {layers
          ? layers.cut >= 0
            ? ` · opened at the top of the ${formationZone(playZone ?? 0)?.short.split(' / ')[0] ?? 'play'}`
            : ''
          : ` · grid ${metres(scene.step)}`}
      </p>
      <button
        type="button"
        aria-label="Reset the view"
        title="Reset the view"
        onClick={() => {
          open(false);
        }}
        className="absolute right-2 bottom-2 rounded-md border border-[#475569] bg-[#0f172a]/70 p-1.5 text-[#e2e8f0] backdrop-blur-sm hover:bg-[#1e293b]"
      >
        <RotateCcw aria-hidden="true" className="size-3.5" />
      </button>
      <div
        role="status"
        className="pointer-events-none absolute bottom-2 left-2.5 max-w-[calc(100%-3.5rem)] text-[0.6875rem] leading-snug text-[#cbd5e1]/90"
      >
        {told ? (
          <div className="rounded-sm bg-[#0a0f16]/75 px-1.5 py-1">
            <p className="font-mono font-semibold text-white">{told.title}</p>
            {told.lines.map((line) => (
              <p key={line} className="tabular-nums">
                {line}
              </p>
            ))}
          </div>
        ) : (
          !touched && <p>Drag to turn · right-drag or Shift to move · scroll to zoom</p>
        )}
      </div>
    </div>
  );
}

/** A rock type's colour as a small box: the colour its layers have on the block. */
function swatch(rock: FormationRock): React.CSSProperties {
  return { backgroundColor: rock.earth };
}

/** Every layer under the well, from the surface down: its name, rock type, depth and thickness. */
function LayerList({
  column,
  playZone,
  dark,
}: {
  column: readonly FormationLayer[];
  playZone: number | null;
  dark: boolean;
}) {
  const faint = dark ? 'text-[#94a3b8]' : 'text-muted-foreground';
  // Depths from the model's own surface at the well: the top of its first layer.
  const ground = column[0]?.top ?? 0;
  return (
    <ol
      aria-label="Layers under this well"
      className={cn(
        'flex flex-col overflow-y-auto rounded-md border text-xs',
        dark ? 'h-full border-[#334155]' : 'max-h-72',
      )}
    >
      <li
        aria-hidden="true"
        className={cn(
          'sticky top-0 flex justify-between border-b px-2 py-1 text-[0.625rem] font-medium tracking-wider uppercase',
          dark ? 'border-[#1e293b] bg-[#0f172a] text-[#94a3b8]' : 'bg-muted text-muted-foreground',
        )}
      >
        <span>Layer and rock type</span>
        <span>Depth to its top</span>
      </li>
      {column.map((layer) => {
        const zone = formationZone(layer.zone);
        const rock = FORMATION_ROCKS[zone?.rock ?? 'unknown'];
        const play = layer.zone === playZone;
        return (
          <li
            key={layer.zone}
            aria-current={play ? 'true' : undefined}
            title={
              zone?.unit
                ? `Rock type as the Table of Formations colours the ${zone.unit} (${zone.column ?? ''})`
                : undefined
            }
            className={cn(
              'flex items-start gap-2 border-b px-2 py-1.5 last:border-b-0',
              dark && 'border-[#1e293b]',
              play && 'bg-[#38bdf8]/15',
            )}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-block size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/25"
              style={swatch(rock)}
            />
            <div className="min-w-0 grow">
              <p className="font-medium">
                {zone?.name ?? `Zone ${String(layer.zone)}`}
                {play && <span className="ml-1.5 font-semibold">· the play</span>}
              </p>
              <p className={faint}>
                {rock.label}
                {zone?.also.map((other) => (
                  <span key={other.unit}>
                    {' '}
                    · {other.unit}: {FORMATION_ROCKS[other.rock].label.toLowerCase()}
                  </span>
                ))}
              </p>
            </div>
            <div className="shrink-0 text-right font-mono tabular-nums">
              <p>{metres(Math.max(0, ground - layer.top))}</p>
              <p className={faint}>{metres(layer.top - layer.base)} thick</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Where the block's floor lies when the layers are shown: a little into the lowest layer. */
function floorUnder(column: readonly FormationLayer[], ground: number): number | undefined {
  const last = column[column.length - 1];
  if (!last) return undefined;
  // The lowest layer (the Precambrian) runs to the model's base, kilometres down: a strip of
  // it is enough.
  return Math.max(last.base, last.top - Math.max(120, (ground - last.top) * 0.05));
}

type Mode = 'wells' | 'layers';

/**
 * The 3D view of a well, for its panel: asked of the API once per well, then a canvas the
 * person turns. `chosen` is the leg picked out on the panel, drawn brightest.
 */
export function Well3d({
  uwi,
  chosen,
  organizationId,
  token,
}: {
  /** The well's main leg: its other legs and the wells nearby come with it. */
  uwi: string;
  chosen?: string | null;
  organizationId: string;
  token: string;
}) {
  const path = `/petroleum/st37/well-3d?${new URLSearchParams({ organization_id: organizationId, uwi }).toString()}`;
  const { answer, state } = useAnswer<Well3dAnswer>(path, token);
  const [mode, setMode] = useState<Mode>('wells');
  const [nearby, setNearby] = useState(true);
  const [large, setLarge] = useState(false);
  // The Layers view opens as the owner's pictures show such blocks: the depths drawn deeper so
  // every layer reads, and the block opened at the play.
  const [stretch, setStretch] = useState(3);
  const [opened, setOpened] = useState(true);

  // The layers are asked for once, for the ground under the well and its neighbours.
  const whole = useMemo(() => (answer ? well3dScene(answer, true) : null), [answer]);
  const layersPath = useMemo(() => {
    if (mode !== 'layers' || !whole) return null;
    const [west, south] = sceneLonLat(whole, whole.min[0], whole.min[1]);
    const [east, north] = sceneLonLat(whole, whole.max[0], whole.max[1]);
    const round = (n: number) => String(Math.round(n * 1000) / 1000);
    return `/petroleum/formation-layers?${new URLSearchParams({
      organization_id: organizationId,
      west: round(west - 0.001),
      south: round(south - 0.001),
      east: round(east + 0.001),
      north: round(north + 0.001),
    }).toString()}`;
  }, [mode, whole, organizationId]);
  const ground = useAnswer<FormationAnswer>(layersPath, token);
  const field = useMemo(
    () => (ground.answer && ground.answer.cells > 0 ? layerField(ground.answer) : null),
    [ground.answer],
  );
  const column = useMemo(
    () => (field && whole ? layersAt(field, whole.origin[0], whole.origin[1]) : []),
    [field, whole],
  );
  const layered = mode === 'layers' && field !== null && column.length > 0 && whole !== null;
  const duvernay = FORMATION_PLAY_ZONES.duvernay ?? null;
  const playZone = duvernay !== null && field?.zones.includes(duvernay) ? duvernay : null;
  // Opened at the play, the part of the block under its top is drawn lower by nearly half the
  // block's own depth, so the eye sees well into the opening: the floor goes down with it.
  const open = layered && opened && column.some((layer) => layer.zone === playZone);
  const under = layered ? floorUnder(column, whole.ground) : undefined;
  const gap = open && under !== undefined ? ((column[0]?.top ?? whole.ground) - under) * 0.45 : 0;
  const floor = under === undefined ? undefined : under - gap;
  const scene = useMemo(
    () =>
      answer
        ? well3dScene(
            answer,
            nearby,
            layered ? { stretch, ...(floor !== undefined && { floor }) } : {},
          )
        : null,
    [answer, nearby, layered, stretch, floor],
  );
  const layers = useMemo(
    () =>
      layered && scene
        ? layerScene(scene, field, { playZone, open, drop: gap * scene.stretch })
        : null,
    [layered, scene, field, playZone, open, gap],
  );
  const own = useMemo(() => scene?.lines.filter((line) => line.own) ?? [], [scene]);

  useEffect(() => {
    if (!large) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLarge(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [large]);

  if (state === 'loading' || state === 'idle') {
    return <p className="text-xs text-muted-foreground">The well in 3D: loading…</p>;
  }
  if (state === 'failed') {
    return <p className="text-xs text-muted-foreground">The well in 3D could not be loaded.</p>;
  }
  const ownLegs = answer.legs.filter((leg) => leg.own);
  if (!scene || ownLegs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No drilled path with depths for this well yet: nothing to show in 3D.
      </p>
    );
  }
  const others = new Set(answer.legs.filter((leg) => !leg.own).map((leg) => leg.licenceNumber));
  // The deepest point of the well's own legs, as it is (the scene may be stretched).
  let lowest: { x: number; y: number; elevation: number } | null = null;
  for (const line of own) {
    for (const [x, y, z] of line.points) {
      const elevation = trueZ(scene, z);
      if (!lowest || elevation < lowest.elevation) lowest = { x, y, elevation };
    }
  }
  const deepest = scene.ground - (lowest?.elevation ?? scene.ground);
  const longest = Math.max(
    ...own.map((line) =>
      lineLength(line.points.map(([x, y, z]) => [x, y, trueZ(scene, z)] as const)),
    ),
  );
  const calculated = own.some((line) => line.surveyed === false);
  const label = `Well ${uwi} under the ground, in 3D: ${String(own.length)} ${
    own.length === 1 ? 'leg' : 'legs'
  }, down to ${metres(deepest)} below the surface${
    nearby && others.size > 0 ? `, with ${String(others.size)} wells nearby` : ''
  }${layers ? `, through ${String(column.length)} layers of the ground` : ''}`;
  const statuses = [...new Set(scene.lines.map((line) => line.statusClass))];
  const faint = large ? 'text-[#94a3b8]' : 'text-muted-foreground';
  const pressed = (on: boolean) =>
    cn(
      'px-2.5 py-1 font-medium',
      on
        ? large
          ? 'bg-[#e2e8f0] text-[#0f172a]'
          : 'bg-foreground text-background'
        : large
          ? 'text-[#cbd5e1] hover:bg-[#1e293b]'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    );
  const frame = cn('inline-flex overflow-hidden rounded-md border', large && 'border-[#475569]');

  const view = (
    <Well3dCanvas
      // The large view is another canvas; every other change keeps the one being turned.
      key={String(large)}
      scene={scene}
      layers={layers}
      playZone={playZone}
      chosen={chosen ?? null}
      large={large}
      label={label}
    />
  );
  const switches = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <div role="group" aria-label="View" className={frame}>
        {(['wells', 'layers'] as const).map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={mode === each}
            onClick={() => {
              setMode(each);
            }}
            className={pressed(mode === each)}
          >
            {each === 'wells' ? 'Wells' : 'Layers'}
          </button>
        ))}
      </div>
      {layered && playZone !== null && (
        <div role="group" aria-label="Block" className={frame}>
          {[true, false].map((each) => (
            <button
              key={String(each)}
              type="button"
              aria-pressed={opened === each}
              title={
                each
                  ? 'The block opened at the top of the play: the legs that run in it show'
                  : 'The block whole'
              }
              onClick={() => {
                setOpened(each);
              }}
              className={pressed(opened === each)}
            >
              {each ? 'Opened' : 'Whole'}
            </button>
          ))}
        </div>
      )}
      {layered && (
        <div role="group" aria-label="Depth scale" className={frame}>
          {[1, 3].map((times) => (
            <button
              key={times}
              type="button"
              aria-pressed={stretch === times}
              title={
                times === 1
                  ? 'Depths as they are'
                  : 'Depths drawn three times deeper, so thin layers show'
              }
              onClick={() => {
                setStretch(times);
              }}
              className={pressed(stretch === times)}
            >
              {times === 1 ? 'True scale' : 'Depth ×3'}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setLarge(!large);
        }}
        className={cn(
          'ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium',
          large
            ? 'border-[#475569] text-[#f1f5f9] hover:bg-[#1e293b]'
            : 'hover:bg-muted hover:text-foreground',
        )}
      >
        {large ? (
          <Minimize2 aria-hidden="true" className="size-3.5" />
        ) : (
          <Maximize2 aria-hidden="true" className="size-3.5" />
        )}
        {large ? 'Close' : 'Expand'}
      </button>
    </div>
  );
  const neighbours = others.size > 0 && (
    <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={nearby}
        onChange={(event) => {
          setNearby(event.target.checked);
        }}
      />
      <span>
        Wells within {answer.nearbyKm} km
        <span className={faint}>
          {' '}
          ({others.size}
          {answer.truncated ? ', the nearest' : ''})
        </span>
      </span>
    </label>
  );
  const legend = (
    <ul
      aria-label="Statuses"
      className={cn(
        'flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6875rem]',
        large ? 'text-[#cbd5e1]' : 'text-muted-foreground',
      )}
    >
      {statuses.map((status) => (
        <li key={status} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-3 rounded-full ring-1 ring-[#64748b]/60"
            style={{ backgroundColor: WELL3D_COLOURS[status] }}
          />
          {ST37_STATUS_LABELS[status]}
        </li>
      ))}
    </ul>
  );
  const facts = (
    <p className={cn('text-xs', large ? 'text-[#cbd5e1]' : 'text-muted-foreground')}>
      Deepest point {metres(deepest)} below the surface · longest leg {metres(longest)} along its
      path.{' '}
      {calculated
        ? 'A dashed leg is a path the AER worked out, not a survey.'
        : 'Paths as surveyed.'}
    </p>
  );

  // What the layers say about this well, in words.
  const play = column.find((layer) => layer.zone === playZone);
  const lowestLayer =
    layered && lowest
      ? formationLayerAt(
          layersAt(field, ...sceneLonLat(scene, lowest.x, lowest.y)),
          lowest.elevation,
        )
      : null;
  const bottom = column[column.length - 1];
  // Depths of the layers from the model's own surface at the well.
  const surface = column[0]?.top ?? scene.ground;
  const down = (elevation: number) => metres(Math.max(0, surface - elevation));
  const about =
    mode !== 'layers' ? null : ground.state === 'loading' ? (
      <p className={cn('text-xs', faint)}>The ground&rsquo;s layers: loading…</p>
    ) : ground.state === 'failed' ? (
      <p className={cn('text-xs', faint)}>The ground&rsquo;s layers could not be loaded.</p>
    ) : !layered ? (
      <p className={cn('text-xs', faint)}>
        The ground&rsquo;s layers are not loaded for this place yet: the wells are shown alone.
      </p>
    ) : (
      <div className={cn('flex flex-col gap-1 text-xs', large && 'text-[#cbd5e1]')}>
        <p>
          {column.length} layers under this well, from the surface down
          {bottom
            ? ` to the ${formationZone(bottom.zone)?.short ?? 'lowest layer'} at ${down(bottom.top)}`
            : ''}
          .
          {play
            ? ` The ${formationZone(play.zone)?.name ?? 'play'} lies ${down(play.top)} to ${down(play.base)} down here, ${metres(play.top - play.base)} thick${open ? ': the block is opened at its top, where the legs that run in it show.' : '.'}`
            : ''}
          {lowestLayer
            ? ` The well's deepest point is in the ${formationZone(lowestLayer.zone)?.name ?? 'ground'}.`
            : ''}
        </p>
        <p className={faint}>
          Depths: {FORMATION_SOURCE_NAME}. Rock types: {FORMATION_ROCK_SOURCE_NAME}, each layer
          drawn with the texture and a natural colour of the rock type the table gives its unit. A
          layer the Survey models as several formations together is one layer here.
        </p>
      </div>
    );
  const list = layered && <LayerList column={column} playZone={playZone} dark={large} />;

  if (large) {
    return (
      <>
        <p className="text-xs text-muted-foreground">The 3D view is open over the map.</p>
        <div
          role="dialog"
          aria-label={`Well ${uwi} in 3D`}
          className="fixed inset-3 z-50 flex flex-col gap-2 rounded-card border border-[#334155] bg-[#0a0f16] p-3 text-[#f1f5f9] shadow-lg"
        >
          <div className="flex items-baseline gap-3">
            <p className="font-mono text-sm font-semibold">{uwi}</p>
            <p className="text-xs text-[#94a3b8]">Under the ground, in 3D</p>
          </div>
          {switches}
          <div className="flex min-h-0 grow gap-3">
            <div className="min-w-0 grow">{view}</div>
            {list && <div className="hidden w-96 shrink-0 md:block">{list}</div>}
          </div>
          {about}
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            {neighbours}
            {facts}
            {legend}
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {switches}
      {view}
      {neighbours}
      {about}
      {list}
      {facts}
      {legend}
    </div>
  );
}
