import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teaches tailwind-merge the design system's named sizes (styles/tokens/scales.css), so a
// later `rounded-full` or `w-64` replaces `rounded-card` or `w-sidebar` instead of both applying.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['base', 'control', 'inset', 'badge', 'card', 'popover', 'dialog'],
      spacing: ['sidebar', 'topbar'],
      container: ['content'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
