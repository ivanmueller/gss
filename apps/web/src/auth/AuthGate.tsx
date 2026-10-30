import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { AuthClient } from '../lib/supabase';
import { AuthCard } from './AuthCard';
import { MfaChallenge } from './MfaChallenge';
import { MfaEnroll } from './MfaEnroll';
import { SignInForm } from './SignInForm';
import { clearApiCache } from '../lib/useApiResource';

export interface Account {
  email: string | null;
  /** Supabase access token at assurance level aal2, sent to the API as a bearer token. */
  accessToken: string;
  signOut: () => void;
  /** Saves the signed-in person's own first and last name; returns an error message or null. */
  saveName?: (firstName: string, lastName: string | null) => Promise<string | null>;
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'enroll' }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'ready'; email: string | null; accessToken: string };

/**
 * Shows the app only to a user who has signed in with a password AND completed
 * TOTP two-factor authentication. The API enforces the same rule on every request.
 */
export function AuthGate({
  auth,
  children,
}: {
  auth: AuthClient;
  children: (account: Account) => ReactNode;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });

  const evaluate = useCallback(async () => {
    const {
      data: { session },
    } = await auth.getSession();
    if (!session) {
      setStage({ kind: 'signed-out' });
      return;
    }
    const { data: level } = await auth.mfa.getAuthenticatorAssuranceLevel();
    if (level?.currentLevel === 'aal2') {
      setStage({
        kind: 'ready',
        email: session.user.email ?? null,
        accessToken: session.access_token,
      });
      return;
    }
    if (level?.nextLevel === 'aal2') {
      const { data: factors } = await auth.mfa.listFactors();
      const factor = factors?.totp[0];
      if (factor) {
        setStage({ kind: 'challenge', factorId: factor.id });
        return;
      }
    }
    setStage({ kind: 'enroll' });
  }, [auth]);

  useEffect(() => {
    // Supabase emits INITIAL_SESSION on subscribe, then every sign-in, MFA, refresh and
    // sign-out. It advises against calling auth methods inside this callback, so defer.
    const { data } = auth.onAuthStateChange(() => {
      setTimeout(() => void evaluate(), 0);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [auth, evaluate]);

  // A person's own names live in their Supabase user metadata, which they may change.
  const saveName = useCallback(
    async (firstName: string, lastName: string | null) => {
      const { error } = await auth.updateUser({
        data: { first_name: firstName, last_name: lastName },
      });
      return error ? 'Your name could not be saved. Try again.' : null;
    },
    [auth],
  );

  const signOut = useCallback(() => {
    // The answers kept for quick page switches belong to this person only.
    clearApiCache();
    void auth.signOut();
  }, [auth]);

  switch (stage.kind) {
    case 'loading':
      return (
        <AuthCard title="Loading…">
          <p className="text-sm text-muted-foreground">Checking your session.</p>
        </AuthCard>
      );
    case 'signed-out':
      return <SignInForm auth={auth} />;
    case 'enroll':
      return <MfaEnroll auth={auth} onSignOut={signOut} />;
    case 'challenge':
      return <MfaChallenge auth={auth} factorId={stage.factorId} onSignOut={signOut} />;
    case 'ready':
      return children({ email: stage.email, accessToken: stage.accessToken, signOut, saveName });
  }
}
