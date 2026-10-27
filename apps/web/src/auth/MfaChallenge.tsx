import { Button } from '../components/ui/button';
import type { AuthClient } from '../lib/supabase';
import { AuthCard } from './AuthCard';
import { CodeForm, WRONG_CODE } from './CodeForm';

export function MfaChallenge({
  auth,
  factorId,
  onSignOut,
}: {
  auth: AuthClient;
  factorId: string;
  onSignOut: () => void;
}) {
  async function verify(code: string) {
    const { error } = await auth.mfa.challengeAndVerify({ factorId, code });
    return error ? WRONG_CODE : null;
  }

  return (
    <AuthCard title="Enter your authenticator code">
      <div className="flex flex-col gap-4 text-sm">
        <CodeForm submitLabel="Verify" onSubmit={verify} />
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
