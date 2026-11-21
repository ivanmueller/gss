import { formatAlberta, type Bbox } from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  LAND_COLOURS,
  LAND_LABELS,
  landFeatures,
  landKey,
  type LandClass,
  type LandMapAgreement,
  type LandMapFreehold,
  type LandMapOffset,
  type LandView,
} from '../lib/landMap';

/**
 * Land held today on the oil and gas map (F-241): a Land panel (a switch for each kind, how
 * many are in view, the source) and the card of the land clicked. Data from Alberta Energy and
 * Minerals, named wherever it is shown, as the Open Government Licence - Alberta asks
 * (docs/DECISIONS.md, 2026-11-21).
 */

export const LAND_KINDS = ['agreements', 'offsets', 'freehold'] as const;
export type LandKind = (typeof LAND_KINDS)[number];

/**
 * The zoom each kind is drawn from: farther out a view holds more shapes than can be sent and
 * drawn at once (about 135 km across at zoom 10 on a wide screen).
 */
export const LAND_FROM: Record<LandKind, number> = { agreements: 10, offsets: 8, freehold: 11 };

const KIND_LABELS: Record<LandKind, string> = {
  agreements: 'Crown agreements',
  offsets: 'Offset notices',
  freehold: 'Not the Crown’s',
};

interface Cut<T> {
  truncated: boolean;
  items: T[];
}

interface Answer {
  source: {
    name: string;
    loads: { layer: string; loadedAt: string; area: Bbox; shapes: number }[];
  };
  agreements: Cut<LandMapAgreement>;
  offsets: Cut<LandMapOffset>;
  freehold: Cut<LandMapFreehold>;
}

/** Land is only in Alberta: a view is cut to it before asking. */
const ALBERTA: Bbox = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };

/** The kinds to ask for: those switched on that the zoom is close enough to draw. */
export function landWanted(on: Record<LandKind, boolean>, zoom: number): LandKind[] {
  return LAND_KINDS.filter((kind) => on[kind] && zoom >= LAND_FROM[kind]);
}

/** The box asked for: the view and a sixth again on each side, within Alberta; null outside. */
export function landRequest(view: Bbox): Bbox | null {
  const padX = (view.east - view.west) / 6;
  const padY = (view.north - view.south) / 6;
  const box = {
    west: Math.max(ALBERTA.west, view.west - padX),
    south: Math.max(ALBERTA.south, view.south - padY),
    east: Math.min(ALBERTA.east, view.east + padX),
    north: Math.min(ALBERTA.north, view.north + padY),
  };
  return box.west < box.east && box.south < box.north ? box : null;
}

/** The last answer that came back (or failed): the box and kinds it was for. */
interface Settled {
  key: string;
  asked: Bbox;
  kinds: readonly LandKind[];
  answer: Answer | null;
  failed: boolean;
}

/**
 * Whether the land already asked for serves this view: the same kinds or more, the view inside
 * the box asked for, and nothing left out of that answer for being too many.
 */
export function landCovers(
  settled: Pick<Settled, 'asked' | 'kinds' | 'answer'>,
  view: Bbox,
  kinds: readonly LandKind[],
): boolean {
  if (!settled.answer) return false;
  if (kinds.some((kind) => !settled.kinds.includes(kind) || settled.answer?.[kind].truncated)) {
    return false;
  }
  const { asked } = settled;
  return (
    Math.max(ALBERTA.west, view.west) >= asked.west &&
    Math.min(ALBERTA.east, view.east) <= asked.east &&
    Math.max(ALBERTA.south, view.south) >= asked.south &&
    Math.min(ALBERTA.north, view.north) <= asked.north
  );
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** What a click on the map found: the keys of the land under it, and where. */
export interface LandPick {
  keys: string[];
  x: number;
  y: number;
}

export interface LandState {
  view: LandView | null;
  agreements: ReadonlyMap<string, LandMapAgreement>;
  offsets: ReadonlyMap<string, LandMapOffset>;
  freehold: ReadonlyMap<string, LandMapFreehold>;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  /** The land whose card is open, drawn with a bold outline. */
  setPicked: (keys: readonly string[]) => void;
  panel: (tone: 'light' | 'dark') => React.ReactNode;
}

const NONE: readonly string[] = [];

export function useLand(organizationId: string, token: string): LandState {
  const [on, setOn] = useState<Record<LandKind, boolean>>({
    agreements: true,
    offsets: true,
    freehold: false,
  });
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [picked, setPicked] = useState<readonly string[]>(NONE);

  const wanted = useMemo(() => (at ? landWanted(on, at.zoom) : []), [on, at]);
  const covered =
    settled !== null && !settled.failed && at !== null && landCovers(settled, at.view, wanted);
  const box = at !== null && wanted.length > 0 && !covered ? landRequest(at.view) : null;
  const key = box
    ? `${wanted.join(',')}:${String(round(box.west))},${String(round(box.south))},${String(round(box.east))},${String(round(box.north))}`
    : null;
  const loading = key !== null && settled?.key !== key;
  const failed = settled?.failed === true && settled.key === key;

  useEffect(() => {
    if (key === null || box === null) return;
    const controller = new AbortController();
    const kinds = [...wanted];
    const query = new URLSearchParams({
      organization_id: organizationId,
      west: String(round(box.west)),
      south: String(round(box.south)),
      east: String(round(box.east)),
      north: String(round(box.north)),
      layers: kinds.join(','),
    });
    apiJson<Answer>(`/petroleum/land?${query.toString()}`, token, { signal: controller.signal })
      .then((answer) => {
        setSettled({ key, asked: box, kinds, answer, failed: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // The land already drawn stays; moving the map asks again.
        setSettled((before) => ({
          key,
          asked: box,
          kinds: before?.kinds ?? [],
          answer: before?.answer ?? null,
          failed: true,
        }));
      });
    return () => {
      controller.abort();
    };
    // `box` and `wanted` are described by `key`; asking again for the same would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, organizationId, token]);

  const answer = settled?.answer ?? null;
  // Only the kinds wanted now are drawn: one switched off, or too far out, is let go.
  const shown = useMemo(
    () => ({
      agreements: wanted.includes('agreements') ? (answer?.agreements.items ?? []) : [],
      offsets: wanted.includes('offsets') ? (answer?.offsets.items ?? []) : [],
      freehold: wanted.includes('freehold') ? (answer?.freehold.items ?? []) : [],
    }),
    [answer, wanted],
  );
  const features = useMemo(() => landFeatures(shown), [shown]);
  const agreements = useMemo(() => new Map(shown.agreements.map((a) => [a.id, a])), [shown]);
  const offsets = useMemo(() => new Map(shown.offsets.map((o) => [o.id, o])), [shown]);
  const freehold = useMemo(() => new Map(shown.freehold.map((f) => [f.id, f])), [shown]);
  const anyOn = LAND_KINDS.some((kind) => on[kind]);
  const view = useMemo<LandView | null>(
    () => (anyOn ? { land: features, picked } : null),
    [anyOn, features, picked],
  );

  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt(bbox ? { view: bbox, zoom } : null);
  }, []);

  const loads = answer?.source.loads ?? [];
  const loadedAt = loads.map((l) => l.loadedAt).sort()[loads.length - 1] ?? null;

  const panel = (tone: 'light' | 'dark') => (
    <div
      className="flex w-72 flex-col gap-2 rounded-card border bg-card/95 p-3 shadow-xs"
      role="group"
      aria-label="Land"
    >
      <p className="text-sm font-semibold">Land</p>
      <ul className="flex flex-col gap-0.5" aria-label="Land shown">
        {LAND_KINDS.map((kind) => {
          const far = at !== null && at.zoom < LAND_FROM[kind];
          const classes: LandClass[] =
            kind === 'agreements'
              ? ['png', 'oil_sands']
              : kind === 'offsets'
                ? ['offset']
                : ['freehold'];
          return (
            <li key={kind}>
              <label className="flex items-center gap-2 rounded-sm px-1 py-0.5 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={on[kind]}
                  onChange={(event) => {
                    setOn((before) => ({ ...before, [kind]: event.target.checked }));
                  }}
                />
                <span className="flex shrink-0 gap-0.5" aria-hidden="true">
                  {classes.map((of) => (
                    <span
                      key={of}
                      title={LAND_LABELS[of]}
                      className="inline-block size-2.5 rounded-[2px] border"
                      style={{
                        borderColor: LAND_COLOURS[tone][of],
                        backgroundColor: `${LAND_COLOURS[tone][of]}40`,
                      }}
                    />
                  ))}
                </span>
                <span className="grow">{KIND_LABELS[kind]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {on[kind] ? (far ? 'zoom in' : shown[kind].length.toLocaleString('en-CA')) : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {failed && (
        <p className="text-xs text-destructive">
          The land could not be loaded. Move the map to try again.
        </p>
      )}
      {wanted.some((kind) => answer?.[kind].truncated) && (
        <p className="text-xs text-muted-foreground">
          More land than can be drawn at once here: zoom in to see all of it.
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">
          About this data
        </summary>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p>
            Land held today. Crown agreements: petroleum and natural gas (green) and oil sands
            (amber) leases and licences, a shape for each tract; agreements for different zones lie
            over one another, so the colour deepens where there are several. Offset notices: the
            active ones, with a dashed edge. Not the Crown’s: land whose petroleum and natural gas
            belongs to someone other than the province (freehold, national parks, reserves); the
            province names no owner. Click land for its details.
          </p>
          <p>Each kind is drawn from a zoom close enough to hold it: zoom in where it says so.</p>
          <p>
            {loadedAt
              ? `${answer?.source.name ?? ''}, public map services; loaded ${formatAlberta(loadedAt, { weekday: false })}, for the area of the Duvernay's wells only so far. Not an official record.`
              : answer
                ? 'No land loaded yet.'
                : 'Alberta Energy and Minerals, Government of Alberta, public map services.'}
          </p>
        </div>
      </details>
    </div>
  );

  return { view, agreements, offsets, freehold, onViewChange, setPicked, panel };
}

const hectares = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ha`;

/** "Lease 002-924, tract 00": an agreement as the province numbers it. */
export function landAgreementName(a: LandMapAgreement): string {
  const kind = a.group === 'LEASE' ? 'Lease' : a.group === 'LICENSE' ? 'Licence' : 'Agreement';
  return `${kind} ${a.agreementType}-${a.agreementNumber}${a.tract ? `, tract ${a.tract}` : ''}`;
}

/** At most this many pieces of land are written out on one card. */
const CARD_MAX = 6;

/**
 * The card of the land clicked: every agreement, offset notice and piece of non-Crown land
 * under the click, the agreements first, kept open until closed.
 */
export function LandCard({
  pick,
  land,
  onClose,
}: {
  pick: LandPick | null;
  land: Pick<LandState, 'agreements' | 'offsets' | 'freehold'>;
  onClose: () => void;
}) {
  if (!pick) return null;
  const rows: React.ReactNode[] = [];
  for (const key of pick.keys) {
    const cut = key.indexOf(':');
    const of = key.slice(0, cut);
    const id = key.slice(cut + 1);
    const agreement = of === 'png' || of === 'oil_sands' ? land.agreements.get(id) : undefined;
    const offset = of === 'offset' ? land.offsets.get(id) : undefined;
    const freehold = of === 'freehold' ? land.freehold.get(id) : undefined;
    if (agreement) {
      rows.push(
        <li key={landKey(agreement.rights, id)}>
          <p className="font-semibold">{landAgreementName(agreement)}</p>
          <p className="text-xs text-muted-foreground">
            {[
              agreement.rights === 'png' ? 'Petroleum and natural gas' : 'Oil sands',
              agreement.status,
              agreement.vintage,
              agreement.areaHa !== null ? hectares(agreement.areaHa) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {agreement.holder && <p>{agreement.holder}</p>}
          {agreement.parties && agreement.parties !== agreement.holder && (
            <p className="text-xs text-muted-foreground">Parties: {agreement.parties}</p>
          )}
          {agreement.zone && <p className="text-xs text-muted-foreground">{agreement.zone}</p>}
          <p className="text-xs text-muted-foreground">
            {[
              agreement.termDate && `Term from ${agreement.termDate}`,
              agreement.continuationDate && `continued ${agreement.continuationDate}`,
              agreement.expiryText && `expiry: ${agreement.expiryText}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </li>,
      );
    } else if (offset) {
      rows.push(
        <li key={landKey('offset', id)}>
          <p className="font-semibold">
            Offset notice {offset.offsetNumber}
            {offset.tract ? `, tract ${offset.tract}` : ''}
          </p>
          {offset.holder && <p>{offset.holder}</p>}
          {offset.zone && <p className="text-xs text-muted-foreground">{offset.zone}</p>}
          {offset.expiryDate && (
            <p className="text-xs text-muted-foreground">Expiry {offset.expiryDate}</p>
          )}
        </li>,
      );
    } else if (freehold) {
      rows.push(
        <li key={landKey('freehold', id)}>
          <p className="font-semibold">
            {freehold.nationalPark
              ? `National park: ${freehold.nationalPark}`
              : freehold.reserveName || freehold.reserveNumber
                ? `Reserve: ${freehold.reserveName ?? freehold.reserveNumber ?? ''}`
                : 'Not the Crown’s minerals'}
          </p>
          {freehold.substances && (
            <p className="text-xs text-muted-foreground">{freehold.substances}</p>
          )}
        </li>,
      );
    }
  }
  if (rows.length === 0) return null;
  const more = rows.length - CARD_MAX;
  // Opens to the left of the click near the window's right edge, and above it near the bottom.
  const left = pick.x > window.innerWidth - 360;
  const up = pick.y > window.innerHeight - 320;
  return (
    <div
      role="dialog"
      aria-label="Land here"
      className="absolute z-30 max-h-[min(24rem,calc(100%-1rem))] w-80 overflow-y-auto rounded-card border bg-card p-3 text-sm shadow-md"
      style={{
        left: pick.x,
        top: pick.y,
        transform: `translate(${left ? 'calc(-100% - 14px)' : '14px'}, ${up ? 'calc(-100% - 14px)' : '14px'})`,
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-1.5 right-1.5 rounded-sm px-1.5 text-base leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        ×
      </button>
      <ul className="flex flex-col gap-2 pr-4">{rows.slice(0, CARD_MAX)}</ul>
      {more > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{more} more here: zoom in and click a smaller spot.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Alberta Energy and Minerals, Government of Alberta. Not an official record.
      </p>
    </div>
  );
}
