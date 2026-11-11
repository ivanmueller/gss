import {
  EMAIL_SIGNATURE_MAX,
  fillSignature,
  formatAlberta,
  type EmailSettingsView,
  type MemberEmailView,
} from '@grain/domain';
import { Mail } from 'lucide-react';
import { useId, useState } from 'react';

import { sendJson } from '../lib/api';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input, Textarea } from './ui/input';

// Email through the platform (F-114 step 3), on the Team page for admins: the shared address
// (info@), the one team signature, and each person's own address, title and phone for the
// signature (the owner's answers of 2026-11-10). The domain comes from the Worker's settings.

type Notice = { ok: boolean; text: string } | null;

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function EmailSettings({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const id = useId();
  const [resource, reload] = useApiResource<{ settings: EmailSettingsView }>(
    `/emails/settings?organization_id=${organization.id}`,
    token,
  );
  const [shared, setShared] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (resource.status !== 'ok') {
    return resource.status === 'error' ? (
      <p role="alert" className="text-sm text-danger">
        Could not load the email settings: {resource.error.message}
      </p>
    ) : null;
  }
  const view = resource.data.settings;
  const sharedValue = shared ?? view.sharedLocalPart ?? 'info';
  const signatureValue = signature ?? view.signature ?? '';
  const domain = view.domain ?? 'the domain';
  const first = view.members[0];
  const preview =
    first === undefined
      ? null
      : fillSignature(signatureValue, {
          name: first.name,
          title: first.title,
          phone: first.phone,
          email: `${first.localPart ?? sharedValue}@${domain}`,
        });

  function save() {
    setBusy(true);
    setNotice(null);
    sendJson(`/emails/settings?organization_id=${organization.id}`, token, 'PUT', {
      sharedLocalPart: sharedValue,
      signature: signatureValue.trim() === '' ? null : signatureValue,
    })
      .then(() => {
        setNotice({ ok: true, text: 'Saved.' });
        setShared(null);
        setSignature(null);
        reload();
      })
      .catch((reason: unknown) => {
        setNotice({ ok: false, text: message(reason, 'The settings could not be saved.') });
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
            <Mail aria-hidden="true" className="size-4" />
            Email
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {!view.configured ? (
            <p className="text-muted-foreground">
              Email is not set up yet. An admin adds the email settings in Cloudflare.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5" htmlFor={`${id}-shared`}>
                  <span className="font-medium">Shared address</span>
                  <span className="flex items-center gap-1">
                    <Input
                      id={`${id}-shared`}
                      className="w-40"
                      value={sharedValue}
                      maxLength={64}
                      onChange={(event) => {
                        setShared(event.target.value);
                      }}
                    />
                    <span className="text-muted-foreground">@{domain}</span>
                  </span>
                </label>
                <label className="flex flex-col gap-1.5" htmlFor={`${id}-signature`}>
                  <span className="font-medium">Team signature</span>
                  <span className="text-xs text-muted-foreground">
                    Added under every email. {'{name}'}, {'{title}'}, {'{phone}'} and {'{email}'}{' '}
                    are filled in for the person sending; a line whose details are all empty is left
                    out.
                  </span>
                  <Textarea
                    id={`${id}-signature`}
                    rows={5}
                    maxLength={EMAIL_SIGNATURE_MAX}
                    value={signatureValue}
                    placeholder={'{name}\n{title}\nPhone: {phone}\n{email}'}
                    onChange={(event) => {
                      setSignature(event.target.value);
                    }}
                  />
                </label>
                {preview !== null && first !== undefined && (
                  <div>
                    <p className="text-xs text-muted-foreground">As {first.name}’s emails end:</p>
                    <pre className="mt-1 whitespace-pre-wrap rounded-control border border-border bg-muted p-2 font-sans">
                      {preview}
                    </pre>
                  </div>
                )}
                <div>
                  <Button disabled={busy} onClick={save}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                </div>
                {view.updatedByName !== null && view.updatedAt !== null && (
                  <p className="text-xs text-muted-foreground">
                    Last set by {view.updatedByName}, {formatAlberta(view.updatedAt)}.
                  </p>
                )}
                {notice && (
                  <p
                    role={notice.ok ? 'status' : 'alert'}
                    className={notice.ok ? '' : 'text-danger'}
                  >
                    {notice.text}
                  </p>
                )}
              </div>
              {view.sharedLocalPart === null ? (
                <p className="text-muted-foreground">
                  Save the shared address first, then each person’s.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <h3 className="font-medium">Each person</h3>
                  <ul className="flex flex-col gap-3">
                    {view.members.map((member) => (
                      <MemberRow
                        key={member.userId}
                        member={member}
                        domain={domain}
                        session={session}
                        onSaved={reload}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

function MemberRow({
  member,
  domain,
  session,
  onSaved,
}: {
  member: MemberEmailView;
  domain: string;
  session: DirectorySession;
  onSaved: () => void;
}) {
  const id = useId();
  const [localPart, setLocalPart] = useState(member.localPart ?? '');
  const [title, setTitle] = useState(member.title ?? '');
  const [phone, setPhone] = useState(member.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const changed =
    localPart !== (member.localPart ?? '') ||
    title !== (member.title ?? '') ||
    phone !== (member.phone ?? '');

  function save() {
    setBusy(true);
    setNotice(null);
    sendJson(
      `/emails/members/${member.userId}?organization_id=${session.organization.id}`,
      session.token,
      'PUT',
      { localPart, title, phone },
    )
      .then(() => {
        // As the server keeps them, so the row no longer reads as changed.
        setLocalPart(localPart.trim().toLowerCase());
        setTitle(title.trim());
        setPhone(phone.trim());
        setNotice({ ok: true, text: 'Saved.' });
        onSaved();
      })
      .catch((reason: unknown) => {
        setNotice({ ok: false, text: message(reason, 'Could not be saved.') });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0">
      <span className="font-medium">{member.name}</span>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1" htmlFor={`${id}-address`}>
          <span className="text-xs text-muted-foreground">Address</span>
          <span className="flex items-center gap-1">
            <Input
              id={`${id}-address`}
              className="w-32"
              value={localPart}
              maxLength={64}
              placeholder="none"
              onChange={(event) => {
                setLocalPart(event.target.value);
              }}
            />
            <span className="text-muted-foreground">@{domain}</span>
          </span>
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${id}-title`}>
          <span className="text-xs text-muted-foreground">Title</span>
          <Input
            id={`${id}-title`}
            className="w-40"
            value={title}
            maxLength={100}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${id}-phone`}>
          <span className="text-xs text-muted-foreground">Phone in signature</span>
          <Input
            id={`${id}-phone`}
            className="w-40"
            type="tel"
            value={phone}
            maxLength={40}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </label>
        <Button variant="outline" disabled={busy || !changed} onClick={save}>
          {busy ? 'Saving…' : `Save ${member.name}`}
        </Button>
      </div>
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={notice.ok ? 'text-xs' : 'text-xs text-danger'}
        >
          {notice.text}
        </p>
      )}
    </li>
  );
}
