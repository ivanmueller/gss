import { formatAlberta, type CallbackSettingsView } from '@grain/domain';
import { PhoneIncoming } from 'lucide-react';
import { useId, useState } from 'react';

import { sendJson } from '../lib/api';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Select } from './ui/select';

// Callbacks to GSS's number (the owner's answers of 2026-11-06, F-132), on the Team page for
// admins: who is rung when the person who last called a number does not take its callback, and
// who gets calls from numbers nobody called. Saving turns callbacks on for the number the
// Worker is set up with; until then a call to it hears a busy signal.

const NOBODY = 'nobody';

export function CallbackSettings({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const id = useId();
  const [settings, reload] = useApiResource<{ settings: CallbackSettingsView }>(
    `/callbacks/settings?organization_id=${organization.id}`,
    token,
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (settings.status !== 'ok') {
    return settings.status === 'error' ? (
      <p role="alert" className="text-sm text-danger">
        Could not load the callbacks settings: {settings.error.message}
      </p>
    ) : null;
  }
  const view = settings.data.settings;
  const on = view.phone !== null;
  const current = view.callbacksPerson?.id ?? NOBODY;
  const value = chosen ?? current;

  function save() {
    setBusy(true);
    setNotice(null);
    sendJson(`/callbacks/settings?organization_id=${organization.id}`, token, 'PUT', {
      callbacksPerson: value === NOBODY ? null : value,
    })
      .then(() => {
        setNotice({ ok: true, text: 'Saved. Callbacks to GSS’s number now ring as set here.' });
        setChosen(null);
        reload();
      })
      .catch((reason: unknown) => {
        setNotice({
          ok: false,
          text: reason instanceof Error ? reason.message : 'The settings could not be saved.',
        });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <Card asChild>
      <section aria-labelledby={`${id}-heading`}>
        <CardHeader>
          <CardTitle id={`${id}-heading`} className="flex items-center gap-2">
            <PhoneIncoming aria-hidden="true" className="size-4" />
            Callbacks to GSS’s number
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {view.configuredPhone === null ? (
            <p className="text-muted-foreground">
              Calling is not set up yet. An admin adds the Telnyx settings in Cloudflare.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {on
                  ? `Calls to ${view.phone ?? ''} ring whoever on the team last called that number. If they do not take it, or cannot (no cell saved, suspended, on another call), the person below is rung next; if nobody takes it, the caller leaves a voicemail. Calls from numbers nobody called go to the person below too.`
                  : `Callbacks are off: a call to ${view.configuredPhone} hears a busy signal. Choose who gets callbacks and save to turn them on.`}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1.5" htmlFor={`${id}-person`}>
                  <span className="font-medium">Callbacks go to</span>
                  <Select
                    id={`${id}-person`}
                    className="w-64"
                    value={value}
                    onValueChange={setChosen}
                    options={[
                      { value: NOBODY, label: 'Nobody (straight to voicemail)' },
                      ...view.candidates.map((candidate) => ({
                        value: candidate.id,
                        label: candidate.name,
                      })),
                    ]}
                  />
                </label>
                <Button disabled={busy || (on && value === current)} onClick={save}>
                  {busy ? 'Saving…' : on ? 'Save' : 'Turn on callbacks'}
                </Button>
              </div>
              {view.updatedByName !== null && view.updatedAt !== null && (
                <p className="text-xs text-muted-foreground">
                  Last set by {view.updatedByName}, {formatAlberta(view.updatedAt)}.
                </p>
              )}
            </>
          )}
          {notice && (
            <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? '' : 'text-danger'}>
              {notice.text}
            </p>
          )}
        </CardContent>
      </section>
    </Card>
  );
}
