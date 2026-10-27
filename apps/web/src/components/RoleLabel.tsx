import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

import type { FacilityRole } from '../data/types';
import { cn } from '../lib/utils';

// Buyer and seller are always shown with a word and an icon, never by colour alone.
const ROLE = {
  seller: { text: 'Seller', Icon: ArrowUpFromLine, className: 'text-offer' },
  buyer: { text: 'Buyer', Icon: ArrowDownToLine, className: 'text-bid' },
} as const;

export function RoleLabel({ role, suffix }: { role: FacilityRole; suffix?: string }) {
  const { text, Icon, className } = ROLE[role];
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {suffix ? `${text} ${suffix}` : text}
    </span>
  );
}
