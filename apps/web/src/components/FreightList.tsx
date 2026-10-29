import { FREIGHT_MODE_LABELS, type FreightLocation, type FreightSummary } from '@grain/domain';
import { ArrowRight, TrainFront, Truck } from 'lucide-react';

import { freightPayload, freightPlace, freightRate } from '../lib/freight';
import { formatUtc } from '../lib/format';
import { Link } from '../lib/router';
import { useMediaQuery } from '../lib/useMediaQuery';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from './ui/table';

const nameLink = 'rounded-xs underline-offset-4 hover:underline';

/** "Truck" or "Rail" in words with an icon. */
export function FreightModeBadge({ mode }: { mode: FreightSummary['mode'] }) {
  const Icon = mode === 'rail' ? TrainFront : Truck;
  return (
    <Badge>
      <Icon aria-hidden="true" />
      {FREIGHT_MODE_LABELS[mode]}
    </Badge>
  );
}

/** One end of a route: its counterparty, then the location. */
function End({ end }: { end: FreightLocation }) {
  return (
    <span className="block min-w-36">
      {end.counterparty.legalName}
      {end.counterparty.archived && <Badge className="ml-2">Archived</Badge>}
      <span className="block text-xs font-normal text-muted-foreground">{freightPlace(end)}</span>
    </span>
  );
}

/** From → to, linking to the rate's page. */
function Route({ freight }: { freight: FreightSummary }) {
  return (
    <Link
      href={`/freight/${freight.id}`}
      className={`${nameLink} flex flex-wrap items-start gap-x-2 gap-y-1`}
      aria-label={`${freight.origin.counterparty.legalName}, ${freightPlace(freight.origin)} to ${freight.destination.counterparty.legalName}, ${freightPlace(freight.destination)}`}
    >
      <End end={freight.origin} />
      <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <End end={freight.destination} />
    </Link>
  );
}

function Carrier({ freight }: { freight: FreightSummary }) {
  return (
    <>
      <Link href={`/counterparties/${freight.carrier.id}`} className={nameLink}>
        {freight.carrier.legalName}
      </Link>
      {freight.carrier.archived && <Badge className="ml-2">Archived</Badge>}
    </>
  );
}

function Rate({ freight }: { freight: FreightSummary }) {
  const payload = freightPayload(freight.current);
  return (
    <>
      <span className="font-price font-semibold whitespace-nowrap tabular-nums">
        {freightRate(freight.current)}
      </span>
      {payload && <span className="block text-xs text-muted-foreground">{payload}</span>}
    </>
  );
}

/**
 * Freight rates as a table, or a stacked list on narrow screens. Every rate shows its
 * currency, unit as quoted and valid-until time; nothing is converted here.
 */
export function FreightList({
  freight,
  caption,
  showCarrier = true,
}: {
  freight: FreightSummary[];
  caption: string;
  showCarrier?: boolean;
}) {
  // Tailwind's `md` breakpoint: below it the table becomes a stacked list.
  const wide = useMediaQuery('(min-width: 768px)', true);
  if (!wide) {
    return (
      <ul className="divide-y" aria-label={caption}>
        {freight.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <FreightModeBadge mode={item.mode} />
              <QuoteStatusBadge status={item.status} />
            </span>
            <span className="font-medium">
              <Route freight={item} />
            </span>
            {showCarrier && (
              <span>
                <Carrier freight={item} />
              </span>
            )}
            <span>
              <Rate freight={item} />
            </span>
            {item.current.inclusions && (
              <span className="text-xs text-muted-foreground">{item.current.inclusions}</span>
            )}
            <span className="text-xs text-muted-foreground">
              Quoted {formatUtc(item.current.quotedAt)} · valid until{' '}
              {formatUtc(item.current.validUntil)}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table className="min-w-[56rem]">
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <tr>
          <TableHead>Route</TableHead>
          {showCarrier && <TableHead>Carrier</TableHead>}
          <TableHead>Mode</TableHead>
          <TableHead>Rate</TableHead>
          <TableHead>Includes</TableHead>
          <TableHead>Quoted · valid until (UTC)</TableHead>
          <TableHead>Status</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {freight.map((item) => (
          <TableRow key={item.id}>
            <TableRowHeader>
              <Route freight={item} />
            </TableRowHeader>
            {showCarrier && (
              <TableCell>
                <Carrier freight={item} />
              </TableCell>
            )}
            <TableCell>
              <FreightModeBadge mode={item.mode} />
            </TableCell>
            <TableCell>
              <Rate freight={item} />
            </TableCell>
            <TableCell className="text-xs">{item.current.inclusions ?? '—'}</TableCell>
            <TableCell className="text-xs whitespace-nowrap">
              {formatUtc(item.current.quotedAt)}
              <span className="block text-muted-foreground">
                {formatUtc(item.current.validUntil)}
              </span>
            </TableCell>
            <TableCell>
              <QuoteStatusBadge status={item.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Wraps the list in a card that scrolls sideways when the table is wider than the page. */
export function FreightListCard(props: Parameters<typeof FreightList>[0]) {
  return (
    <Card className="overflow-hidden">
      <FreightList {...props} />
    </Card>
  );
}
