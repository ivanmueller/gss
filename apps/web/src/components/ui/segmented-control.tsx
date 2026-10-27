import { cn } from '../../lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A row of mutually exclusive toggle buttons (aria-pressed), styled like the tab bar. Use it
 * for filters and view options that change the page in place; use Tabs to switch panels.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Names the group for screen readers, e.g. "Show facilities". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex w-fit items-center gap-0.5 rounded-control bg-muted p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className="inline-flex h-7 items-center rounded-inset px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
