import type { FxRate, Quote } from '../data/types';
import { formatPrice } from '../lib/format';
import { cadPrice } from '../lib/orderBook';
import { cn } from '../lib/utils';

/** "USD 725.00/MT at 1.360000 CAD per USD, synthetic rate (golden fixture)". */
export function conversionText(quote: Quote, fx: FxRate): string {
  return `${formatPrice(quote.price)} at ${fx.cadPerUsd} CAD per USD, ${fx.source}`;
}

/**
 * A quote's price in CAD. A converted USD price carries an "FX" mark whose tooltip gives the
 * original price and the rate; without a rate the original price shows, marked as not
 * converted, rather than a made-up CAD amount.
 */
export function CadPrice({
  quote,
  fx,
  className,
}: {
  quote: Quote;
  fx: FxRate | null;
  className?: string;
}) {
  const price = cadPrice(quote, fx);
  if (!price) {
    return (
      <span className={cn('inline-flex flex-wrap items-center gap-x-1.5', className)}>
        <span className="font-price tabular-nums">{formatPrice(quote.price)}</span>
        <span className="font-sans text-xs font-normal text-caution">no CAD/USD rate</span>
      </span>
    );
  }
  const text = formatPrice({ amount: price.cadDisplay, currency: 'CAD', unit: quote.price.unit });
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="font-price tabular-nums">{text}</span>
      {price.fx && (
        <span
          title={`Converted from ${conversionText(quote, price.fx)}`}
          className="rounded-xs border px-1 font-mono text-2xs font-medium text-muted-foreground"
        >
          FX
          <span className="sr-only">: converted from {conversionText(quote, price.fx)}</span>
        </span>
      )}
    </span>
  );
}
