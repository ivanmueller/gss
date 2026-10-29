import { websiteLabel } from '@grain/domain';
import { ExternalLink, Eye } from 'lucide-react';
import type { ComponentProps } from 'react';

import type { WebsitePreview } from '../lib/api';
import { useApiResource } from '../lib/useApiResource';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';

// Opened from the app, a site gets no referrer and no handle on the app's window, and its
// preview runs sandboxed: it cannot navigate the app away. Without allow-same-origin the
// frame always has an origin of its own, so even a page of the app itself (saved as the
// website, or reached from the site's links) cannot read the app's storage or its page.
// The browser cannot tell whether a site allows being shown in a frame, so the API asks the
// site (apps/api/src/website.ts) and Preview appears only when it allows it.
const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';

/** A link to the website in a new tab; other props (a button's class, from Button asChild) pass through. */
function NewTabLink({
  website,
  children,
  ...props
}: Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'> & { website: string }) {
  return (
    <a {...props} href={website} target="_blank" rel="noopener noreferrer">
      {children} <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A counterparty's website: a link that opens in a new tab, and a preview if the site allows one. */
export function CounterpartyWebsite({
  counterpartyId,
  website,
  token,
}: {
  counterpartyId: string;
  website: string;
  token: string;
}) {
  const [check] = useApiResource<WebsitePreview>(
    `/counterparties/${counterpartyId}/website-preview`,
    token,
  );
  // The API only stores http and https addresses; anything else is never made a link.
  if (!/^https?:\/\//i.test(website)) return null;
  const label = websiteLabel(website);
  const previewable =
    check.status === 'ok' && check.data.preview === 'allowed' && check.data.website === website;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="inline-flex min-w-0 items-center gap-1 [&_a]:truncate [&_a]:underline [&_a]:underline-offset-4">
        <NewTabLink website={website}>{label}</NewTabLink>
        <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </span>
      {previewable && (
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 px-2">
              <Eye aria-hidden="true" />
              Preview
            </Button>
          </DialogTrigger>
          <DialogContent
            title={label}
            actions={
              <Button asChild size="sm" variant="outline">
                <NewTabLink website={website}>
                  <ExternalLink aria-hidden="true" />
                  Open in new tab
                </NewTabLink>
              </Button>
            }
          >
            <iframe
              src={website}
              title={`Preview of ${label}`}
              sandbox={SANDBOX}
              referrerPolicy="no-referrer"
              className="h-[75dvh] w-full bg-white"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
