import { Copy, KeyRound, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../components/ui/button';
import { detectPlatform, type Platform } from '../lib/device';
import type { AuthClient } from '../lib/supabase';
import { AuthCard, FieldError } from './AuthCard';
import { CodeForm, WRONG_CODE } from './CodeForm';

interface PendingFactor {
  id: string;
  qrCode: string;
  secret: string;
  /** The otpauth:// setup link, which authenticator apps open directly; null if unusable. */
  uri: string | null;
}

/** Only an authenticator setup link is used as a link, never anything else Supabase sends. */
export function setupLink(uri: string | undefined): string | null {
  return uri !== undefined && /^otpauth:\/\/totp\/[^\s]+$/i.test(uri) ? uri : null;
}

/** Supabase returns the QR code as an SVG, sometimes already as a data URL. */
function qrSource(qrCode: string): string {
  return qrCode.startsWith('data:')
    ? qrCode
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}`;
}

/** The setup key, which the person can copy into their authenticator app or type by hand. */
function SetupKey({ secret }: { secret: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Key:{' '}
      <code data-testid="totp-secret" className="font-mono break-all text-foreground">
        {secret}
      </code>
    </p>
  );
}

/** Copies the setup key and says what to do with it in the authenticator app. */
function CopyKey({ secret, primary }: { secret: string; primary: boolean }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  return (
    <>
      <Button
        type="button"
        variant={primary ? 'primary' : 'outline'}
        className="w-full"
        onClick={() => {
          navigator.clipboard.writeText(secret).then(
            () => {
              setCopied('yes');
            },
            () => {
              setCopied('failed');
            },
          );
        }}
      >
        <Copy aria-hidden="true" />
        Copy setup key
      </Button>
      {copied && (
        <p role="status" className="text-xs text-muted-foreground">
          {copied === 'yes'
            ? 'Copied. In your authenticator app, add a code with “Enter a setup key”, name it GSS and paste.'
            : 'Could not copy. Type the key below into your authenticator app.'}
        </p>
      )}
    </>
  );
}

/**
 * First sign-in: adds GSS to the person's authenticator app. A computer shows the QR code to
 * scan with a phone. A phone cannot scan its own screen: an iPhone copies the key for Google
 * or Microsoft Authenticator, or saves it in Apple Passwords (where iOS sends every setup
 * link, whatever app is installed); Android opens the authenticator app with the link.
 */
export function MfaEnroll({
  auth,
  onSignOut,
  platform = detectPlatform(),
}: {
  auth: AuthClient;
  onSignOut: () => void;
  platform?: Platform;
}) {
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
      setFactor({
        id: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: setupLink(data.totp.uri),
      });
    })();
  }, [auth]);

  async function verify(code: string) {
    if (!factor) return WRONG_CODE;
    const { error: verifyError } = await auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    return verifyError ? WRONG_CODE : null;
  }

  const phone = platform !== 'computer';
  return (
    <AuthCard title="Set up your authenticator app">
      <div className="flex flex-col gap-4 text-sm">
        <p>
          {phone
            ? 'Add GSS to your authenticator app, then enter the 6-digit code it shows.'
            : 'Scan this code with the authenticator app on your phone, then enter the 6-digit code it shows.'}
        </p>
        <FieldError message={error} />
        {factor && (
          <>
            {platform === 'computer' && (
              <>
                <img
                  src={qrSource(factor.qrCode)}
                  alt="QR code for your authenticator app"
                  className="mx-auto size-44 rounded-control border bg-white p-2"
                />
                <SetupKey secret={factor.secret} />
              </>
            )}
            {platform === 'ios' && (
              <div className="flex flex-col gap-2">
                <CopyKey secret={factor.secret} primary />
                {factor.uri && (
                  <Button asChild variant="outline" className="w-full">
                    <a href={factor.uri}>
                      <KeyRound aria-hidden="true" />
                      Save in Apple Passwords
                    </a>
                  </Button>
                )}
                <SetupKey secret={factor.secret} />
              </div>
            )}
            {platform === 'android' && (
              <div className="flex flex-col gap-2">
                {factor.uri && (
                  <Button asChild className="w-full">
                    <a href={factor.uri}>
                      <Smartphone aria-hidden="true" />
                      Open in authenticator app
                    </a>
                  </Button>
                )}
                <CopyKey secret={factor.secret} primary={!factor.uri} />
                <SetupKey secret={factor.secret} />
              </div>
            )}
            <CodeForm submitLabel="Confirm and continue" onSubmit={verify} />
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="self-center text-muted-foreground"
          onClick={onSignOut}
        >
          Sign out
        </Button>
      </div>
    </AuthCard>
  );
}
