import { ST37_STATUS_LABELS } from '@grain/domain';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiJson } from '../lib/api';
import { cn } from '../lib/utils';
import {
  between,
  fitCamera,
  lens,
  lineLength,
  orbit,
  pan,
  pickLine,
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
 * chart"). The well's legs along their real paths, with the other wells nearby, in a block of
 * ground that turns with a drag, moves with a right or Shift drag (or two fingers) and zooms
 * with the wheel (or a pinch). True to scale: no depth is stretched. The AER's ST37 paths, used
 * on the owner's decision (docs/DECISIONS.md, 2026-11-19): members only, nothing downloaded.
 */

const metres = (n: number) => `${Math.round(n).toLocaleString('en-CA')} m`;

/** Answers already read in this visit, by address. */
const cache = new Map<string, Well3dAnswer>();

/** For tests: forget the answers read. */
export function clearWell3dCache() {
  cache.clear();
}

function useWell3d(path: string, token: string) {
  const [loaded, setLoaded] = useState<{ path: string; failed: boolean } | null>(null);
  useEffect(() => {
    if (cache.has(path)) return;
    const controller = new AbortController();
    apiJson<Well3dAnswer>(path, token, { signal: controller.signal })
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
  const answer = cache.get(path);
  if (answer) return { answer, state: 'ok' as const };
  if (loaded?.path === path && loaded.failed) return { answer: null, state: 'failed' as const };
  return { answer: null, state: 'loading' as const };
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What the pointer is on, in words: the leg, and how deep the point lies. */
function hitText(scene: Scene, hit: Well3dHit) {
  const depth = scene.ground - hit.point[2];
  return {
    uwi: hit.line.uwi,
    who: [ST37_STATUS_LABELS[hit.line.statusClass], hit.line.own ? null : hit.line.licensee]
      .filter(Boolean)
      .join(' · '),
    where: `${metres(Math.max(0, depth))} below the surface · ${
      hit.point[2] >= 0 ? metres(hit.point[2]) : `−${metres(-hit.point[2])}`
    } above sea level`,
  };
}

/**
 * The canvas and its controls. The camera lives in a ref and the picture is painted on the
 * next frame after anything changes, so a drag never waits on React.
 */
function Well3dCanvas({
  scene,
  chosen,
  large,
  label,
}: {
  scene: Scene;
  chosen: string | null;
  large: boolean;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef<Size>({ width: 0, height: 0 });
  const camera = useRef<Camera | null>(null);
  const hit = useRef<Well3dHit | null>(null);
  const frame = useRef(0);
  const sweep = useRef<{ from: Camera; to: Camera; start: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; move: boolean }>());
  const chosenRef = useRef(chosen);
  // The painter itself, for the frame that asks for another while a sweep runs.
  const again = useRef<() => void>(() => undefined);
  const [told, setTold] = useState<ReturnType<typeof hitText> | null>(null);
  const [touched, setTouched] = useState(false);

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
      camera.current ??= fitCamera(scene, size.current);
      const ratio = window.devicePixelRatio || 1;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawWell3d(ctx, scene, camera.current, size.current, {
        hit: hit.current,
        chosen: chosenRef.current,
      });
      if (sweep.current) again.current();
    });
  }, [scene]);
  useEffect(() => {
    again.current = paint;
  }, [paint]);

  // The opening view: from straight above, as the map shows the well, down to the side.
  const open = useCallback(
    (animate: boolean) => {
      const to = fitCamera(scene, size.current);
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
    [scene, paint],
  );

  useEffect(() => {
    chosenRef.current = chosen;
    paint();
  }, [chosen, paint]);

  // The canvas follows its box: sharp on any screen, refitted when the box changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let first = true;
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      size.current = { width: box.width, height: box.height };
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
      if (first && box.width > 0) {
        first = false;
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

  const point = (event: React.PointerEvent) => {
    if (!camera.current) return;
    const { x, y } = at(event);
    const found = pickLine(scene, lens(camera.current, size.current), x, y, 9);
    if (!found && !hit.current) return;
    hit.current = found;
    setTold(found ? hitText(scene, found) : null);
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
    if (hit.current) {
      hit.current = null;
      setTold(null);
    }
    paint();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!camera.current) return;
    const turn: Record<string, [number, number]> = {
      ArrowLeft: [24, 0],
      ArrowRight: [-24, 0],
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
      camera.current = fitCamera(scene, size.current);
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
          if (hit.current && pointers.current.size === 0) {
            hit.current = null;
            setTold(null);
            paint();
          }
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
        True scale · grid {metres(scene.step)}
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
        className="pointer-events-none absolute bottom-2 left-2.5 max-w-[calc(100%-3.5rem)] text-[0.6875rem] leading-snug text-[#cbd5e1]/85"
      >
        {told ? (
          <>
            <p className="font-mono font-semibold text-white">{told.uwi}</p>
            <p>{told.who}</p>
            <p className="tabular-nums">{told.where}</p>
          </>
        ) : (
          !touched && <p>Drag to turn · right-drag or Shift to move · scroll to zoom</p>
        )}
      </div>
    </div>
  );
}

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
  const { answer, state } = useWell3d(path, token);
  const [nearby, setNearby] = useState(true);
  const [large, setLarge] = useState(false);
  const scene = useMemo(() => (answer ? well3dScene(answer, nearby) : null), [answer, nearby]);
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

  if (state === 'loading') {
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
  const deepest = Math.max(
    ...own.map((line) => scene.ground - Math.min(...line.points.map((p) => p[2]))),
  );
  const longest = Math.max(...own.map((line) => lineLength(line.points)));
  const calculated = own.some((line) => line.surveyed === false);
  const label = `Well ${uwi} under the ground, in 3D: ${String(own.length)} ${
    own.length === 1 ? 'leg' : 'legs'
  }, down to ${metres(deepest)} below the surface${
    nearby && others.size > 0 ? `, with ${String(others.size)} wells nearby` : ''
  }`;
  const statuses = [...new Set(scene.lines.map((line) => line.statusClass))];
  const view = (
    <Well3dCanvas
      // A new scene (the other wells on or off, the large view) starts from its own opening.
      key={`${String(nearby)}:${String(large)}`}
      scene={scene}
      chosen={chosen ?? null}
      large={large}
      label={label}
    />
  );
  const controls = (
    <div className="flex items-center gap-3 text-xs">
      {others.size > 0 && (
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={nearby}
            onChange={(event) => {
              setNearby(event.target.checked);
            }}
          />
          <span>
            Wells within {answer.nearbyKm} km
            <span className={large ? 'text-[#94a3b8]' : 'text-muted-foreground'}>
              {' '}
              ({others.size}
              {answer.truncated ? ', the nearest' : ''})
            </span>
          </span>
        </label>
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
          <div className="min-h-0 grow">{view}</div>
          {controls}
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            {facts}
            {legend}
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {view}
      {controls}
      {facts}
      {legend}
    </div>
  );
}
