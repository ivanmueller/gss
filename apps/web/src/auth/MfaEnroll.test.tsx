import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectPlatform, type Platform } from '../lib/device';
import type { AuthClient } from '../lib/supabase';
import { MfaEnroll, setupLink } from './MfaEnroll';

// Synthetic setup data only.
const SECRET = 'SYNTHETICSECRET';
const URI = `otpauth://totp/GSS:alice@example.test?secret=${SECRET}&issuer=GSS`;

function fakeAuth(uri: string | undefined = URI): AuthClient {
  const ok = <T,>(data: T) => Promise.resolve({ data, error: null });
  return {
    mfa: {
      listFactors: () => ok({ all: [], totp: [] }),
      unenroll: () => ok({}),
      enroll: () =>
        ok({
          id: 'factor-new',
          totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET, uri },
        }),
      challengeAndVerify: () => ok({}),
    },
  } as unknown as AuthClient;
}

function show(platform: Platform, uri?: string) {
  render(<MfaEnroll auth={fakeAuth(uri)} onSignOut={() => undefined} platform={platform} />);
  return screen.findByTestId('totp-secret');
}

/** The clipboard as the page sees it (jsdom has none). */
function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('setupLink', () => {
  it('keeps an authenticator setup link', () => {
    expect(setupLink(URI)).toBe(URI);
    expect(setupLink('OTPAUTH://TOTP/GSS:a@example.test?secret=SYNTHETIC')).not.toBeNull();
  });

  it('never makes anything else a link', () => {
    expect(setupLink(undefined)).toBeNull();
    expect(setupLink('')).toBeNull();
    expect(setupLink('javascript:alert(1)')).toBeNull();
    expect(setupLink('https://example.test/otpauth://totp/x')).toBeNull();
    expect(setupLink('otpauth://hotp/GSS:a?secret=SYNTHETIC')).toBeNull();
    expect(setupLink('otpauth://totp/GSS a?secret=SYNTHETIC')).toBeNull();
  });
});

describe('detectPlatform', () => {
  const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

  it('tells iPhones and iPads, Android and computers apart', () => {
    expect(detectPlatform(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'))).toBe(
      'ios',
    );
    // iPadOS describes itself as a Mac, but a Mac has no touch screen.
    expect(detectPlatform(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5))).toBe('ios');
    expect(detectPlatform(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'))).toBe('computer');
    expect(detectPlatform(nav('Mozilla/5.0 (Linux; Android 15; Pixel 7)', 5))).toBe('android');
    expect(detectPlatform(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'))).toBe('computer');
    // Without a device given, this browser's own (jsdom, a computer).
    expect(detectPlatform()).toBe('computer');
  });
});

describe('MfaEnroll', () => {
  it('shows a computer the QR code to scan with a phone, and the key, without a link', async () => {
    expect(await show('computer')).toHaveTextContent(SECRET);
    expect(
      screen.getByText(/Scan this code with the authenticator app on your phone/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy setup key' })).toBeNull();
  });

  it('offers an iPhone the key to copy, and Apple Passwords by its own name', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    await show('ios');
    expect(
      screen.getByText('Add GSS to your authenticator app, then enter the 6-digit code it shows.'),
    ).toBeInTheDocument();
    // iOS sends every setup link to Apple Passwords, so the link says so.
    expect(screen.getByRole('link', { name: 'Save in Apple Passwords' })).toHaveAttribute(
      'href',
      URI,
    );
    expect(screen.queryByRole('link', { name: 'Open in authenticator app' })).toBeNull();
    // A phone cannot scan its own screen.
    expect(screen.queryByRole('img')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Copy setup key' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Copied. In your authenticator app, add a code with “Enter a setup key”, name it GSS and paste.',
    );
  });

  it('says to type the key when copying is refused', async () => {
    setClipboard(() => Promise.reject(new Error('denied')));
    await show('ios');
    await userEvent.click(screen.getByRole('button', { name: 'Copy setup key' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not copy. Type the key below into your authenticator app.',
    );
  });

  it('lets Android open the authenticator app with the setup link, or copy the key', async () => {
    await show('android');
    expect(screen.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute(
      'href',
      URI,
    );
    expect(screen.getByRole('button', { name: 'Copy setup key' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('never makes a link of a setup link that is not one', async () => {
    await show('ios', 'javascript:alert(1)');
    await show('android', 'javascript:alert(1)');
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getAllByRole('button', { name: 'Copy setup key' })).toHaveLength(2);
  });
});
