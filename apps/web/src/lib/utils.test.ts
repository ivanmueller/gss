import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('lets a later class override the design system’s named sizes', () => {
    expect(cn('rounded-card', 'rounded-full')).toBe('rounded-full');
    expect(cn('w-sidebar', 'w-64')).toBe('w-64');
    expect(cn('max-w-content', 'max-w-sm')).toBe('max-w-sm');
  });

  it('keeps text colour and font size apart', () => {
    expect(cn('text-sm text-muted-foreground', 'text-danger')).toBe('text-sm text-danger');
    expect(cn('text-xs text-foreground', 'text-lg')).toBe('text-foreground text-lg');
  });
});
