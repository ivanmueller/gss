import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

// A menu that opens from a button (Radix: keyboard, focus and screen-reader behaviour built in).

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-(--z-popover) max-h-(--radix-dropdown-menu-content-available-height) min-w-56 overflow-y-auto rounded-popover border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

const itemClass =
  'relative flex cursor-default items-center gap-2 rounded-inset px-2 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(itemClass, className)}
      {...props}
    />
  );
}

/**
 * An on/off setting inside a menu, drawn as a switch. It stays open when toggled, so the
 * change is visible; screen readers hear a checkable menu item.
 */
export function DropdownMenuSwitchItem({
  className,
  children,
  checked,
  onSelect,
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.CheckboxItem>, 'checked'> & { checked: boolean }) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-switch-item"
      checked={checked}
      onSelect={(event) => {
        event.preventDefault();
        onSelect?.(event);
      }}
      className={cn(itemClass, className)}
      {...props}
    >
      {children}
      <span
        aria-hidden="true"
        data-checked={checked || undefined}
        className="ml-auto flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input p-0.5 transition-colors data-checked:bg-primary"
      >
        <span
          data-checked={checked || undefined}
          className="size-4 rounded-full bg-background shadow-xs transition-transform data-checked:translate-x-4 motion-reduce:transition-none"
        />
      </span>
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}
