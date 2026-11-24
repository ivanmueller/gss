import {
  describeMapSettings,
  MAP_ASK_REASON_TEXT,
  readMapRequest,
  type MapAskReason,
  type MapSettings,
} from '@grain/domain';
import { ArrowUp, Sparkles, Undo2, X } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../lib/utils';
import { Button } from './ui/button';

/**
 * Ask the map (F-254 part 1): a bar at the bottom of the oil and gas map. A request typed in
 * plain words is read into the map's settings (MapSettings, packages/domain), which the page
 * applies as if clicked; the bar then names what it set, what it could not do, and offers Undo.
 * For now the reading is the domain's word matching, in the browser; Claude reads requests in
 * part 2 and the word matching stays as its fallback. Nothing is kept once the page is closed.
 */

/** Requests the map can answer today, offered while the box is empty. */
export const ASK_EXAMPLES = [
  'Duvernay wells drilled since 2020',
  'Producing wells operated by Chevron',
  'Rigs now',
  'Gas plants and compressors',
  'Duvernay land sales of the past year',
  'Duvernay maturity',
] as const;

interface Result {
  chips: string[];
  reasons: MapAskReason[];
}

export function AskMapBar({
  onApply,
  canUndo,
  onUndo,
  className,
}: {
  /** Applies the settings read; the map keeps what it had before for Undo. */
  onApply: (settings: MapSettings) => void;
  canUndo: boolean;
  onUndo: () => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [focused, setFocused] = useState(false);

  const ask = (request: string) => {
    const trimmed = request.trim();
    if (trimmed === '') return;
    const reading = readMapRequest(trimmed);
    const chips = describeMapSettings(reading.settings);
    if (chips.length > 0) onApply(reading.settings);
    setResult({ chips, reasons: reading.reasons });
  };

  const showExamples = focused && text.trim() === '' && result === null;

  return (
    <div className={cn('pointer-events-none flex flex-col items-stretch gap-2', className)}>
      {result && (
        <div
          role="status"
          className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-card border bg-card/95 px-3 py-2 text-xs shadow-xs"
        >
          {result.chips.map((chip) => (
            <span key={chip} className="rounded-full border bg-muted px-2 py-0.5">
              {chip}
            </span>
          ))}
          {result.reasons.map((reason) => (
            <span key={reason} className="text-muted-foreground">
              {MAP_ASK_REASON_TEXT[reason]}
            </span>
          ))}
          {result.reasons.includes('not_understood') && (
            <span className="text-muted-foreground">
              The bar reads set phrasings for now: try one of the examples.
            </span>
          )}
          <span className="grow" />
          {canUndo && result.chips.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onUndo();
                setResult(null);
              }}
            >
              <Undo2 aria-hidden="true" />
              Undo
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close"
            onClick={() => {
              setResult(null);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
      {showExamples && (
        <div
          aria-label="Examples"
          className="pointer-events-auto flex flex-wrap gap-1.5 rounded-card border bg-card/95 px-3 py-2 text-xs shadow-xs"
        >
          {ASK_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              // Before the box loses focus, so the list is still there to be clicked.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                setText(example);
                ask(example);
              }}
              className="rounded-full border bg-card px-2 py-0.5 hover:bg-muted"
            >
              {example}
            </button>
          ))}
        </div>
      )}
      <form
        role="search"
        aria-label="Ask the map"
        className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 py-1 pr-1 pl-3.5 shadow-md"
        onSubmit={(event) => {
          event.preventDefault();
          ask(text);
        }}
      >
        <Sparkles aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          aria-label="Ask the map"
          maxLength={500}
          placeholder="Ask the map, e.g. “Duvernay wells drilled since 2020”"
          className="h-8 min-w-0 grow bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
        />
        <Button
          type="submit"
          size="icon-sm"
          className="rounded-full"
          aria-label="Ask"
          disabled={text.trim() === ''}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
