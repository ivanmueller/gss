import { Ban, CircleCheck, CircleDashed, History, TimerOff } from 'lucide-react';

import type { RevisionStatus as QuoteStatus } from '@grain/domain';

import { Badge, type BadgeVariant } from './ui/badge';

// Only a firm quote is green; indicative is caution, and the rest are greyed out.
const STATUS: Record<
  QuoteStatus,
  { text: string; Icon: typeof Ban; variant: BadgeVariant; className?: string }
> = {
  firm: { text: 'Firm', Icon: CircleCheck, variant: 'success' },
  indicative: { text: 'Indicative', Icon: CircleDashed, variant: 'caution' },
  withdrawn: { text: 'Withdrawn', Icon: Ban, variant: 'neutral', className: 'line-through' },
  expired: { text: 'Expired', Icon: TimerOff, variant: 'neutral' },
  superseded: { text: 'Superseded', Icon: History, variant: 'neutral' },
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const { text, Icon, variant, className } = STATUS[status];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden="true" />
      {text}
    </Badge>
  );
}
