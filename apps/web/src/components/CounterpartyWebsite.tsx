import { websiteLabel } from '@grain/domain';
import { ExternalLink } from 'lucide-react';

// Opened from the app, a site gets no referrer and no handle on the app's window.

/** A counterparty's website: a link that opens in a new tab. */
export function CounterpartyWebsite({ website }: { website: string }) {
  // The API only stores http and https addresses; anything else is never made a link.
  if (!/^https?:\/\//i.test(website)) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-sm">
      <a
        href={website}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate underline underline-offset-4"
      >
        {websiteLabel(website)} <span className="sr-only">(opens in a new tab)</span>
      </a>
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    </span>
  );
}
