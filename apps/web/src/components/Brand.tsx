import { Wheat } from 'lucide-react';

import { useDemoData } from '../lib/demo';
import { Link } from '../lib/router';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

/** The logo's place. Until there is a logo, a neutral tile with a wheat ear stands in. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-control bg-primary text-primary-foreground',
        className,
      )}
    >
      <Wheat className="size-4.5" />
    </span>
  );
}

/** Logo and platform name, linking home, with "Demo" beside it while demo data is on. */
export function Brand() {
  const [demo] = useDemoData();
  return (
    <span className="flex items-center gap-2">
      <Link href="/" className="flex w-fit items-center gap-2.5 rounded-control">
        <BrandMark />
        <span className="text-base font-semibold tracking-tight">GSS</span>
      </Link>
      {demo && (
        <Badge
          variant="caution"
          title="Demo data is on: the workspace shows made-up sellers, buyers and prices. Turn it off in the profile menu."
          className="tracking-wider uppercase"
        >
          Demo
        </Badge>
      )}
    </span>
  );
}
