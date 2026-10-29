import { Check, ChevronDown, Search } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/utils';
import { buttonVariants } from './button';
import { menuItemClass, menuPanelClass } from './dropdown-menu';

// `Select` with a search box, for long lists such as counterparties (owner's request,
// 2026-10-29). The same button and the same open panel and items as `Select`; typing
// narrows the list to the choices whose name or details contain every word typed.
// Keyboard: arrows move, Enter chooses, Escape closes; typing on the closed button starts
// a search with that letter.

export interface SearchSelectOption {
  value: string;
  label: string;
  /** A second line, e.g. the trading name or the provinces; searched too. */
  detail?: string | undefined;
  /** More words to search by, not shown. */
  keywords?: string | undefined;
}

/** At most this many choices are shown at once; typing narrows the rest. */
const SHOWN = 50;

/** Lower case without accents, so "quebec" finds "Québec". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The options containing every word of the query, in their own order. */
export function matchOptions(
  options: readonly SearchSelectOption[],
  query: string,
): SearchSelectOption[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const text = fold([option.label, option.detail ?? '', option.keywords ?? ''].join(' '));
    return words.every((word) => text.includes(word));
  });
}

export function SearchSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = 'Choose…',
  disabled,
  className,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  'aria-label': label,
}: {
  id?: string | undefined;
  /** The chosen value; '' shows the placeholder. */
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SearchSelectOption[];
  placeholder?: string;
  disabled?: boolean | undefined;
  className?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  'aria-label'?: string | undefined;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const chosen = options.find((option) => option.value === value);
  const matches = useMemo(() => matchOptions(options, query), [options, query]);
  const shown = matches.slice(0, SHOWN);
  const activeOption = shown[Math.min(active, shown.length - 1)];

  function show(startWith: string) {
    setQuery(startWith);
    const index = startWith === '' ? options.findIndex((option) => option.value === value) : 0;
    setActive(index < 0 || index >= SHOWN ? 0 : index);
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  function choose(option: SearchSelectOption) {
    onValueChange(option.value);
    close(true);
  }

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // A click anywhere outside closes the panel.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  // Keep the highlighted choice in view while moving with the arrows.
  useEffect(() => {
    if (!open || !activeOption) return;
    const element = list.current?.querySelector<HTMLElement>('[data-highlighted]');
    element?.scrollIntoView({ block: 'nearest' });
  }, [open, activeOption]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show('');
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      show(event.key);
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = shown.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, last));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(last, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) choose(activeOption);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  }

  const optionId = (index: number) => `${baseId}-option-${String(index)}`;
  let panel: ReactNode = null;
  if (open) {
    const activeIndex = activeOption ? shown.indexOf(activeOption) : -1;
    panel = (
      <div className={cn(menuPanelClass, 'absolute top-full left-0 mt-1.5 w-full min-w-64 p-0')}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Search the list"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            value={query}
            placeholder="Type to search"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label ?? 'Choices'}
          className="max-h-72 overflow-y-auto p-1"
        >
          {shown.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              data-highlighted={index === activeIndex ? '' : undefined}
              className={cn(menuItemClass, 'flex-col items-start gap-0 pl-8')}
              // Keeps the focus in the search box, so the keyboard still works.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseMove={() => {
                if (index !== activeIndex) setActive(index);
              }}
              onClick={() => {
                choose(option);
              }}
            >
              <span className="absolute top-2 left-2 flex size-4 items-center justify-center">
                {option.value === value && (
                  <Check aria-hidden="true" className="text-foreground!" />
                )}
              </span>
              <span>{option.label}</span>
              {option.detail && (
                <span aria-hidden="true" className="text-xs text-muted-foreground">
                  {option.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
        {matches.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">No match.</p>
        )}
        {matches.length > SHOWN && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {matches.length - SHOWN} more; keep typing to narrow the list.
          </p>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapper} className={cn('relative w-full', className)}>
      <button
        ref={button}
        id={id}
        type="button"
        data-slot="select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-label={label}
        data-placeholder={chosen ? undefined : ''}
        onClick={() => {
          if (open) close(false);
          else show('');
        }}
        onKeyDown={onButtonKeyDown}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          // Exactly `Select`'s button.
          'w-full justify-between gap-3 aria-invalid:border-danger data-placeholder:text-muted-foreground',
        )}
      >
        <span className="truncate">{chosen?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" className="text-muted-foreground" />
      </button>
      {panel}
    </div>
  );
}
