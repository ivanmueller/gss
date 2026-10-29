import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { buttonVariants } from './button';
import { menuItemClass, menuPanelClass } from './dropdown-menu';

// The one dropdown for choosing a single value, everywhere in the app: a button like the
// workspace's commodity picker, opening the same panel as its menu. It replaces the browser's
// own <select>, whose open list the operating system draws and no style can change.
// Radix Select: keyboard, type-to-find and screen-reader behaviour built in.

export interface SelectOption {
  value: string;
  label: string;
}

// Radix reserves the empty string for "nothing chosen"; an option meaning "none" or "all"
// (value '') is carried under this stand-in instead.
const EMPTY = '\u0000empty';
const toRadix = (value: string) => (value === '' ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? '' : value);

export function Select({
  id,
  value,
  onValueChange,
  options,
  placeholder = 'Choose…',
  disabled,
  icon,
  className,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  'aria-label': label,
}: {
  id?: string | undefined;
  /** The chosen value; '' is nothing chosen (shows the placeholder) unless an option has ''. */
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean | undefined;
  /** An icon before the value, as the commodity picker has. */
  icon?: ReactNode;
  /** Width and spacing; forms make it full width, toolbars give it a width. */
  className?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  /** For a dropdown without a visible label. */
  'aria-label'?: string | undefined;
}) {
  const hasEmpty = options.some((option) => option.value === '');
  return (
    <SelectPrimitive.Root
      value={value === '' && !hasEmpty ? '' : toRadix(value)}
      onValueChange={(next) => {
        onValueChange(fromRadix(next));
      }}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        data-slot="select"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-label={label}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          // Exactly the commodity picker's button (CommodityPicker), full width in forms.
          'w-full justify-between gap-3 aria-invalid:border-danger data-placeholder:text-muted-foreground',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          align="start"
          className={cn(
            menuPanelClass,
            'max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width)',
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toRadix(option.value)}
                className={cn(menuItemClass, 'pl-8')}
              >
                <span className="absolute left-2 flex size-4 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check aria-hidden="true" className="text-foreground!" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
