import { useEffect, useRef } from 'react';

import { paintPinOn, PIN_HEIGHT, PIN_WIDTH } from '../lib/mapPinImages';
import { readMapColours, type PinKind, type PinTone } from '../lib/mapbox';
import { useTheme } from '../lib/theme';

const ITEMS: readonly { label: string; kind: PinKind; tone: PinTone; hollow?: boolean }[] = [
  { label: 'Buyer', kind: 'buyer', tone: 'bid' },
  { label: 'Seller', kind: 'seller', tone: 'offer' },
  { label: 'Carrier', kind: 'carrier', tone: 'mixed' },
  { label: 'Broker', kind: 'broker', tone: 'mixed' },
  {
    label: 'Hollow: approximate location (e.g. the town)',
    kind: 'buyer',
    tone: 'bid',
    hollow: true,
  },
];

/** One pin, drawn with the same code as the map's, again when the theme changes. */
function LegendPin({ item }: { item: (typeof ITEMS)[number] }) {
  const [theme] = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (element) {
      paintPinOn(element, item.kind, item.tone, item.hollow ?? false, readMapColours());
    }
  }, [item, theme]);
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      style={{ width: PIN_WIDTH * 0.6, height: PIN_HEIGHT * 0.6 }}
    />
  );
}

/**
 * What the pins on the big maps mean (F-101): the same pictures the map draws, one for each
 * type of company, and a hollow one for an approximate location. A company that buys and
 * sells takes the buyer's symbol in the blue colour of carriers and brokers.
 */
export function MapPinLegend() {
  return (
    <ul
      aria-label="Map legend"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <LegendPin item={item} />
          {item.label}
        </li>
      ))}
      <li>Blue: buys and sells, or carrier or broker</li>
    </ul>
  );
}
