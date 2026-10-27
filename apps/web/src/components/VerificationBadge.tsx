import { BadgeCheck, CircleDashed, Clock } from 'lucide-react';

import { Badge } from './ui/badge';

const STATUS = {
  verified: {
    label: 'Verified',
    Icon: BadgeCheck,
    className: 'border-emerald-300 text-emerald-900',
  },
  pending: {
    label: 'Verification pending',
    Icon: Clock,
    className: 'border-amber-300 text-amber-900',
  },
  unverified: { label: 'Unverified', Icon: CircleDashed, className: 'text-muted-foreground' },
} as const;

/** Verification status as a word and an icon, never colour alone. */
export function VerificationBadge({ status }: { status: string }) {
  const known: Partial<Record<string, (typeof STATUS)[keyof typeof STATUS]>> = STATUS;
  const { label, Icon, className } = known[status] ?? STATUS.unverified;
  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
