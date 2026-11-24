import {
  describeMapSettings,
  MAP_ASK_REASON_TEXT,
  readMapRequest,
  type MapAskAnswer,
  type MapAskReason,
  type MapSettings,
} from '@grain/domain';
import { ArrowUp, LoaderCircle, Sparkles, Undo2, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '../lib/utils';
import { Button } from './ui/button';

/**
 * Ask the map (F-254 part 1): a bar at the top of the oil and gas map. A request typed in
 * plain words is read into the map's settings (MapSettings, packages/domain), which the page
 * applies as if clicked; the bar then names what it set, what it could not do, and offers Undo.
 * Claude reads each request through the Worker (part 2, POST /petroleum/ask); when Claude cannot
 * answer (not set up, too many requests, an error, too slow), the domain's word matching reads it
 * in the browser instead and the bar says so. Nothing is kept once the page is closed.
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
  /** Read by the word matching because Claude could not answer. */
  fallback: boolean;
}

export function AskMapBar({
  askClaude,
  onApply,
  canUndo,
  onUndo,
  className,
}: {
  /** Claude's reading of a request, through the Worker; it throws when Claude cannot answer. */
  askClaude: (text: string) => Promise<MapAskAnswer>;
  /** Applies the settings read; the map keeps what it had before for Undo. */
  onApply: (settings: MapSettings) => void;
  canUndo: boolean;
  onUndo: () => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [focused, setFocused] = useState(false);
  const [asking, setAsking] = useState(false);
  // Only the latest request's answer is applied.
  const latest = useRef(0);

  const ask = async (request: string) => {
    const trimmed = request.trim();
    if (trimmed === '' || asking) return;
    const id = ++latest.current;
    setAsking(true);
    let reading: { settings: MapSettings; reasons: MapAskReason[] };
    let fallback = false;
    try {
      reading = await askClaude(trimmed);
    } catch {
      reading = readMapRequest(trimmed);
      fallback = true;
    }
    if (id !== latest.current) return;
    setAsking(false);
    const chips = describeMapSettings(reading.settings);
    const reasons =
      chips.length === 0 && reading.reasons.length === 0
        ? (['not_understood'] as MapAskReason[])
        : reading.reasons;
    if (chips.length > 0) onApply(reading.settings);
    setResult({ chips, reasons, fallback });
  };

  const showExamples = focused && text.trim() === '' && result === null;

  return (
    // At the top of the map: the box first, then the examples or the answer below it.
    <div className={cn('pointer-events-none flex flex-col items-stretch gap-2', className)}>
      <form
        role="search"
        aria-label="Ask the map"
        className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 py-1 pr-1 pl-3.5 shadow-md"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(text);
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
          aria-label={asking ? 'Asking Claude' : 'Ask'}
          disabled={text.trim() === '' || asking}
        >
          {asking ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <ArrowUp aria-hidden="true" />
          )}
        </Button>
      </form>
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
          {result.fallback && (
            <span className="text-muted-foreground">
              Claude could not answer, so the bar read the request by its own word matching, which
              knows set phrasings only.
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
                void ask(example);
              }}
              className="rounded-full border bg-card px-2 py-0.5 hover:bg-muted"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
