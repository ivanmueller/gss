import { Ban, CircleCheck, CircleDashed, History, TimerOff } from 'lucide-react';

import type { QuoteStatus } from '../data/types';
import { Badge } from './ui/badge';

const STATUS = {
  firm: {
    text: 'Firm',
    Icon: CircleCheck,
    className: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  },
  indicative: {
    text: 'Indicative',
    Icon: CircleDashed,
    className: 'border-amber-300 bg-amber-50 text-amber-900',
  },
  withdrawn: {
    text: 'Withdrawn',
    Icon: Ban,
    className: 'bg-muted text-muted-foreground line-through',
  },
  expired: { text: 'Expired', Icon: TimerOff, className: 'bg-muted text-muted-foreground' },
  superseded: { text: 'Superseded', Icon: History, className: 'bg-muted text-muted-foreground' },
} as const;

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const { text, Icon, className } = STATUS[status];
  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden="true" />
      {text}
    </Badge>
  );
}
