import { describe, expect, it } from 'vitest';

import { setupLink } from './MfaEnroll';

describe('setupLink', () => {
  it('keeps an authenticator setup link', () => {
    const uri = 'otpauth://totp/GSS:a@example.test?secret=SYNTHETIC&issuer=GSS';
    expect(setupLink(uri)).toBe(uri);
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
