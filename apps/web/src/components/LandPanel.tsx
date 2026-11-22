import { landKeyText, landKeyTownship, rightsLines } from '@grain/domain';
import { useState } from 'react';

import {
  landExpiring,
  landHolderColour,
  type LandMapAgreement,
  type LandMapFreehold,
  type LandMapOffset,
  type LandShape,
} from '../lib/landMap';
import {
  landSaleState,
  SALE_UPCOMING,
  type LandSaleParcel,
  type LandSaleState,
} from '../lib/landSalesMap';
import type { MapBounds } from '../lib/mapbox';
import {
  landAgreementName,
  landBounds,
  landReadable,
  landToday,
  Swatch,
  type LandPick,
  type LandState,
} from './Land';
import { saleExact, saleHectares, saleMoney, type LandSalesState } from './LandSales';
import { MapPanel, MapTip, PanelBadge, PanelSection, PanelTiles, TipHead } from './MapPanel';
import { Button } from './ui/button';

/**
 * Land on the oil and gas map, shown two ways (F-265; the owner, 2026-11-22, from pictures of
 * another map): a box at the pointer with a few lines about the sale parcel or the land under
 * it, and, on a click, a panel that slides in from the right with everything about it, the
 * other land under the click listed below. Data from Alberta Energy and Minerals, named on the
 * panel; every figure is the province's own.
 */

type Land = Pick<LandState, 'agreements' | 'offsets' | 'freehold' | 'issuedFrom'>;
type Sales = Pick<LandSalesState, 'parcels'> & Partial<Pick<LandSalesState, 'documents'>>;

/** One piece of land under the pointer or a click. */
export type LandEntry =
  | { kind: 'sale'; key: string; parcel: LandSaleParcel }
  | { kind: 'agreement'; key: string; agreement: LandMapAgreement }
  | { kind: 'offset'; key: string; offset: LandMapOffset }
  | { kind: 'freehold'; key: string; freehold: LandMapFreehold };

/** What a key (`sale:12`, `png:7`) stands for, among what is loaded; null when it is not. */
export function landEntry(key: string, land: Land, sales: Sales): LandEntry | null {
  const cut = key.indexOf(':');
  const of = key.slice(0, cut);
  const id = key.slice(cut + 1);
  if (of === 'sale') {
    const parcel = sales.parcels.get(id);
    return parcel ? { kind: 'sale', key, parcel } : null;
  }
  if (of === 'png' || of === 'oil_sands') {
    const agreement = land.agreements.get(id);
    return agreement ? { kind: 'agreement', key, agreement } : null;
  }
  if (of === 'offset') {
    const offset = land.offsets.get(id);
    return offset ? { kind: 'offset', key, offset } : null;
  }
  if (of === 'freehold') {
    const freehold = land.freehold.get(id);
    return freehold ? { kind: 'freehold', key, freehold } : null;
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-19` as `Aug 19, 2026`; anything else as it is. */
export function landDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${String(Number(m[3]))}, ${String(m[1])}` : date;
}

/** `67150.00` as `$67,150`, `2296.32` as `$2,296.32`: to the cent only when there are cents. */
export function saleDollars(text: string): string {
  return saleExact(text.replace(/\.0+$/, ''));
}

const hectares = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ha`;

/** A parcel's land, a piece each, for reading; a key not in the usual form as published. */
export function saleLands(parcel: Pick<LandSaleParcel, 'land'>): string[] {
  return parcel.land
    .split(/\s+/)
    .filter((key) => key !== '')
    .map((key) => landKeyText(key) ?? key);
}

/** Lease or Licence, as the notice names the kind of contract; null when it names none. */
function saleKind(parcel: Pick<LandSaleParcel, 'contractType'>): string | null {
  if (parcel.contractType === null) return null;
  return parcel.contractType === 'LICENCE' ? 'Licence' : landReadable(parcel.contractType);
}

/** How a parcel stands, in a word or two: Sold, No offers, Upcoming, or its result as published. */
export function saleResult(
  parcel: Pick<LandSaleParcel, 'status' | 'saleDate'>,
  today: string,
): { state: LandSaleState; label: string } {
  const state = landSaleState(parcel, today);
  const label =
    state === 'sold'
      ? 'Sold'
      : state === 'upcoming'
        ? 'Upcoming'
        : parcel.status === 'NO OFFERS'
          ? 'No offers'
          : parcel.status === null
            ? 'No result published'
            : landReadable(parcel.status);
  return { state, label };
}

/** Each buyer with its share, when it is not the whole: `EXAMPLE LAND LTD. 100%; ...`. */
export function saleBuyers(buyers: string | null): { name: string; share: string | null }[] {
  return (buyers ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const m = /^(.*?)\s+(\d+(?:\.\d+)?)%$/.exec(part);
      const name = landReadable(m ? (m[1] ?? part) : part);
      return { name, share: m && m[2] !== '100' ? `${String(m[2])}%` : null };
    });
}

const SOLD = '#15803d';
const QUIET = '#78716c';
const STATE_COLOUR: Record<LandSaleState, string> = {
  sold: SOLD,
  no_offers: QUIET,
  upcoming: SALE_UPCOMING,
};

/** `Petroleum and natural gas` or `Oil sands`, short for the box at the pointer. */
const rightsShort = (a: Pick<LandMapAgreement, 'rights'>) =>
  a.rights === 'png' ? 'PNG' : 'Oil sands';

function freeholdTitle(f: LandMapFreehold): string {
  return f.nationalPark
    ? `National park: ${f.nationalPark}`
    : f.reserveName || f.reserveNumber
      ? `Reserve: ${f.reserveName ?? f.reserveNumber ?? ''}`
      : 'Freehold minerals (not the Crown’s)';
}

/**
 * The box at the pointer for the land under it: a sale parcel's number, date, first land and
 * result; an agreement's holder; an offset notice's deadline; or what land that is not the
 * Crown's is. Null when the key is of nothing loaded.
 */
export function LandTip({
  landKey,
  land,
  sales,
}: {
  landKey: string | null;
  land: Land;
  sales: Sales;
}) {
  const entry = landKey === null ? null : landEntry(landKey, land, sales);
  if (!entry) return null;
  if (entry.kind === 'sale') {
    const p = entry.parcel;
    const { state, label } = saleResult(p, landToday());
    const [first, ...rest] = saleLands(p);
    const area = p.hectares !== null ? saleHectares(p.hectares) : null;
    const buyers = saleBuyers(p.buyers);
    return (
      <MapTip>
        <TipHead title={p.contractNo} aside={landDay(p.saleDate)} />
        <p className="font-mono text-xs text-muted-foreground">
          PNG{first ? ` · ${first}` : ''}
          {rest.length > 0 ? ` +${String(rest.length)}` : ''}
        </p>
        <p className="mt-1.5 font-mono text-lg leading-tight font-semibold">
          {state === 'sold' && p.dollarsPerHectare ? `${saleExact(p.dollarsPerHectare)}/ha` : label}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {(state === 'sold' ? [p.bonus ? saleMoney(p.bonus) : null, area] : [area, saleKind(p)])
            .filter(Boolean)
            .join(' · ')}
        </p>
        {state === 'sold' && buyers.length > 0 && (
          <p className="mt-0.5 truncate text-xs">
            {buyers[0]?.name}
            {buyers.length > 1 ? ` +${String(buyers.length - 1)}` : ''}
          </p>
        )}
      </MapTip>
    );
  }
  if (entry.kind === 'agreement') {
    const a = entry.agreement;
    return (
      <MapTip>
        <TipHead
          title={`${a.agreementType}-${a.agreementNumber}`}
          aside={a.tract ? `tract ${a.tract}` : null}
        />
        <p className="font-mono text-xs text-muted-foreground">
          {[rightsShort(a), a.group ? landReadable(a.group) : null, a.status]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 leading-tight font-semibold">
          <Swatch colour={landHolderColour(a.holder)} />
          {a.holder ? landReadable(a.holder) : 'No holder named'}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {[
            a.areaHa !== null ? hectares(a.areaHa) : null,
            a.expiryText ? `expiry ${a.expiryText.toLowerCase()}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </MapTip>
    );
  }
  if (entry.kind === 'offset') {
    const o = entry.offset;
    return (
      <MapTip>
        <TipHead title={o.offsetNumber} aside={o.tract ? `tract ${o.tract}` : null} />
        <p className="font-mono text-xs text-muted-foreground">Offset notice</p>
        {o.holder && <p className="mt-1.5 leading-tight font-semibold">{landReadable(o.holder)}</p>}
        {o.expiryDate && (
          <p className="font-mono text-xs text-muted-foreground">
            Deadline {landDay(o.expiryDate)}
            {o.expiryDate < landToday() ? ' (passed)' : ''}
          </p>
        )}
      </MapTip>
    );
  }
  return (
    <MapTip>
      <p className="font-semibold">{freeholdTitle(entry.freehold)}</p>
      {entry.freehold.substances && (
        <p className="text-xs text-muted-foreground">{entry.freehold.substances}</p>
      )}
    </MapTip>
  );
}

/** The shape of a piece of land, for the map to move to it. */
function shapeOf(entry: LandEntry): LandShape {
  return entry.kind === 'sale'
    ? entry.parcel.shape
    : entry.kind === 'agreement'
      ? entry.agreement.shape
      : entry.kind === 'offset'
        ? entry.offset.shape
        : entry.freehold.shape;
}

/** The box around a shape with a little ground about it; null for a shape with no ground. */
export function landZoom(shape: LandShape): MapBounds | null {
  const box = landBounds(shape);
  if (!Number.isFinite(box.west) || !Number.isFinite(box.south)) return null;
  const pad = Math.max(0.004, (box.east - box.west) * 0.25, (box.north - box.south) * 0.25);
  return [box.west - pad, box.south - pad, box.east + pad, box.north + pad];
}

/** A piece of land in two lines, as the panel lists the other land under a click. */
function entryLines(entry: LandEntry, today: string): { title: string; note: string } {
  if (entry.kind === 'sale') {
    const p = entry.parcel;
    const { state, label } = saleResult(p, today);
    return {
      title: `Sale parcel ${p.contractNo} · ${landDay(p.saleDate)}`,
      note:
        state === 'sold'
          ? [
              p.dollarsPerHectare ? `${saleExact(p.dollarsPerHectare)}/ha` : label,
              saleBuyers(p.buyers)[0]?.name,
            ]
              .filter(Boolean)
              .join(' · ')
          : label,
    };
  }
  if (entry.kind === 'agreement') {
    const a = entry.agreement;
    return {
      title: a.holder ? landReadable(a.holder) : 'No holder named',
      note: [landAgreementName(a), a.areaHa !== null ? hectares(a.areaHa) : null]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (entry.kind === 'offset') {
    const o = entry.offset;
    return {
      title: `Offset notice ${o.offsetNumber}${o.tract ? `, tract ${o.tract}` : ''}`,
      note: [o.holder ? landReadable(o.holder) : null, o.expiryDate && `deadline ${o.expiryDate}`]
        .filter(Boolean)
        .join(' · '),
    };
  }
  return { title: freeholdTitle(entry.freehold), note: entry.freehold.substances ?? '' };
}

/** A zone as the province writes it, a clause a line. */
function Rights({ zone }: { zone: string }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[0.8125rem] leading-snug">
      {rightsLines(zone).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** Codes kept as one text, separated by spaces, as a list; none for null. */
function codeList(text: string | null | undefined): string[] {
  return (text ?? '').split(/\s+/).filter((code) => code !== '');
}

/** Codes side by side, as published. */
function Codes({ codes }: { codes: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
      {codes.map((code) => (
        <li key={code}>{code}</li>
      ))}
    </ul>
  );
}

/** At most this many other pieces of land are listed under the one shown. */
const OTHERS_MAX = 8;

/**
 * The panel of the land clicked, on the right of the map. The first piece under the click
 * leads (a sale parcel before the land held, the newest sale first); the others are listed
 * below, and a click on one of them shows it in its place.
 */
export function LandPanel({
  pick,
  land,
  sales,
  onClose,
  goTo,
}: {
  pick: LandPick | null;
  land: Land;
  sales: Sales;
  onClose: () => void;
  /** Moves the map to the land shown; without it there is no Zoom button. */
  goTo?: (bounds: MapBounds) => void;
}) {
  // The piece shown in full: the first under the click until another is chosen below. The
  // map page gives each click a panel of its own (a key), so a new click starts afresh.
  const [chosen, setChosen] = useState<string | null>(null);
  if (!pick) return null;
  const entries = pick.keys
    .map((key) => landEntry(key, land, sales))
    .filter((entry): entry is LandEntry => entry !== null);
  const lead = entries.find((entry) => entry.key === chosen) ?? entries[0];
  if (!lead) return null;
  const today = landToday();
  const others = entries.filter((entry) => entry !== lead);
  const bounds = goTo ? landZoom(shapeOf(lead)) : null;
  const canZoom = bounds !== null && goTo !== undefined;
  // The Zoom button, and beside it links to the province's own documents, each in a new tab.
  const zoom = (label: string, links: readonly { label: string; href: string }[] = []) =>
    (canZoom || links.length > 0) && (
      <div className="mt-3 flex flex-wrap gap-2">
        {bounds && goTo && (
          <Button
            size="sm"
            onClick={() => {
              goTo(bounds);
            }}
          >
            {label}
          </Button>
        )}
        {links.map((link) => (
          <Button key={link.label} size="sm" variant="outline" asChild>
            <a href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          </Button>
        ))}
      </div>
    );
  const foot = (
    <>
      {others.length > 0 && (
        <PanelSection title="Also here" count={others.length}>
          <ul className="flex flex-col gap-1" aria-label="Other land here">
            {others.slice(0, OTHERS_MAX).map((entry) => {
              const lines = entryLines(entry, today);
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setChosen(entry.key);
                    }}
                    className="w-full rounded-md px-2 py-1 text-left hover:bg-muted"
                  >
                    <span className="block font-medium">{lines.title}</span>
                    {lines.note && (
                      <span className="block text-xs text-muted-foreground">{lines.note}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {others.length > OTHERS_MAX && (
            <p className="mt-1 text-xs text-muted-foreground">
              +{others.length - OTHERS_MAX} more here: zoom in and click a smaller spot.
            </p>
          )}
        </PanelSection>
      )}
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        Alberta Energy and Minerals, Government of Alberta. Not an official record.
      </p>
    </>
  );

  if (lead.kind === 'sale') {
    const p = lead.parcel;
    const { state, label } = saleResult(p, today);
    const kind = saleKind(p);
    const lands = saleLands(p);
    const buyers = saleBuyers(p.buyers);
    const issued = state === 'sold' ? land.issuedFrom(p.saleDate, p.contractNo) : null;
    const township = landKeyTownship(p.land.split(/\s+/)[0] ?? '');
    const documents = sales.documents?.[p.saleDate];
    // The results exist once the sale is held.
    const links = [
      documents?.notice ? { label: 'Notice PDF', href: documents.notice } : null,
      documents?.results && state !== 'upcoming'
        ? { label: 'Results PDF', href: documents.results }
        : null,
    ].filter((link): link is { label: string; href: string } => link !== null);
    const restrictions = codeList(p.restrictions);
    const reversionZones = codeList(p.reversionZones);
    return (
      <MapPanel
        label={`Sale parcel ${p.contractNo}`}
        eyebrow={
          ['Petroleum & natural gas', kind].filter(Boolean).join(' ') +
          (p.region ? ` · ${landReadable(p.region)}` : '')
        }
        title={p.contractNo}
        aside={landDay(p.saleDate)}
        onClose={onClose}
      >
        <PanelBadge colour={STATE_COLOUR[state]}>
          {state === 'sold' ? '✓ ' : ''}
          {label}
        </PanelBadge>
        <PanelTiles
          tiles={[
            { label: 'Bonus', value: p.bonus ? saleDollars(p.bonus) : '—' },
            {
              label: 'Per hectare',
              value: p.dollarsPerHectare ? `${saleExact(p.dollarsPerHectare)}/ha` : '—',
            },
            { label: 'Area', value: p.hectares !== null ? saleHectares(p.hectares) : '—' },
          ]}
        />
        {zoom('Zoom to parcel', links)}
        {buyers.length > 0 && (
          <PanelSection title={buyers.length === 1 ? 'Buyer' : 'Buyers'}>
            <ul className="flex flex-col gap-0.5">
              {buyers.map((buyer) => (
                <li key={`${buyer.name}|${buyer.share ?? ''}`}>
                  {buyer.name}
                  {buyer.share && (
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {buyer.share}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </PanelSection>
        )}
        {issued && (
          <PanelSection title="Held today">
            <p className="flex flex-wrap items-center gap-x-1.5">
              <Swatch colour={landHolderColour(issued.holder)} />
              <span>{issued.holder ? landReadable(issued.holder) : 'No holder named'}</span>
              <span className="font-mono text-xs text-muted-foreground">
                · agreement {issued.agreementNumber}
              </span>
            </p>
          </PanelSection>
        )}
        {p.zone && (
          <PanelSection title="Rights">
            <Rights zone={p.zone} />
          </PanelSection>
        )}
        <PanelSection title="Lands" count={lands.length}>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs" aria-label="Lands">
            {lands.map((text, i) => (
              // The same land can be listed twice (two tracts with different rights).
              <li key={`${text}|${String(i)}`}>{text}</li>
            ))}
          </ul>
          {p.inexact && (
            <p className="mt-2 text-xs text-muted-foreground">
              The shape on the map is not exact: part of this parcel is a portion of its land, or
              lies outside the area loaded.
            </p>
          )}
        </PanelSection>
        {restrictions.length > 0 && (
          <PanelSection title="Restriction codes">
            <Codes codes={restrictions} />
            <p className="mt-1.5 text-xs text-muted-foreground">
              What each restriction says is in the sale’s notice.
            </p>
          </PanelSection>
        )}
        {reversionZones.length > 0 && (
          <PanelSection title="Deeper rights reversion zones">
            <Codes codes={reversionZones} />
          </PanelSection>
        )}
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          {[township && `MRT ${township}`, `Sale ${landDay(p.saleDate)}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {foot}
      </MapPanel>
    );
  }

  if (lead.kind === 'agreement') {
    const a = lead.agreement;
    const group = a.group === 'LICENSE' ? 'licence' : (a.group ?? 'agreement').toLowerCase();
    return (
      <MapPanel
        label={landAgreementName(a)}
        eyebrow={`${a.rights === 'png' ? 'Petroleum & natural gas' : 'Oil sands'} ${group} · held today`}
        title={`${a.agreementType}-${a.agreementNumber}`}
        aside={a.tract ? `tract ${a.tract}` : null}
        onClose={onClose}
      >
        {(a.status ?? a.vintage) && (
          <PanelBadge colour={QUIET}>
            {[a.status, a.vintage].filter(Boolean).join(' · ')}
          </PanelBadge>
        )}
        <PanelTiles
          tiles={[
            { label: 'Area', value: a.areaHa !== null ? hectares(a.areaHa) : '—' },
            { label: 'Term from', value: a.termDate ?? '—' },
            { label: 'Expiry', value: a.expiryText ? a.expiryText.toLowerCase() : '—' },
          ]}
        />
        {landExpiring(a.expiryText, today) && (
          <p className="mt-2 text-xs font-medium">Expires within 12 months.</p>
        )}
        {zoom('Zoom to tract')}
        <PanelSection title="Holder">
          <p className="flex items-center gap-1.5">
            <Swatch colour={landHolderColour(a.holder)} />
            {a.holder ? landReadable(a.holder) : 'No holder named'}
          </p>
          {a.parties && a.parties !== a.holder && (
            <p className="mt-1 text-xs text-muted-foreground">Parties: {a.parties}</p>
          )}
        </PanelSection>
        {a.zone && (
          <PanelSection title="Rights">
            <Rights zone={a.zone} />
          </PanelSection>
        )}
        {a.continuationDate && (
          <PanelSection title="Term">
            <p>Continued {a.continuationDate}</p>
          </PanelSection>
        )}
        {foot}
      </MapPanel>
    );
  }

  if (lead.kind === 'offset') {
    const o = lead.offset;
    return (
      <MapPanel
        label={`Offset notice ${o.offsetNumber}`}
        eyebrow="Offset notice"
        title={o.offsetNumber}
        aside={o.tract ? `tract ${o.tract}` : null}
        onClose={onClose}
      >
        {o.expiryDate && (
          <PanelBadge colour={o.expiryDate < today ? QUIET : SALE_UPCOMING}>
            Deadline {o.expiryDate}
            {o.expiryDate < today ? ' (passed)' : ''}
          </PanelBadge>
        )}
        {zoom('Zoom to notice')}
        {o.holder && (
          <PanelSection title="Holder">
            <p>{landReadable(o.holder)}</p>
          </PanelSection>
        )}
        {o.zone && (
          <PanelSection title="Rights">
            <Rights zone={o.zone} />
          </PanelSection>
        )}
        {foot}
      </MapPanel>
    );
  }

  const f = lead.freehold;
  return (
    <MapPanel
      label={freeholdTitle(f)}
      eyebrow="Not Crown land"
      title={
        f.nationalPark ? 'National park' : f.reserveName || f.reserveNumber ? 'Reserve' : 'Freehold'
      }
      onClose={onClose}
    >
      <p className="mt-2">{freeholdTitle(f)}</p>
      {zoom('Zoom to land')}
      {f.substances && (
        <PanelSection title="Substances">
          <p>{f.substances}</p>
        </PanelSection>
      )}
      {foot}
    </MapPanel>
  );
}
