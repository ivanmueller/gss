import { formatAlberta, type CallRecordingView } from '@grain/domain';
import { Voicemail } from 'lucide-react';
import { useState } from 'react';

import { ApiError, sendJson } from '../lib/api';
import { ClaudeMark } from './ClaudeMark';
import type { CounterpartyCrmState } from './CounterpartyCrm';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

// Claude's reading of a call, under its entry in the contact history (the owner's request and
// choices of 2026-11-05, docs/DECISIONS.md): whether it reached a voicemail, and Claude's notes.
// Its drafts of bids and offers, follow-ups and contacts are shown where they belong, marked as
// Claude's, until a person verifies them (F-115, ClaudeDrafts.tsx).

/** Whether Claude (or a person's correction) says the call reached a voicemail. */
export function reachedVoicemail(recordings: readonly CallRecordingView[]): boolean {
  return recordings.some((recording) => recording.reading?.voicemail === true);
}

/**
 * Claude's reading of one recording: the voicemail mark with its correction, and Claude's notes
 * with Use as notes. `saveAsNotes` saves the notes as the entry's own (a new version), when the
 * entry has none. Its drafts are shown in their own sections (ClaudeDrafts.tsx), not here.
 */
export function CallReadingPanel({
  crm,
  recording,
  saveAsNotes,
}: {
  crm: CounterpartyCrmState;
  recording: CallRecordingView;
  saveAsNotes: ((notes: string) => Promise<void>) | null;
}) {
  const { session, writer } = crm;
  const reading = recording.reading;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reading === null) {
    return recording.readingFailed ? (
      <p className="text-xs text-muted-foreground">Claude could not read this call.</p>
    ) : recording.transcript !== null && recording.transcript.trim() !== '' ? (
      <p className="text-xs text-muted-foreground">Claude is reading this call…</p>
    ) : null;
  }

  async function act(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await run();
      crm.changed(message);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const voicemail = (value: boolean) =>
    act(
      () =>
        sendJson(`/calls/recordings/${recording.id}/voicemail`, session.token, 'POST', {
          voicemail: value,
        }),
      value ? 'Marked as a voicemail.' : 'Marked as not a voicemail.',
    );

  return (
    <section
      aria-label="Claude's reading of the call"
      className="flex flex-col gap-2 rounded-control border border-l-[3px] border-claude-border border-l-claude-mark bg-claude-subtle px-3 py-2"
    >
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <ClaudeMark className="size-3.5" />
        Claude’s notes, {formatAlberta(reading.readAt, { weekday: false })}. What it drafted from
        the call waits in Contacts, Bids and offers and Follow-ups until someone verifies it.
      </p>
      {(reading.voicemail || reading.claudeVoicemail) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {reading.voicemail ? (
            <Badge variant="caution">
              <Voicemail aria-hidden="true" />
              Voicemail
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              Not a voicemail, said {reading.voicemailCorrectedByName}
            </span>
          )}
          {writer && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => void voicemail(!reading.voicemail)}
            >
              {reading.voicemail ? 'Not a voicemail' : 'It was a voicemail'}
            </Button>
          )}
        </div>
      )}
      {reading.summary !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-sm whitespace-pre-line">{reading.summary}</p>
          {saveAsNotes !== null && writer && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-fit px-2"
              disabled={busy}
              onClick={() => void act(() => saveAsNotes(reading.summary ?? ''), 'Notes saved.')}
            >
              Use as notes
            </Button>
          )}
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
