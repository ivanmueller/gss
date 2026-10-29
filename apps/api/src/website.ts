import { websiteProblem, writtenAddressProblem } from '@grain/domain';

// Whether a counterparty's website can be previewed inside the app (docs/DECISIONS.md,
// website preview). Many sites forbid being shown inside another site's page with the
// X-Frame-Options header or the frame-ancestors rule of Content-Security-Policy, and a
// browser hides those headers from the page that would show the site. So the Worker asks
// the site itself, reads only its headers and offers a preview when nothing forbids it.
// Only the saved website is fetched, never an address sent by the browser; every redirect
// is checked like the website itself, and nothing from the site is stored or returned.

const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; GSS website preview check)';

/**
 * allowed: the site may be shown in the app. refused: the site forbids it. not_secure: the
 * site (or a redirect) is plain http, which a secure page cannot show. unreachable: no
 * answer, an error status, or a redirect to an address that is not a public website.
 */
export type PreviewVerdict = 'allowed' | 'refused' | 'not_secure' | 'unreachable';

interface Source {
  scheme: string | null;
  host: string;
  port: string | null;
}

const HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+|\*))?(?:\/.*)?$/;

function hostSource(text: string): Source | null {
  const match = HOST_SOURCE.exec(text);
  if (!match) return null;
  return { scheme: match[1] ?? null, host: match[2] ?? '', port: match[3] ?? null };
}

/** Whether one frame-ancestors source list lets `app` (the app's origin) show the site. */
function ancestorsAllow(sources: string[], app: URL): boolean {
  const appScheme = app.protocol.slice(0, -1);
  const appPort = app.port === '' ? (appScheme === 'https' ? '443' : '80') : app.port;
  return sources.some((raw) => {
    const source = raw.toLowerCase();
    if (source === '*') return appScheme === 'https' || appScheme === 'http';
    // A scheme alone; http: also allows https (CSP Level 3).
    if (source === 'https:') return appScheme === 'https';
    if (source === 'http:') return appScheme === 'https' || appScheme === 'http';
    if (source.startsWith("'")) return false; // 'none', 'self' (never the app's origin)
    const parsed = hostSource(source);
    if (!parsed) return false;
    const scheme = parsed.scheme ?? 'https';
    if (scheme !== appScheme && !(scheme === 'http' && appScheme === 'https')) return false;
    const hostMatches =
      parsed.host === '*' ||
      (parsed.host.startsWith('*.')
        ? app.hostname.endsWith(parsed.host.slice(1))
        : app.hostname === parsed.host);
    const port = parsed.port ?? (appScheme === 'https' ? '443' : '80');
    return hostMatches && (port === '*' || port === appPort);
  });
}

/** Whether a site's response headers let the app at `appOrigin` show it in a frame. */
export function framingAllowed(headers: Headers, appOrigin: string): boolean {
  // Any X-Frame-Options value (DENY, SAMEORIGIN, the obsolete ALLOW-FROM) keeps the app out.
  if ((headers.get('x-frame-options') ?? '').trim() !== '') return false;
  const csp = headers.get('content-security-policy');
  if (csp === null) return true;
  const app = new URL(appOrigin);
  // Several policies arrive joined by commas; each one must allow the frame.
  for (const policy of csp.split(',')) {
    const directive = policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .find((tokens) => tokens[0]?.toLowerCase() === 'frame-ancestors');
    if (directive && !ancestorsAllow(directive.slice(1), app)) return false;
  }
  return true;
}

/** Asks the website whether it may be shown inside the app at `appOrigin`. */
export async function checkWebsitePreview(
  website: string,
  appOrigin: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<PreviewVerdict> {
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    return 'unreachable';
  }
  const app = new URL(appOrigin).origin;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (websiteProblem(url) !== null) return 'unreachable';
    if (url.protocol !== 'https:') return 'not_secure';
    // The app is never previewed inside itself, nor asked for its own pages.
    if (url.origin === app) return 'refused';
    let res: Response;
    try {
      res = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': USER_AGENT },
      });
    } catch {
      return 'unreachable';
    }
    // Only the headers are needed; the page itself is never read.
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      // A port, user name or number address in the redirect as written, which parsing could hide.
      if (location === null || writtenAddressProblem(location) !== null) return 'unreachable';
      try {
        url = new URL(location, url);
      } catch {
        return 'unreachable';
      }
      continue;
    }
    if (!res.ok) return 'unreachable';
    return framingAllowed(res.headers, appOrigin) ? 'allowed' : 'refused';
  }
  return 'unreachable';
}
