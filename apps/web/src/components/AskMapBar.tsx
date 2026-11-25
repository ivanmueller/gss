import {
  describeMapSettings,
  MAP_ASK_REASON_TEXT,
  readMapRequest,
  type MapAskAnswer,
  type MapAskReason,
  type MapPlace,
  type MapSettings,
} from '@grain/domain';
import { ArrowUp, LoaderCircle, Undo2, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '../lib/utils';
import { AskSparkle } from './AskSparkle';
import { SIDE_ACCENT } from './MapSide';
import { Button } from './ui/button';

/**
 * Ask the map (F-254 part 1): since F-306 a panel that slides out beside the side menu, opened
 * by the button at the menu's foot (the owner, 2026-11-24): a heading, example requests as
 * cards, the answer, and the box at the bottom. A request typed in
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
  autoFocus = false,
  onClose,
}: {
  /** Claude's reading of a request, through the Worker; it throws when Claude cannot answer. */
  askClaude: (text: string) => Promise<MapAskAnswer>;
  /** Applies the settings read and moves to the place found; the map keeps what it had for Undo. */
  onApply: (settings: MapSettings, place: MapPlace | undefined) => void;
  canUndo: boolean;
  onUndo: () => void;
  className?: string;
  /** Ready to type as soon as it shows: opened by its button in the side card (F-305). */
  autoFocus?: boolean;
  /** Closes the panel (F-306). */
  onClose?: () => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [asking, setAsking] = useState(false);
  // Only the latest request's answer is applied.
  const latest = useRef(0);

  const ask = async (request: string) => {
    const trimmed = request.trim();
    if (trimmed === '' || asking) return;
    const id = ++latest.current;
    setAsking(true);
    let reading: { settings: MapSettings; reasons: MapAskReason[]; place?: MapPlace | undefined };
    let fallback = false;
    try {
      reading = await askClaude(trimmed);
    } catch {
      reading = readMapRequest(trimmed);
      fallback = true;
    }
    if (id !== latest.current) return;
    setAsking(false);
    // The place first: where the map went, then what was set there.
    const chips = [
      ...(reading.place ? [`Moved to ${reading.place.label}`] : []),
      ...describeMapSettings(reading.settings),
    ];
    const reasons =
      chips.length === 0 && reading.reasons.length === 0
        ? (['not_understood'] as MapAskReason[])
        : reading.reasons;
    if (chips.length > 0) onApply(reading.settings, reading.place);
    setResult({ chips, reasons, fallback });
  };

  // The examples while nothing is typed or answered (F-306: always, not only on focus).
  const showExamples = text.trim() === '' && result === null && !asking;

  return (
    <section
      aria-label="Ask the map panel"
      className={cn('flex flex-col border-r bg-card/95 shadow-md', className)}
    >
      <div className="flex items-start gap-2 px-5 pt-5">
        <div className="grow">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <AskSparkle className="size-5" style={{ color: SIDE_ACCENT }} />
            Ask the map
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe the map you want: wells, land, rigs, plays or a place.
          </p>
        </div>
        {onClose && (
          <Button size="icon-sm" variant="ghost" aria-label="Close Ask the map" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 py-4">
        {showExamples && (
          <div aria-label="Examples" className="grid grid-cols-2 gap-2">
            {ASK_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setText(example);
                  void ask(example);
                }}
                className="rounded-xl bg-muted px-3 py-2.5 text-left text-[0.8125rem] leading-snug hover:bg-accent"
              >
                {example}
              </button>
            ))}
          </div>
        )}
        {asking && <p className="text-sm text-muted-foreground">Reading your request…</p>}
        {result && (
          <div role="status" className="flex flex-col gap-2 rounded-xl border px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {result.chips.map((chip) => (
                <span key={chip} className="rounded-full border bg-muted px-2 py-0.5">
                  {chip}
                </span>
              ))}
            </div>
            {result.reasons.map((reason) => (
              <p key={reason} className="text-muted-foreground">
                {MAP_ASK_REASON_TEXT[reason]}
              </p>
            ))}
            {result.fallback && (
              <p className="text-muted-foreground">
                Claude could not answer, so the bar read the request by its own word matching, which
                knows set phrasings only.
              </p>
            )}
            <div className="flex items-center gap-2">
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
              <span className="grow" />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Close"
                onClick={() => {
                  setResult(null);
                }}
              >
                <X aria-hidden="true" />
                New request
              </Button>
            </div>
          </div>
        )}
      </div>
      <form
        role="search"
        aria-label="Ask the map"
        className="m-4 mt-0 flex flex-col gap-1 rounded-2xl border bg-card p-3 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(text);
        }}
      >
        <textarea
          aria-label="Ask the map"
          // Opened on purpose by its button, so the cursor goes straight into the box (F-305).
          autoFocus={autoFocus}
          maxLength={500}
          rows={2}
          placeholder="Ask for a map, e.g. “Duvernay wells drilled since 2020”"
          className="min-h-12 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter starts a new line.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(text);
            }
          }}
        />
        <div className="flex justify-end">
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
        </div>
      </form>
    </section>
  );
}
