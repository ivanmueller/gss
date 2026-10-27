import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { Link } from '../lib/router';

/** "← All counterparties": back to the page above this one. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 rounded-control text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {children}
    </Link>
  );
}
