import { MIN_PASSWORD_LENGTH } from '@grain/domain';
import { useId, useState, type SyntheticEvent } from 'react';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ApiError, sendJson } from '../lib/api';
import { AuthCard, FieldError } from './AuthCard';

// Steps after a first sign-in, before the app: choosing one's own password (a login made
// on the Team page starts with a temporary one) and giving one's name when it is missing.

function SignOutLink({ onSignOut }: { onSignOut: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="mt-2 w-fit" onClick={onSignOut}>
      Sign out
    </Button>
  );
}

/** The person's own password, replacing the temporary one an admin gave them. */
export function ChoosePassword({
  token,
  onDone,
  onSignOut,
}: {
  token: string;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    if (password !== again) {
      setError('The two passwords are not the same.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendJson('/me/password', token, 'POST', { password });
      onDone();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Choose your password">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-muted-foreground">
          You signed in with a temporary password. Choose your own; only you will know it.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-new`} className="text-sm font-medium">
            New password
          </label>
          <Input
            id={`${id}-new`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters. A few words make a good one.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-again`} className="text-sm font-medium">
            The same again
          </label>
          <Input
            id={`${id}-again`}
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(event) => {
              setAgain(event.target.value);
            }}
          />
        </div>
        <FieldError message={error} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>
      </form>
      <SignOutLink onSignOut={onSignOut} />
    </AuthCard>
  );
}

/** The name the app shows, for someone who has none yet. */
export function YourName({
  saveName,
  onDone,
  onSignOut,
}: {
  saveName: (firstName: string, lastName: string | null) => Promise<string | null>;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const id = useId();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const first = firstName.replace(/\s+/g, ' ').trim();
    const last = lastName.replace(/\s+/g, ' ').trim();
    if (first === '') {
      setError('Enter your first name.');
      return;
    }
    if (first.length > 100 || last.length > 100) {
      setError('Use at most 100 characters for each name.');
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await saveName(first, last === '' ? null : last);
    if (failure) {
      setError(failure);
      setBusy(false);
    } else {
      onDone();
    }
  }

  return (
    <AuthCard title="Your name">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-muted-foreground">
          How should GSS show you to the team? You can ask an admin to change it later.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-first`} className="text-sm font-medium">
            First name
          </label>
          <Input
            id={`${id}-first`}
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-last`} className="text-sm font-medium">
            Last name
          </label>
          <Input
            id={`${id}-last`}
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
            }}
          />
        </div>
        <FieldError message={error} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </Button>
      </form>
      <SignOutLink onSignOut={onSignOut} />
    </AuthCard>
  );
}
