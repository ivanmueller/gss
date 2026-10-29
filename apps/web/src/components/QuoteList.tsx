import { DELIVERY_BASIS_LABELS, formatAlberta, type QuoteSummary } from '@grain/domain';

import { quoteBasis, quoteDelivery, quotePlace, quotePrice, quoteQuantity } from '../lib/quotes';
import { Link } from '../lib/router';
import { useMediaQuery } from '../lib/useMediaQuery';
import { QuoteSideBadge } from './QuoteFields';
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

function Commodity({ quote }: { quote: QuoteSummary }) {
  return (
    <>
      <Link href={`/quotes/${quote.id}`} className={nameLink}>
        {quote.commodity.name}
      </Link>
      {quote.current.grade && (
        <span className="block text-xs font-normal text-muted-foreground">
          {quote.current.grade}
        </span>
      )}
    </>
  );
}

function Counterparty({ quote }: { quote: QuoteSummary }) {
  const place = quotePlace(quote);
  return (
    <>
      <Link href={`/counterparties/${quote.counterparty.id}`} className={nameLink}>
        {quote.counterparty.legalName}
      </Link>
      {quote.counterparty.archived && <Badge className="ml-2">Archived</Badge>}
      {place && <span className="block text-xs text-muted-foreground">{place}</span>}
    </>
  );
}

/**
 * Bids and offers as a table, or a stacked list on narrow screens. Every price shows its
 * currency, unit and valid-until time (docs/PRODUCT.md, interface conventions).
 */
export function QuoteList({
  quotes,
  caption,
  showCounterparty = true,
}: {
  quotes: QuoteSummary[];
  caption: string;
  showCounterparty?: boolean;
}) {
  // Tailwind's `md` breakpoint: below it the table becomes a stacked list.
  const wide = useMediaQuery('(min-width: 768px)', true);
  if (!wide) {
    return (
      <ul className="divide-y" aria-label={caption}>
        {quotes.map((quote) => (
          <li key={quote.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <QuoteSideBadge side={quote.side} />
              <span className="font-medium">
                <Commodity quote={quote} />
              </span>
              <QuoteStatusBadge status={quote.status} />
            </span>
            {showCounterparty && (
              <span>
                <Counterparty quote={quote} />
              </span>
            )}
            <span className="font-price font-semibold tabular-nums">
              {quotePrice(quote.current)}
            </span>
            <span className="text-xs text-muted-foreground">
              {quoteQuantity(quote.current)} · {quoteBasis(quote.current)} · Delivery{' '}
              {quoteDelivery(quote.current).toLowerCase()}
            </span>
            <span className="text-xs text-muted-foreground">
              Quoted {formatAlberta(quote.current.quotedAt)} · valid until{' '}
              {formatAlberta(quote.current.validUntil)}
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
          <TableHead>Side</TableHead>
          <TableHead>Commodity</TableHead>
          {showCounterparty && <TableHead>Counterparty</TableHead>}
          <TableHead>Price</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Basis</TableHead>
          <TableHead>Delivery</TableHead>
          <TableHead>Quoted · valid until (MT)</TableHead>
          <TableHead>Status</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {quotes.map((quote) => (
          <TableRow key={quote.id}>
            <TableCell>
              <QuoteSideBadge side={quote.side} />
            </TableCell>
            <TableRowHeader>
              <Commodity quote={quote} />
            </TableRowHeader>
            {showCounterparty && (
              <TableCell>
                <Counterparty quote={quote} />
              </TableCell>
            )}
            <TableCell className="font-price font-semibold whitespace-nowrap tabular-nums">
              {quotePrice(quote.current)}
            </TableCell>
            <TableCell className="whitespace-nowrap">{quoteQuantity(quote.current)}</TableCell>
            <TableCell>
              <span className="whitespace-nowrap">
                {DELIVERY_BASIS_LABELS[quote.current.deliveryBasis]}
              </span>
              {quote.current.basisLocation && (
                <span className="block text-xs text-muted-foreground">
                  {quote.current.basisLocation}
                </span>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap">{quoteDelivery(quote.current)}</TableCell>
            <TableCell className="text-xs whitespace-nowrap">
              {formatAlberta(quote.current.quotedAt)}
              <span className="block text-muted-foreground">
                {formatAlberta(quote.current.validUntil)}
              </span>
            </TableCell>
            <TableCell>
              <QuoteStatusBadge status={quote.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Wraps the list in a card that scrolls sideways when the table is wider than the page. */
export function QuoteListCard(props: Parameters<typeof QuoteList>[0]) {
  return (
    <Card className="overflow-hidden">
      <QuoteList {...props} />
    </Card>
  );
}
