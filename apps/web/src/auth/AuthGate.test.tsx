import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AuthClient } from '../lib/supabase';
import { notePasswordChanged } from './passwordNotice';
import { AuthGate } from './AuthGate';
import { WRONG_CODE } from './CodeForm';

interface Factor {
  id: string;
  factor_type: 'totp';
  status: 'verified' | 'unverified';
}

interface FakeState {
  session: { access_token: string; user: { email: string } } | null;
  currentLevel: 'aal1' | 'aal2';
  nextLevel: 'aal1' | 'aal2';
  factors: Factor[];
}

/** Stand-in for the parts of supabase.auth that AuthGate uses. */
function fakeAuth(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    session: null,
    currentLevel: 'aal1',
    nextLevel: 'aal1',
    factors: [],
    ...initial,
  };
  let listener: (() => void) | undefined;
  const ok = <T,>(data: T) => Promise.resolve({ data, error: null });
  const mock = {
    getSession: vi.fn(() => ok({ session: state.session })),
    onAuthStateChange: vi.fn((callback: () => void) => {
      listener = callback;
      callback(); // INITIAL_SESSION
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithPassword: vi.fn(() => ok({})),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(() =>
        ok({ currentLevel: state.currentLevel, nextLevel: state.nextLevel }),
      ),
      listFactors: vi.fn(() =>
        ok({ all: state.factors, totp: state.factors.filter((f) => f.status === 'verified') }),
      ),
      enroll: vi.fn(() =>
        ok({
          id: 'factor-new',
          totp: {
            qr_code: 'data:image/svg+xml;utf-8,<svg/>',
            secret: 'SYNTHETICSECRET',
            uri: 'otpauth://totp/GSS:alice@example.test?secret=SYNTHETICSECRET&issuer=GSS',
          },
        }),
      ),
      unenroll: vi.fn(() => ok({})),
      challengeAndVerify: vi.fn(() => ok({})),
    },
  };
  return {
    auth: mock as unknown as AuthClient,
    mock,
    state,
    emit: () => listener?.(),
  };
}

const SESSION = { access_token: 'token-aal', user: { email: 'alice@example.test' } };

function renderGate(auth: AuthClient) {
  return render(
    <StrictMode>
      <AuthGate auth={auth}>
        {(account) => (
          <p>
            app for {account.email} with {account.accessToken}
          </p>
        )}
      </AuthGate>
    </StrictMode>,
  );
}

describe('AuthGate', () => {
  it('asks a signed-out visitor for email and password', async () => {
    const { auth, mock } = fakeAuth();
    const user = userEvent.setup();
    renderGate(auth);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'alice@example.test');
    await user.type(screen.getByLabelText('Password'), 'synthetic-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(mock.signInWithPassword).toHaveBeenCalledWith({
      email: 'alice@example.test',
      password: 'synthetic-password',
    });
    expect(screen.queryByText(/app for/)).not.toBeInTheDocument();
  });

  it('says why after choosing a new password, once', async () => {
    notePasswordChanged();
    const { auth } = fakeAuth();
    const { unmount } = renderGate(auth);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your new password is saved. Sign in with it.',
    );
    unmount();
    renderGate(auth);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText(/new password is saved/)).not.toBeInTheDocument();
  });

  it('shows one generic message when sign-in fails', async () => {
    const { auth, mock } = fakeAuth();
    mock.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { message: 'Invalid login credentials' },
    } as never);
    const user = userEvent.setup();
    renderGate(auth);

    await user.type(await screen.findByLabelText('Email'), 'alice@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in failed. Check your email and password.',
    );
  });

  it('asks for the authenticator code when a factor is set up', async () => {
    const { auth, mock } = fakeAuth({
      session: SESSION,
      nextLevel: 'aal2',
      factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }],
    });
    const user = userEvent.setup();
    renderGate(auth);

    expect(
      await screen.findByRole('heading', { name: 'Enter your authenticator code' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/6-digit code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(mock.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: 'factor-1',
      code: '123456',
    });
    expect(mock.mfa.enroll).not.toHaveBeenCalled();
  });

  it('says so when the code is wrong', async () => {
    const { auth, mock } = fakeAuth({
      session: SESSION,
      nextLevel: 'aal2',
      factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }],
    });
    mock.mfa.challengeAndVerify.mockResolvedValueOnce({
      data: {},
      error: { message: 'Invalid TOTP code entered' },
    } as never);
    const user = userEvent.setup();
    renderGate(auth);

    await user.type(await screen.findByLabelText(/6-digit code/), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(WRONG_CODE);
  });

  it('sets up an authenticator once, clearing an unfinished setup first', async () => {
    const { auth, mock } = fakeAuth({
      session: SESSION,
      factors: [{ id: 'factor-stale', factor_type: 'totp', status: 'unverified' }],
    });
    const user = userEvent.setup();
    renderGate(auth);

    expect(
      await screen.findByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('SYNTHETICSECRET');
    expect(screen.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute(
      'href',
      'otpauth://totp/GSS:alice@example.test?secret=SYNTHETICSECRET&issuer=GSS',
    );
    expect(mock.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'factor-stale' });
    expect(mock.mfa.enroll).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText(/6-digit code/), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    expect(mock.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: 'factor-new',
      code: '654321',
    });
  });

  it('shows the app only at assurance level aal2', async () => {
    const { auth } = fakeAuth({ session: SESSION, currentLevel: 'aal2', nextLevel: 'aal2' });
    renderGate(auth);

    expect(
      await screen.findByText('app for alice@example.test with token-aal'),
    ).toBeInTheDocument();
  });

  it('re-checks after every sign-in change', async () => {
    const fake = fakeAuth();
    renderGate(fake.auth);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    Object.assign(fake.state, { session: SESSION, currentLevel: 'aal2', nextLevel: 'aal2' });
    fake.emit();

    expect(await screen.findByText(/app for alice@example.test/)).toBeInTheDocument();
  });

  it('lets a user sign out from the code prompt', async () => {
    const { auth, mock } = fakeAuth({
      session: SESSION,
      nextLevel: 'aal2',
      factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }],
    });
    const user = userEvent.setup();
    renderGate(auth);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(mock.signOut).toHaveBeenCalledTimes(1);
  });
});
