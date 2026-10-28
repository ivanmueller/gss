import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { mockApi } from '../test/api';
import { ChoosePassword, YourName } from './FirstSignIn';
import { clearPasswordChangedNote, hasPasswordChangedNote } from './passwordNotice';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('ChoosePassword', () => {
  it('checks the password, then saves it through the API', async () => {
    const calls = mockApi({ 'POST /me/password': () => Response.json({ saved: true }) });
    const onDone = vi.fn();
    render(<ChoosePassword token="t" onDone={onDone} onSignOut={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 12 characters.');

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a long synthetic phrase');
    await userEvent.type(screen.getByLabelText('The same again'), 'a long synthetic phrasE');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords are not the same.');
    expect(calls).toHaveLength(0);

    await userEvent.clear(screen.getByLabelText('The same again'));
    await userEvent.type(screen.getByLabelText('The same again'), 'a long synthetic phrase');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(calls[0]?.body).toEqual({ password: 'a long synthetic phrase' });
  });
});

describe('YourName', () => {
  it('needs a first name and saves both', async () => {
    const saveName = vi.fn(() => Promise.resolve(null));
    const onDone = vi.fn();
    render(<YourName saveName={saveName} onDone={onDone} onSignOut={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your first name.');

    await userEvent.type(screen.getByLabelText('First name'), '  Ana ');
    await userEvent.type(screen.getByLabelText('Last name'), 'Synthetic');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(saveName).toHaveBeenCalledWith('Ana', 'Synthetic');
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });
});

describe('the app after a first sign-in', () => {
  const ME = {
    id: 'u1',
    email: 'ana@example.test',
    firstName: null,
    lastName: null,
    organizations: [{ id: 'org-a', name: 'GSS', role: 'viewer' }],
  };

  it('asks for a new password first, then signs out so the person signs in with it', async () => {
    mockApi({
      'GET /me': () => Response.json({ ...ME, mustChangePassword: true }),
      'GET /health': () => Response.json({ status: 'ok', service: 'api' }),
      'POST /me/password': () => Response.json({ saved: true }),
    });
    const signOut = vi.fn();
    render(<App account={{ email: null, accessToken: 't', signOut, saveName: vi.fn() }} />);

    expect(
      await screen.findByRole('heading', { name: 'Choose your password' }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New password'), 'a long synthetic phrase');
    await userEvent.type(screen.getByLabelText('The same again'), 'a long synthetic phrase');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
    });
    expect(hasPasswordChangedNote()).toBe(true);
    clearPasswordChangedNote();
  });

  it('asks for a missing name before the app', async () => {
    let me: Record<string, unknown> = { ...ME, mustChangePassword: false };
    mockApi({
      'GET /me': () => Response.json(me),
      'GET /health': () => Response.json({ status: 'ok', service: 'api' }),
    });
    const saveName = vi.fn(() => {
      me = { ...me, firstName: 'Ana' };
      return Promise.resolve(null);
    });
    render(<App account={{ email: null, accessToken: 't', signOut: vi.fn(), saveName }} />);

    expect(await screen.findByRole('heading', { name: 'Your name' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('First name'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});
