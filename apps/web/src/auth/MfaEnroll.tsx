import { useEffect, useRef, useState } from 'react';

import type { AuthClient } from '../lib/supabase';
import { AuthCard, FieldError } from './AuthCard';
import { CodeForm, WRONG_CODE } from './CodeForm';

interface PendingFactor {
  id: string;
  qrCode: string;
  secret: string;
}

/** Supabase returns the QR code as an SVG, sometimes already as a data URL. */
function qrSource(qrCode: string): string {
  return qrCode.startsWith('data:')
    ? qrCode
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}`;
}

export function MfaEnroll({ auth, onSignOut }: { auth: AuthClient; onSignOut: () => void }) {
  const started = useRef(false);
  const [factor, setFactor] = useState<PendingFactor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Enrol once, even under React StrictMode's double effect run.
    if (started.current) return;
    started.current = true;
    void (async () => {
      // Remove setups that were started but never confirmed, then start a fresh one.
      const { data: existing } = await auth.mfa.listFactors();
      for (const old of existing?.all ?? []) {
        if (old.factor_type === 'totp' && old.status === 'unverified') {
          await auth.mfa.unenroll({ factorId: old.id });
        }
      }
      const { data, error: enrollError } = await auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
      });
      if (enrollError) {
        setError('Could not start authenticator setup. Sign out and try again.');
        return;
      }
      setFactor({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, [auth]);

  async function verify(code: string) {
    if (!factor) return WRONG_CODE;
    const { error: verifyError } = await auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    return verifyError ? WRONG_CODE : null;
  }

  return (
    <AuthCard title="Set up your authenticator app">
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Two-factor sign-in is required. Scan this code with an authenticator app (for example
          Google Authenticator, Microsoft Authenticator or 1Password), then enter the 6-digit code
          it shows.
        </p>
        <FieldError message={error} />
        {factor && (
          <>
            <img
              src={qrSource(factor.qrCode)}
              alt="QR code for your authenticator app"
              className="mx-auto size-44 rounded-md border bg-white p-2"
            />
            <p className="text-xs text-muted-foreground">
              Can&apos;t scan? Enter this key in the app instead:{' '}
              <code data-testid="totp-secret" className="font-mono break-all text-foreground">
                {factor.secret}
              </code>
            </p>
            <CodeForm submitLabel="Confirm and continue" onSubmit={verify} />
          </>
        )}
        <button type="button" className="text-xs underline" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </AuthCard>
  );
}
