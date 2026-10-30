import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';

// Logos need the bearer token, so they are fetched with it and shown from blob URLs.
// A logo's checksum changes whenever it is replaced, so one fetch per checksum is enough:
// asked for by checksum, the browser also keeps it across visits (owner's request,
// 2026-10-30), and one already loaded shows at once when a page or view is opened again.
const cache = new Map<string, Promise<string>>();
const ready = new Map<string, string>();

function loadLogo(counterpartyId: string, sha256: string, token: string): Promise<string> {
  const key = `${counterpartyId}:${sha256}`;
  let url = cache.get(key);
  if (!url) {
    url = apiFetch(`/counterparties/${counterpartyId}/logo?v=${sha256}`, token)
      .then((res) => res.blob())
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        ready.set(key, objectUrl);
        return objectUrl;
      });
    url.catch(() => cache.delete(key));
    cache.set(key, url);
  }
  return url;
}

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (
    words.length > 1
      ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`
      : (words[0] ?? '?').slice(0, 2)
  ).toUpperCase();
}

const SIZES = { sm: 'size-10 text-xs', md: 'size-16 text-sm', lg: 'size-28 text-xl' } as const;

/**
 * The counterparty's logo, or its initials when it has none. Loads only once the logo
 * scrolls into view, so a long list does not fetch every logo at once.
 */
export function CounterpartyLogo({
  counterpartyId,
  name,
  sha256,
  token,
  size = 'sm',
}: {
  counterpartyId: string;
  name: string;
  sha256: string | null;
  token: string;
  size?: keyof typeof SIZES;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const key = `${counterpartyId}:${sha256 ?? ''}`;

  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || sha256 === null) return;
    let current = true;
    loadLogo(counterpartyId, sha256, token)
      .then((url) => {
        if (current) setLoaded({ key, url });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [visible, counterpartyId, sha256, token, key]);

  const url = loaded?.key === key ? loaded.url : (ready.get(key) ?? null);
  return (
    <span
      ref={box}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-control border font-semibold',
        // Logos are drawn for a white background, in either theme.
        url ? 'bg-white' : 'bg-muted text-muted-foreground',
        SIZES[size],
      )}
    >
      {url ? (
        <img src={url} alt={`${name} logo`} className="size-full object-contain" />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
