import { describe, expect, it } from 'vitest';

import {
  MAX_WEBSITE_LENGTH,
  parseWebsite,
  websiteLabel,
  websiteProblem,
  writtenAddressProblem,
  type WebAddress,
} from './website';

// Node's URL; the package has no DOM types (see website.ts).
declare const URL: new (input: string) => WebAddress;

const ok = (text: string) => parseWebsite(text);

describe('parseWebsite', () => {
  it('adds https:// when no scheme is given and tidies the address', () => {
    expect(ok('example.com')).toEqual({ ok: true, website: 'https://example.com' });
    expect(ok('  WWW.Example.COM/  ')).toEqual({ ok: true, website: 'https://www.example.com' });
    expect(ok('HTTPS://Example.com/Grain?region=SK')).toEqual({
      ok: true,
      website: 'https://example.com/Grain?region=SK',
    });
    expect(ok('http://example.com/about/')).toEqual({
      ok: true,
      website: 'http://example.com/about/',
    });
    // International names are kept in their ASCII form.
    expect(ok('bücher.example.ca')).toEqual({
      ok: true,
      website: 'https://xn--bcher-kva.example.ca',
    });
  });

  it('refuses other schemes, which could run code or open files', () => {
    for (const text of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'ftp://example.com',
      'mailto:sales@example.com',
    ]) {
      expect(ok(text)).toEqual({ ok: false, message: 'must be a web address such as example.com' });
    }
  });

  it('refuses spaces, credentials, ports, number addresses and private names', () => {
    expect(ok('example .com')).toEqual({ ok: false, message: 'must not contain spaces' });
    expect(ok('example.com/\u0000')).toEqual({ ok: false, message: 'must not contain spaces' });
    expect(ok('https://user:secret@example.com')).toEqual({
      ok: false,
      message: 'must not include a user name or password',
    });
    // Every port as written, even a default one, which URL parsing would drop (Codex's review).
    for (const text of [
      'example.com:8080',
      'https://example.com:443',
      'http://example.com:80/grain',
      'example.com:443',
      'https://example.com:',
    ]) {
      expect(ok(text)).toEqual({ ok: false, message: 'must not include a port number' });
    }
    expect(ok('https://user@example.com')).toEqual({
      ok: false,
      message: 'must not include a user name or password',
    });
    // A backslash ends the site name, as in browsers: this is example.com with a path.
    expect(ok('https://example.com\\@evil.example.org')).toEqual({
      ok: true,
      website: 'https://example.com/@evil.example.org',
    });
    for (const text of ['127.0.0.1', 'http://10.0.0.8/admin', 'https://[::1]/', 'http://0x7f.1']) {
      expect(ok(text)).toEqual({
        ok: false,
        message: 'needs a site name such as example.com, not a number address',
      });
    }
    for (const text of [
      'localhost',
      'https://intranet',
      'printer.local',
      'grain.internal',
      'synthetic.test',
      'example.com.',
      'https://-bad-.example.com',
      'example.c0m',
    ]) {
      expect(ok(text)).toEqual({
        ok: false,
        message: 'needs a public site name such as example.com',
      });
    }
  });

  it('refuses text that is not an address and addresses that are too long', () => {
    expect(ok('https://')).toEqual({ ok: false, message: '"https://" is not a web address' });
    const long = `example.com/${'a'.repeat(MAX_WEBSITE_LENGTH)}`;
    expect(ok(long)).toEqual({
      ok: false,
      message: `is longer than ${String(MAX_WEBSITE_LENGTH)} characters`,
    });
  });
});

describe('websiteProblem', () => {
  it('checks an address already parsed, such as a redirect', () => {
    expect(websiteProblem(new URL('https://www.example.com/next'))).toBeNull();
    expect(websiteProblem(new URL('http://169.254.169.254/latest'))).toBe(
      'needs a site name such as example.com, not a number address',
    );
  });
});

describe('writtenAddressProblem', () => {
  it('reads the site part of an address as written, as a redirect gives it', () => {
    expect(writtenAddressProblem('https://www.example.com/next')).toBeNull();
    expect(writtenAddressProblem('/relative/path:with:colons')).toBeNull();
    expect(writtenAddressProblem('next?at=a@b')).toBeNull();
    expect(writtenAddressProblem('https://example.com:443/')).toBe(
      'must not include a port number',
    );
    expect(writtenAddressProblem('//example.com:443/')).toBe('must not include a port number');
    expect(writtenAddressProblem('https:\\\\example.com:443')).toBe(
      'must not include a port number',
    );
    expect(writtenAddressProblem('https:example.com:443')).toBe('must not include a port number');
    expect(writtenAddressProblem('https://u:p@example.com/')).toBe(
      'must not include a user name or password',
    );
    expect(writtenAddressProblem('https://[::1]/')).toBe(
      'needs a site name such as example.com, not a number address',
    );
  });
});

describe('websiteLabel', () => {
  it('shows the site name without www. and with its path', () => {
    expect(websiteLabel('https://www.example.com')).toBe('example.com');
    expect(websiteLabel('https://example.com/grain/')).toBe('example.com/grain');
    expect(websiteLabel('https://example.com/grain?region=SK')).toBe('example.com/grain?region=SK');
  });
});
