import { type SyntheticEvent, useState } from 'react';

import { buttonClass, FieldError, inputClass } from './AuthCard';

/** Six-digit authenticator code entry shared by setup and sign-in. */
export function CodeForm({
  onSubmit,
  submitLabel,
}: {
  onSubmit: (code: string) => Promise<string | null>;
  submitLabel: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const failure = await onSubmit(code.trim());
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <label className="flex flex-col gap-1 text-sm">
        6-digit code from your authenticator app
        <input
          className={inputClass}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
      </label>
      <FieldError message={error} />
      <button className={buttonClass} type="submit" disabled={busy}>
        {busy ? 'Checking…' : submitLabel}
      </button>
    </form>
  );
}

export const WRONG_CODE =
  'That code did not work. Codes change every 30 seconds; check the time on your phone and try again.';
