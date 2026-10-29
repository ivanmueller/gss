// A counterparty's website (the owner's request of 2026-10-29, docs/DECISIONS.md). Only
// public http and https addresses by name are kept: no other schemes (javascript:, data:,
// file:), no user names or passwords, no port numbers and no number addresses or local
// names, because the link is opened by staff and its page is fetched by the Worker to see
// whether it can be previewed.

// URL exists wherever this package runs (browsers, Workers, Node), but the package is
// compiled against ES2022 alone, without DOM types; this is the part of it used here.
export interface WebAddress {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly origin: string;
  readonly href: string;
}
declare const URL: new (input: string) => WebAddress;

/** The longest website kept, after it is tidied; the database has the same limit. */
export const MAX_WEBSITE_LENGTH = 500;

// Names that never belong to a public website (RFC 2606, RFC 6761 and common private ones).
const PRIVATE_SUFFIXES = new Set([
  'arpa',
  'corp',
  'example',
  'home',
  'internal',
  'intranet',
  'invalid',
  'lan',
  'local',
  'localdomain',
  'localhost',
  'onion',
  'test',
]);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LEVEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const IPV4 = /^\d+(?:\.\d+){3}$/;
// "mailto:", "javascript:" and the like; a colon followed by a digit is a port instead.
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const WEB_SCHEME = /^https?:\/\//i;

/**
 * Why a parsed address is not a public website, or null when it is. Used for a saved
 * website and for every redirect the Worker follows when it checks one.
 */
export function websiteProblem(url: WebAddress): string | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return 'must be a web address such as example.com';
  if (url.username !== '' || url.password !== '') return 'must not include a user name or password';
  if (url.port !== '') return 'must not include a port number';
  const host = url.hostname;
  if (host.startsWith('[') || IPV4.test(host))
    return 'needs a site name such as example.com, not a number address';
  const labels = host.split('.');
  const top = labels.at(-1) ?? '';
  if (
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label)) ||
    !TOP_LEVEL.test(top) ||
    PRIVATE_SUFFIXES.has(top)
  ) {
    return 'needs a public site name such as example.com';
  }
  return null;
}

export type WebsiteResult = { ok: true; website: string } | { ok: false; message: string };

/**
 * A website as typed (e.g. "example.com" or "https://www.example.com/grain"), tidied: https://
 * is added when no scheme is given, the site name is lower-cased, and a lone trailing slash
 * is dropped.
 */
export function parseWebsite(text: string): WebsiteResult {
  const value = text.trim();
  if (/\s/.test(value) || /\p{Cc}/u.test(value))
    return { ok: false, message: 'must not contain spaces' };
  if (!WEB_SCHEME.test(value) && OTHER_SCHEME.test(value))
    return { ok: false, message: 'must be a web address such as example.com' };
  let url: WebAddress;
  try {
    url = new URL(WEB_SCHEME.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, message: `"${value}" is not a web address` };
  }
  const problem = websiteProblem(url);
  if (problem !== null) return { ok: false, message: problem };
  const website =
    url.pathname === '/' && url.search === '' && url.hash === '' ? url.origin : url.href;
  if (website.length > MAX_WEBSITE_LENGTH)
    return { ok: false, message: `is longer than ${String(MAX_WEBSITE_LENGTH)} characters` };
  return { ok: true, website };
}

/** A website as shown on a page: the site name without "www." and the path, e.g. "example.com/grain". */
export function websiteLabel(website: string): string {
  try {
    const url = new URL(website);
    const host = url.hostname.replace(/^www\./, '');
    const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}`;
    return `${host}${rest}`.replace(/\/$/, '');
  } catch {
    return website;
  }
}
