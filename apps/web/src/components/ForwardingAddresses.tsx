import { formatAlberta, type ForwardingAddressView } from '@grain/domain';
import { Forward } from 'lucide-react';
import { useId, useState, type SyntheticEvent } from 'react';

import { sendJson } from '../lib/api';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

// Forwarding addresses (F-233), on the Team page for everyone: each person adds their own
// personal addresses, confirmed by a code the platform emails to them. Mail they forward from a
// confirmed address to the business's domain is filed under the company of whoever wrote it.

interface Listing {
  addresses: ForwardingAddressView[];
  available: boolean;
  /** The shared address as an admin set it, and the person's own: where to forward (R1-01). */
  sharedAddress: string | null;
  ownAddress: string | null;
}

/** Where to forward, in words: only GSS's shared address or the person's own count. */
function forwardTo(shared: string | null, own: string | null): string {
  if (shared === null) return 'the business’s shared address';
  return own === null ? shared : `${shared} or ${own}`;
}

export function ForwardingAddresses({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const id = useId();
  const base = '/me/forwarding-addresses';
  const query = `?organization_id=${organization.id}`;
  const [listing, reload] = useApiResource<Listing>(`${base}${query}`, token);
  const [address, setAddress] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (listing.status !== 'ok') {
    return listing.status === 'error' ? (
      <p role="alert" className="text-sm text-danger">
        Could not load your forwarding addresses: {listing.error.message}
      </p>
    ) : null;
  }
  const { addresses, available, sharedAddress, ownAddress } = listing.data;

  function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    setNotice(null);
    action()
      .then(() => {
        setNotice({ ok: true, text: done });
        reload();
      })
      .catch((reason: unknown) => {
        setNotice({
          ok: false,
          text: reason instanceof Error ? reason.message : 'That did not work. Try again.',
        });
      })
      .finally(() => {
        setBusy(null);
      });
  }

  function add(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const wanted = address.trim();
    if (wanted === '') return;
    run(
      'add',
      async () => {
        await sendJson(`${base}${query}`, token, 'POST', { address: wanted });
        setAddress('');
      },
      `We emailed a code to ${wanted.toLowerCase()}. Type it below to confirm the address.`,
    );
  }

  return (
    <Card asChild>
      <section aria-labelledby={`${id}-heading`}>
        <CardHeader>
          <CardTitle id={`${id}-heading`} className="flex items-center gap-2">
            <Forward aria-hidden="true" className="size-4" />
            Your forwarding addresses
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            When a company answers you at a personal address, forward its email from that address to{' '}
            {forwardTo(sharedAddress, ownAddress)}. The platform files it under the company that
            wrote it, Claude reads it, and Reply answers the company. Add each personal address you
            forward from; we email it a code to confirm it is yours.
          </p>
          {!available && (
            <p className="text-muted-foreground">
              Email is not set up yet. An admin adds the email settings in Cloudflare.
            </p>
          )}
          {addresses.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {addresses.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.address}</span>
                    {item.confirmedAt === null ? (
                      <Badge variant="warning">Waiting for its code</Badge>
                    ) : (
                      <Badge variant="success">Confirmed</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => {
                        run(
                          `remove-${item.id}`,
                          () => sendJson(`${base}/${item.id}${query}`, token, 'DELETE'),
                          `${item.address} removed. Mail forwarded from it is no longer filed.`,
                        );
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                  {item.confirmedAt !== null ? (
                    <span className="text-xs text-muted-foreground">
                      Confirmed {formatAlberta(item.confirmedAt)}.
                    </span>
                  ) : (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        run(
                          `confirm-${item.id}`,
                          () =>
                            sendJson(`${base}/${item.id}/confirm${query}`, token, 'POST', {
                              code: codes[item.id] ?? '',
                            }),
                          `${item.address} is confirmed. Forward away.`,
                        );
                      }}
                    >
                      <label className="flex flex-col gap-1.5" htmlFor={`${id}-code-${item.id}`}>
                        <span className="font-medium">Code from the email</span>
                        <Input
                          id={`${id}-code-${item.id}`}
                          className="w-32"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={7}
                          value={codes[item.id] ?? ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCodes((current) => ({ ...current, [item.id]: value }));
                          }}
                        />
                      </label>
                      <Button type="submit" size="sm" disabled={busy !== null}>
                        Confirm
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || !available}
                        onClick={() => {
                          run(
                            `code-${item.id}`,
                            () => sendJson(`${base}/${item.id}/code${query}`, token, 'POST'),
                            `A new code is on its way to ${item.address}.`,
                          );
                        }}
                      >
                        Send a new code
                      </Button>
                      {item.codeExpiresAt !== null && (
                        <span className="text-xs text-muted-foreground">
                          The last code works until {formatAlberta(item.codeExpiresAt)}.
                        </span>
                      )}
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {available && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={add}>
              <label className="flex flex-col gap-1.5" htmlFor={`${id}-address`}>
                <span className="font-medium">Add a personal address</span>
                <Input
                  id={`${id}-address`}
                  type="email"
                  className="w-72"
                  placeholder="name@example.com"
                  value={address}
                  onChange={(event) => {
                    setAddress(event.target.value);
                  }}
                />
              </label>
              <Button type="submit" disabled={busy !== null || address.trim() === ''}>
                {busy === 'add' ? 'Sending a code…' : 'Add and send a code'}
              </Button>
            </form>
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
