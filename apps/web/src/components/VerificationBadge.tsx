import { BadgeCheck, CircleDashed, Clock } from 'lucide-react';

import { Badge } from './ui/badge';

const STATUS = {
  verified: { label: 'Verified', Icon: BadgeCheck, variant: 'success' },
  pending: { label: 'Verification pending', Icon: Clock, variant: 'caution' },
  unverified: { label: 'Unverified', Icon: CircleDashed, variant: 'neutral' },
} as const;

/** Verification status as a word and an icon, never colour alone. */
export function VerificationBadge({ status }: { status: string }) {
  const known: Partial<Record<string, (typeof STATUS)[keyof typeof STATUS]>> = STATUS;
  const { label, Icon, variant } = known[status] ?? STATUS.unverified;
  return (
    <Badge variant={variant}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
