import { describe, expect, it } from 'vitest';

import {
  admissionIdentity,
  cleanAddress,
  cut,
  dmarcResult,
  envelopeOnDomain,
  headerTokens,
  htmlToText,
  inboundConfig,
  isAutomatic,
  wellFormed,
  MAX_BODY_CHARS,
  readInbound,
  sha256Hex,
} from './inbound-email';

const CONFIG = { domain: 'example.com', organizationId: '11111111-1111-4111-8111-111111111111' };
const ENVELOPE = { from: 'buyer@farm.example', to: 'info@example.com' };

function raw(lines: string[]): Uint8Array {
  return new TextEncoder().encode(lines.join('\r\n'));
}

async function read(lines: string[], envelope = ENVELOPE) {
  const bytes = raw(lines);
  return readInbound(bytes, await sha256Hex(bytes), envelope);
}

const PLAIN = [
  'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass',
  'From: "Pat Buyer" <Pat@Farm.Example>',
  'To: info@example.com, "Sam" <sam@example.com>',
  'Cc: other@farm.example',
  'Subject: Re: Feed barley',
  'Message-ID: <abc123@farm.example>',
  'In-Reply-To: <sent-1@example.com>',
  'References: <first@example.com> <sent-1@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'We can take 200 tonnes.',
];

describe('inboundConfig', () => {
  it('needs both the domain and the organization, and not the sending binding', () => {
    expect(
      inboundConfig({
        EMAIL_DOMAIN: ' Example.com ',
        EMAIL_ORGANIZATION_ID: CONFIG.organizationId,
      }),
    ).toEqual(CONFIG);
    expect(inboundConfig({ EMAIL_DOMAIN: 'example.com' })).toBeNull();
    expect(
      inboundConfig({ EMAIL_DOMAIN: 'not a domain', EMAIL_ORGANIZATION_ID: CONFIG.organizationId }),
    ).toBeNull();
  });
});

describe('addresses', () => {
  it('keeps an address lowercased and refuses malformed ones', () => {
    expect(cleanAddress(' Pat@Farm.Example ')).toBe('pat@farm.example');
    expect(cleanAddress('two@@ats')).toBeNull();
    expect(cleanAddress('with space@x.example')).toBeNull();
    expect(cleanAddress('a\r\nb@x.example')).toBeNull();
    expect(cleanAddress(undefined)).toBeNull();
  });

  it('accepts only envelopes on the configured domain', () => {
    expect(envelopeOnDomain('Info@Example.com', CONFIG)).toBe('info@example.com');
    expect(envelopeOnDomain('info@other.example', CONFIG)).toBeNull();
    expect(envelopeOnDomain('info@sub.example.com', CONFIG)).toBeNull();
  });
});

describe('dmarcResult', () => {
  const h = (value: string) => ({ key: 'authentication-results', originalKey: 'x', value });

  it('reads Cloudflare’s first header', () => {
    expect(dmarcResult([h('mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass')])).toBe('pass');
    expect(dmarcResult([h('mx.cloudflare.net; spf=none; dmarc=none')])).toBe('none');
    expect(dmarcResult([h('mx.cloudflare.net; dmarc=fail (p=none)')])).toBe('fail');
  });

  it('never trusts a later header, or one from another server', () => {
    expect(
      dmarcResult([
        h('mx.cloudflare.net; spf=fail; dmarc=fail'),
        h('mx.cloudflare.net; dmarc=pass'),
      ]),
    ).toBe('fail');
    expect(dmarcResult([h('mail.attacker.example; dmarc=pass')])).toBe('missing');
    expect(dmarcResult([])).toBe('missing');
    expect(dmarcResult([h('mx.cloudflare.net; spf=pass')])).toBe('missing');
  });
});

describe('isAutomatic', () => {
  const h = (key: string, value: string) => ({ key, originalKey: key, value });

  it('marks auto-replies, reports and bulk mail', () => {
    expect(isAutomatic([h('auto-submitted', 'auto-replied')], 'a@b.example')).toBe(true);
    expect(isAutomatic([h('auto-submitted', 'no')], 'a@b.example')).toBe(false);
    expect(isAutomatic([h('x-autoreply', 'yes')], 'a@b.example')).toBe(true);
    expect(isAutomatic([h('precedence', 'bulk')], 'a@b.example')).toBe(true);
    expect(isAutomatic([], '')).toBe(true);
    expect(isAutomatic([], 'MAILER-DAEMON@b.example')).toBe(true);
    expect(
      isAutomatic(
        [h('content-type', 'multipart/report; report-type=delivery-status')],
        'a@b.example',
      ),
    ).toBe(true);
    expect(isAutomatic([], 'a@b.example')).toBe(false);
  });
});

describe('htmlToText', () => {
  it('keeps the words and drops tags, scripts and styles', () => {
    expect(
      htmlToText(
        '<html><head><style>p{}</style></head><body><p>Hello&nbsp;<b>there</b></p><script>x()</script>Line&#33;<br>Two &amp; &#x41;</body></html>',
      ),
    ).toBe('Hello there\nLine!\nTwo & A');
  });

  it('leaves an invalid character reference as written', () => {
    expect(htmlToText('&#xD800; &#0; &bogus;')).toBe('&#xD800; &#0; &bogus;');
  });
});

describe('headerTokens', () => {
  it('splits ids and drops anything with control characters', () => {
    expect(headerTokens(' <a@x>  <b@y>,<c@z> ')).toEqual(['<a@x>', '<b@y>', '<c@z>']);
    expect(headerTokens(undefined)).toEqual([]);
  });
});

describe('readInbound', () => {
  it('reads a plain reply', async () => {
    const email = await read(PLAIN);
    expect(email).toMatchObject({
      envelopeTo: 'info@example.com',
      fromAddress: 'pat@farm.example',
      fromName: 'Pat Buyer',
      to: ['info@example.com', 'sam@example.com'],
      cc: ['other@farm.example'],
      subject: 'Re: Feed barley',
      body: 'We can take 200 tonnes.',
      bodyTruncated: false,
      messageId: '<abc123@farm.example>',
      inReplyTo: '<sent-1@example.com>',
      references: ['<first@example.com>', '<sent-1@example.com>'],
      dmarc: 'pass',
      automatic: false,
      parseFailed: false,
      attachments: [],
    });
  });

  it('marks mail whose only DMARC pass was written by the sender as unverified', async () => {
    const email = await read([
      'Authentication-Results: mx.cloudflare.net; spf=none; dmarc=none',
      'Authentication-Results: mx.cloudflare.net; dmarc=pass',
      ...PLAIN.slice(1),
    ]);
    expect(email.dmarc).toBe('none');
  });

  it('gives mail without a Message-ID one from its contents', async () => {
    const lines = PLAIN.filter((line) => !line.startsWith('Message-ID'));
    const bytes = raw(lines);
    const hash = await sha256Hex(bytes);
    const email = await readInbound(bytes, hash, ENVELOPE);
    expect(email.messageId).toBe(`<${hash}@missing.invalid>`);
  });

  it('keeps the subject and the name on one line', async () => {
    const email = await read([
      'From: =?utf-8?Q?Pat=0D=0AEvil?= <pat@farm.example>',
      'To: info@example.com',
      'Subject: =?utf-8?Q?Hello=0D=0ABcc:_evil@x.example?=',
      'Message-ID: <m@x>',
      '',
      'Body',
    ]);
    expect(email.subject).toBe('Hello Bcc: evil@x.example');
    expect(email.fromName).toBe('Pat Evil');
  });

  it('turns an HTML-only body into text and never keeps the HTML', async () => {
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <h@x>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Price <b>firm</b></p><script>alert(1)</script>',
    ]);
    expect(email.body).toBe('Price firm');
  });

  it('cuts a long body and says so', async () => {
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <long@x>',
      '',
      'x'.repeat(MAX_BODY_CHARS + 100),
    ]);
    expect(email.body.length).toBe(MAX_BODY_CHARS);
    expect(email.bodyTruncated).toBe(true);
  });

  it('keeps only the latest 50 references', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `<r${String(i)}@x>`);
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <refs@x>',
      `References: ${ids.join(' ')}`,
      '',
      'Body',
    ]);
    expect(email.references).toHaveLength(50);
    expect(email.references[0]).toBe('<r10@x>');
    expect(email.references.at(-1)).toBe('<r59@x>');
  });

  it('lists attachments with their size and hash', async () => {
    const pdf = 'JVBERi0xLjQK'; // "%PDF-1.4\n"
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <att@x>',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'See the contract.',
      '--b',
      'Content-Type: application/pdf; name="contract.pdf"',
      'Content-Disposition: attachment; filename="contract.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdf,
      '--b',
      'Content-Type: image/png',
      'Content-Disposition: inline',
      'Content-ID: <logo1>',
      'Content-Transfer-Encoding: base64',
      '',
      'iVBORw0K',
      '--b--',
    ]);
    expect(email.body).toBe('See the contract.');
    expect(email.attachments).toEqual([
      {
        position: 0,
        fileName: 'contract.pdf',
        contentType: 'application/pdf',
        sizeBytes: 9,
        sha256: await sha256Hex(new TextEncoder().encode('%PDF-1.4\n')),
        disposition: 'attachment',
        contentId: null,
      },
      expect.objectContaining({
        position: 1,
        fileName: null,
        contentType: 'image/png',
        disposition: 'inline',
        contentId: '<logo1>',
      }),
    ]);
    expect(email.attachmentsNotListed).toBe(0);
  });

  it('keeps the sender from the envelope when the From header is unusable', async () => {
    const email = await read(['From: not an address', 'Message-ID: <f@x>', '', 'Body']);
    expect(email.fromAddress).toBe('buyer@farm.example');
  });
});

describe('Codex final review, round 3', () => {
  it('turns hostile HTML into text in time that grows only with its length (R3-01)', () => {
    for (const piece of ['<', '<a', '<!--', '<script', '&#1', '</td']) {
      const started = performance.now();
      htmlToText(piece.repeat(200_000));
      expect(performance.now() - started).toBeLessThan(1500);
    }
  });

  it('keeps table cells apart in an HTML-only email (R3-03)', async () => {
    expect(
      htmlToText(
        '<table><tr><th>Price</th><th>Tonnes</th></tr><tr><td>250</td><td>100</td></tr></table>',
      ),
    ).toBe('Price\tTonnes\n250\t100');
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <table@x>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<table><tr><td>250</td><td>100</td></tr></table>',
    ]);
    expect(email.body).toBe('250\t100');
  });

  it('never cuts a character in half, and replaces half characters (R3-02)', async () => {
    expect(cut('ab\u{1F33E}c', 3)).toBe('ab');
    expect(cut('ab\u{1F33E}c', 4)).toBe('ab\u{1F33E}');
    expect(wellFormed('a\uD83Db')).toBe('a�b');
    const name = `${'a'.repeat(254)}\u{1F33E}.pdf`;
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <emoji@x>',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'See file.',
      '--b',
      'Content-Type: application/pdf',
      `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--b--',
    ]);
    const fileName = email.attachments[0]?.fileName ?? '';
    expect(fileName).toBe('a'.repeat(254));
    // JSON writes a half character as a \ud800–\udfff escape.
    expect(JSON.stringify(email)).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
  });
});

describe('Codex final review, round 4', () => {
  it('stops converting once the body limit is reached, however many tags follow (R4-01)', async () => {
    const html = '<i>ab</i>'.repeat(2_700_000);
    const text = htmlToText(html);
    expect(text.length).toBeLessThanOrEqual(MAX_BODY_CHARS + 1);
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <big-html@x>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<i>ab</i>'.repeat(300_000),
    ]);
    expect(email.body.length).toBe(MAX_BODY_CHARS);
    expect(email.bodyTruncated).toBe(true);
  });

  it('keeps cells apart when the sender left out their closing tags (R4-02)', async () => {
    expect(htmlToText('<table><tr><td>250<td>100</tr></table>')).toBe('250\t100');
    expect(htmlToText('<table><tr><th>Price<th>Tonnes<tr><td>250<td>100</table>')).toBe(
      'Price\tTonnes\n250\t100',
    );
    const email = await read([
      'From: pat@farm.example',
      'To: info@example.com',
      'Message-ID: <open-cells@x>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<table><tr><td>250<td>100</table>',
    ]);
    expect(email.body).toBe('250\t100');
  });

  it('reads the sender and Message-ID from the headers alone', () => {
    const headers = new Headers({ From: 'Pat <Pat@Farm.Example>', 'Message-ID': ' <m-1@x> ' });
    expect(admissionIdentity(headers, 'a'.repeat(64), 'bounce@x.example')).toEqual({
      sender: 'pat@farm.example',
      messageId: '<m-1@x>',
    });
    expect(admissionIdentity(new Headers(), 'a'.repeat(64), 'Bounce@X.example')).toEqual({
      sender: 'bounce@x.example',
      messageId: `<${'a'.repeat(64)}@missing.invalid>`,
    });
  });
});

describe('Codex final review, round 5', () => {
  it('converts many short paragraphs, lines and cells in time that grows with the length (R5-01)', () => {
    for (const piece of ['<p>a</p>', 'a<br>', '<div>ab</div>', '<tr><td>1<td>2', '<li>x']) {
      const started = performance.now();
      const text = htmlToText(piece.repeat(250_000));
      expect(text.length).toBeGreaterThan(0);
      expect(performance.now() - started).toBeLessThan(1500);
    }
  });
});
