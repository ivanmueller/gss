import { X } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';

import type { PinDetails } from '../lib/mapbox';
import { Link } from '../lib/router';

/**
 * Where a chosen pin is in the map, in pixels, the map's height, and whether the pin is in its
 * lower half (the box then opens upward, so it stays inside the map).
 */
export interface PinAnchor {
  x: number;
  y: number;
  height: number;
  up: boolean;
}

/**
 * The box on the map for a chosen pin (F-101): the company's name (a link to its page), its
 * type and where it is. On a computer it opens beside the pin; on a phone it slides up over
 * the bottom of the map. Closed with ✕ or Escape (FacilityMap also closes it on a click on
 * the empty map).
 */
export function PinDetailsBox({
  details,
  anchor,
  onClose,
}: {
  details: PinDetails;
  anchor: PinAnchor | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const style = anchor
    ? ({
        '--pin-x': `${String(anchor.x)}px`,
        // Downward: its top a little above the pin. Upward: its bottom a little below it. Never
        // closer than 8px to the map's edge.
        '--pin-top': `${String(Math.max(8, anchor.y - 32))}px`,
        '--pin-bottom': `${String(Math.max(8, anchor.height - anchor.y - 8))}px`,
      } as CSSProperties)
    : undefined;
  return (
    <section
      aria-label="Selected location"
      style={style}
      data-up={anchor?.up ? 'true' : undefined}
      className={[
        'absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 rounded-t-card border bg-card px-4 py-3 pr-10 text-sm shadow-md',
        // On a computer: to the pin's right, kept inside the map's width, and opening downward
        // or (pin in the lower half) upward, so it is never cut off by the map's edge.
        'md:inset-x-auto md:bottom-auto md:left-[clamp(8px,calc(var(--pin-x)_+_16px),calc(100%_-_296px))] md:top-(--pin-top) md:w-72 md:rounded-card',
        'md:data-[up=true]:top-auto md:data-[up=true]:bottom-(--pin-bottom)',
        anchor ? '' : 'md:hidden',
      ].join(' ')}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-2 top-2 rounded-xs p-1 text-muted-foreground hover:text-foreground"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
      {details.href ? (
        <Link
          href={details.href}
          className="w-fit rounded-xs font-medium underline-offset-4 hover:underline"
        >
          {details.title}
        </Link>
      ) : (
        <span className="font-medium">{details.title}</span>
      )}
      {details.lines.map((line, index) => (
        <span key={line} className={index === 0 ? '' : 'text-muted-foreground'}>
          {line}
        </span>
      ))}
    </section>
  );
}
