import { describe, expect, it, vi } from 'vitest';

import { checkWebsitePreview, framingAllowed } from './website';

const APP = 'https://grain-trading-api-staging.example.workers.dev';

const headers = (values: Record<string, string>) => new Headers(values);

describe('framingAllowed', () => {
  it('allows a site that says nothing about frames', () => {
    expect(framingAllowed(headers({}), APP)).toBe(true);
    expect(framingAllowed(headers({ 'content-security-policy': "default-src 'self'" }), APP)).toBe(
      true,
    );
  });

  it('refuses any X-Frame-Options', () => {
    for (const value of ['DENY', 'SAMEORIGIN', 'sameorigin', 'ALLOW-FROM https://example.com']) {
      expect(framingAllowed(headers({ 'x-frame-options': value }), APP)).toBe(false);
    }
  });

  it('follows frame-ancestors', () => {
    const csp = (value: string) => headers({ 'content-security-policy': value });
    expect(framingAllowed(csp("frame-ancestors 'none'"), APP)).toBe(false);
    expect(framingAllowed(csp("frame-ancestors 'self'"), APP)).toBe(false);
    expect(framingAllowed(csp('frame-ancestors'), APP)).toBe(false);
    expect(
      framingAllowed(csp("default-src 'self'; frame-ancestors https://partner.example"), APP),
    ).toBe(false);
    expect(framingAllowed(csp('frame-ancestors *'), APP)).toBe(true);
    expect(framingAllowed(csp('FRAME-ANCESTORS https:'), APP)).toBe(true);
    expect(framingAllowed(csp("frame-ancestors 'self' *.example.workers.dev"), APP)).toBe(true);
    expect(framingAllowed(csp(`frame-ancestors ${APP}`), APP)).toBe(true);
    expect(framingAllowed(csp(`frame-ancestors ${APP}:8443`), APP)).toBe(false);
    expect(framingAllowed(csp('frame-ancestors *.workers.dev'), 'https://workers.dev')).toBe(false);
  });

  it('needs every policy to allow the frame', () => {
    const value = "frame-ancestors *, frame-ancestors 'none'";
    expect(framingAllowed(headers({ 'content-security-policy': value }), APP)).toBe(false);
  });

  it('ignores a policy that only reports', () => {
    const value = "frame-ancestors 'none'";
    expect(framingAllowed(headers({ 'content-security-policy-report-only': value }), APP)).toBe(
      true,
    );
  });
});

type Answer = Response | Error;

function site(answers: Record<string, Answer>) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>((url) => {
    const answer = answers[url];
    if (answer === undefined) return Promise.reject(new Error(`unexpected fetch of ${url}`));
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

const redirect = (location: string, status = 301) =>
  new Response(null, { status, headers: { location } });

describe('checkWebsitePreview', () => {
  it('asks the site for its headers only, without following redirects blindly', async () => {
    const body = new ReadableStream<Uint8Array>();
    const cancel = vi.spyOn(body, 'cancel');
    const page = new Response(body, { status: 200 });
    const fetchImpl = site({ 'https://example.com/': page });
    expect(await checkWebsitePreview('https://example.com', APP, fetchImpl)).toBe('allowed');
    expect(cancel).toHaveBeenCalled();
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
  });

  it('says refused when the site forbids frames', async () => {
    const fetchImpl = site({
      'https://example.com/': new Response('', { headers: { 'x-frame-options': 'DENY' } }),
    });
    expect(await checkWebsitePreview('https://example.com', APP, fetchImpl)).toBe('refused');
  });

  it('follows redirects and judges the page they end on', async () => {
    const fetchImpl = site({
      'https://example.com/': redirect('https://www.example.com/'),
      'https://www.example.com/': redirect('/home', 302),
      'https://www.example.com/home': new Response('', {
        headers: { 'content-security-policy': "frame-ancestors 'none'" },
      }),
    });
    expect(await checkWebsitePreview('https://example.com', APP, fetchImpl)).toBe('refused');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('says not_secure for a plain http site or a redirect to one, without asking it', async () => {
    const none = site({});
    expect(await checkWebsitePreview('http://example.com', APP, none)).toBe('not_secure');
    expect(none).not.toHaveBeenCalled();
    const fetchImpl = site({ 'https://example.com/': redirect('http://example.com/') });
    expect(await checkWebsitePreview('https://example.com', APP, fetchImpl)).toBe('not_secure');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never follows a redirect to a number address, a private name or a port', async () => {
    for (const location of [
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.1/',
      'https://localhost/',
      'https://printer.local/',
      'https://example.com:8443/',
      'https://user:secret@example.com/',
    ]) {
      const fetchImpl = site({ 'https://example.com/': redirect(location) });
      expect(await checkWebsitePreview('https://example.com', APP, fetchImpl)).toBe('unreachable');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('says unreachable for errors, error statuses, endless redirects and no answer', async () => {
    const statuses = [403, 404, 500, 503];
    for (const status of statuses) {
      const fetchImpl = site({ 'https://example.com/': new Response('', { status }) });
      expect(await checkWebsitePreview('https://example.com', APP, fetchImpl)).toBe('unreachable');
    }
    expect(
      await checkWebsitePreview(
        'https://example.com',
        APP,
        site({ 'https://example.com/': new Error('network') }),
      ),
    ).toBe('unreachable');
    expect(
      await checkWebsitePreview(
        'https://example.com',
        APP,
        site({ 'https://example.com/': new Response(null, { status: 302 }) }),
      ),
    ).toBe('unreachable');
    const loop = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(redirect('https://example.com/')),
    );
    expect(await checkWebsitePreview('https://example.com', APP, loop)).toBe('unreachable');
    expect(loop).toHaveBeenCalledTimes(6);
  });
});
