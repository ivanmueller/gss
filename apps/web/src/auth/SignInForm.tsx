import { type SyntheticEvent, useState } from 'react';

import type { AuthClient } from '../lib/supabase';
import { AuthCard, buttonClass, FieldError, inputClass } from './AuthCard';

export function SignInForm({ auth }: { auth: AuthClient }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await auth.signInWithPassword({ email, password });
    setBusy(false);
    // One message for every failure, so the form does not reveal which accounts exist.
    if (signInError) setError('Sign-in failed. Check your email and password.');
  }

  return (
    <AuthCard title="Sign in">
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            className={inputClass}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </label>
        <FieldError message={error} />
        <button className={buttonClass} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-muted-foreground">
          Accounts are created by an administrator. There is no self sign-up.
        </p>
      </form>
    </AuthCard>
  );
}
