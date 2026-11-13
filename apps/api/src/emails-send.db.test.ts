import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type RequestContext } from './db';
import { EMAIL_LIST_LIMIT } from './emails-db';

// Integration test of email sent by hand (F-114 step 3): the API's database code as `app_api`
// against the real migrations. Fixtures are synthetic; emails are never deleted, so every
// organization and id is fresh.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const demoter = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const db = postgresDatabase(API_URL);
const id = () => crypto.randomUUID();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
const org = id();
const company = id();
const people = { adam: id(), tom: id(), demoted: id(), vera: id(), ana: id() };
const ROLES: Record<string, string> = { tom: 'trader', vera: 'viewer', ana: 'analyst' };

beforeAll(async () => {
  await admin`insert into app.organizations (id, display_name) values (${org}, ${`Synthetic Org ${org}`})`;
  for (const [name, userId] of Object.entries(people)) {
    await admin`insert into auth.users (id, email, raw_user_meta_data)
      values (${userId}, ${`${name}-${userId}@example.test`}, ${admin.json({ first_name: name })})`;
    await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      values (${org}, ${userId}, ${ROLES[name] ?? 'org_admin'}, 'active', now())`;
  }
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by)
    values (${company}, ${org}, ${`Synthetic Buyer ${company}`}, '{buyer}', 'CA', 'manual', ${people.adam})`;
  expect(await db.saveEmailSettings(as(people.adam), org, 'info', 'Regards,\n{name}')).toBe(
    'saved',
  );
});

afterAll(async () => {
  await Promise.all([admin.end(), demoter.end(), db.close()]);
});

describe('a person’s address and signature details', () => {
  it('are saved together, or not at all', async () => {
    expect(
      await db.saveMemberEmail(as(people.adam), org, people.tom, {
        localPart: 'tom',
        title: 'Trader',
        phone: '403 555 0100',
      }),
    ).toBe('saved');
    // The shared address is refused: the title and phone sent with it are not kept either.
    expect(
      await db.saveMemberEmail(as(people.adam), org, people.tom, {
        localPart: 'info',
        title: 'Changed',
        phone: null,
      }),
    ).toBe('address_taken');
    const settings = await db.getEmailSettings(as(people.tom), org);
    expect(settings?.members.find((m) => m.userId === people.tom)).toMatchObject({
      localPart: 'tom',
      title: 'Trader',
      phone: '403 555 0100',
    });
  });

  it('are refused to a trader', async () => {
    expect(
      await db.saveMemberEmail(as(people.tom), org, people.tom, {
        localPart: 'tommy',
        title: null,
        phone: null,
      }),
    ).toBe('forbidden');
  });

  // As F-114-2-R4-01 for the address: the admin check is made after the organization's lock.
  it('are refused to an admin demoted while the save waited', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const demoting = demoter.begin(async (tx) => {
      await tx`select 1 from app.organizations where id = ${org} for update`;
      await tx`update app.organization_members set role = 'viewer'
                where organization_id = ${org} and user_id = ${people.demoted}`;
      locked();
      await held;
    });
    await isLocked;
    const saving = db.saveMemberEmail(as(people.demoted), org, people.adam, {
      localPart: null,
      title: 'Set by a demoted admin',
      phone: null,
    });
    let waiting = false;
    for (let tries = 0; tries < 100 && !waiting; tries += 1) {
      const [row] = await admin<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and query like '%app.save_member_email_address%'
          and pid <> pg_backend_pid()`;
      waiting = (row?.n ?? 0) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting).toBe(true);
    release();
    await demoting;
    expect(await saving).toBe('forbidden');
    const [row] = await admin<{ n: number }[]>`
      select count(*)::int as n from app.member_signature_details
       where organization_id = ${org} and user_id = ${people.adam}`;
    expect(row?.n).toBe(0);
  });
});

describe('sending', () => {
  const start = (key: string) =>
    db.startOutgoingEmail(as(people.tom), {
      organizationId: org,
      counterpartyId: company,
      contactId: null,
      fromLocalPart: 'tom',
      domain: 'gss.example.test',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Synthetic subject',
      body: 'Synthetic body.',
      messageId: `gss-${key}`,
      replyToEmailId: null,
      claudeDraftId: null,
      autoDraftId: null,
      attachments: [],
    });

  it('starts once per send key and answers the earlier email after (F-114-3-D1-02)', async () => {
    const key = id();
    const first = await start(key);
    expect(first.status).toBe('started');
    if (first.status !== 'started') return;
    expect(
      await db.finishOutgoingEmail(as(people.tom), first.id, {
        ok: false,
        failure: 'E_RECIPIENT_SUPPRESSED: x',
      }),
    ).toBe('done');
    const again = await start(key);
    expect(again).toMatchObject({
      status: 'already_started',
      email: { id: first.id, state: 'failed' },
    });
    // A new key after the refusal is a new attempt; the failed one is kept.
    const retry = await start(id());
    expect(retry.status).toBe('started');
  });

  it('logs a sent email in the contact history once, and a refused one not at all (R1-03)', async () => {
    const entries = async () => {
      const rows = await admin<
        { channel: string; contact_name: string; notes: string; recorded_by: string }[]
      >`
        select r.channel::text as channel, r.contact_name, r.notes, r.recorded_by
          from app.contact_log_entries e join app.contact_log_revisions r on r.entry_id = e.id
         where e.counterparty_id = ${company} and r.notes like 'Email sent: Synthetic subject%'`;
      return rows;
    };
    const before = (await entries()).length;
    const refused = await start(id());
    if (refused.status !== 'started') throw new Error('not started');
    await db.finishOutgoingEmail(as(people.tom), refused.id, {
      ok: false,
      failure: 'E_X: refused',
    });
    expect(await entries()).toHaveLength(before);

    const sent = await start(id());
    if (sent.status !== 'started') throw new Error('not started');
    expect(
      await db.finishOutgoingEmail(as(people.tom), sent.id, { ok: true, providerId: 'cf-1' }),
    ).toBe('done');
    expect(
      await db.finishOutgoingEmail(as(people.tom), sent.id, { ok: true, providerId: 'cf-1' }),
    ).toBe('already_finished');
    const after = await entries();
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      channel: 'email',
      contact_name: 'pat@buyer.example.test',
      notes: 'Email sent: Synthetic subject',
      recorded_by: people.tom,
    });
    // The list reads the addresses back as a list.
    expect((await db.getEmail(as(people.tom), org, sent.id))?.to).toEqual([
      'pat@buyer.example.test',
    ]);
  });

  it('lets a viewer and an analyst finish a sent email, kept but not in the history (R2-01)', async () => {
    for (const sender of [people.vera, people.ana]) {
      const started = await db.startOutgoingEmail(as(sender), {
        organizationId: org,
        counterpartyId: company,
        contactId: null,
        fromLocalPart: 'info',
        domain: 'gss.example.test',
        to: ['pat@buyer.example.test'],
        cc: [],
        subject: 'Synthetic read-only sender',
        body: 'Synthetic body.',
        messageId: `gss-${id()}`,
        replyToEmailId: null,
        claudeDraftId: null,
        autoDraftId: null,
        attachments: [],
      });
      if (started.status !== 'started') throw new Error(`not started: ${started.status}`);
      expect(
        await db.finishOutgoingEmail(as(sender), started.id, { ok: true, providerId: 'cf-2' }),
      ).toBe('done');
      expect((await db.getEmail(as(sender), org, started.id))?.state).toBe('sent');
    }
    const [row] = await admin<{ n: number }[]>`
      select count(*)::int as n from app.contact_log_revisions r
       where r.notes = 'Email sent: Synthetic read-only sender'`;
    expect(row?.n).toBe(0);
  });

  it('pages through every email of a company, including equal times (F-114-3-D1-03)', async () => {
    const pageCompany = id();
    await admin`insert into app.counterparties
        (id, organization_id, legal_name, types, primary_country, source, created_by)
      values (${pageCompany}, ${org}, ${`Synthetic Paged ${pageCompany}`}, '{buyer}', 'CA', 'manual', ${people.adam})`;
    const count = EMAIL_LIST_LIMIT + 3;
    // One statement: the trigger gives every email the same now(), to the microsecond, so the
    // order rests on the id alone and a cursor rounded to the millisecond would skip the rest
    // (Codex's review of F-114-3, R1-01).
    await admin`
      insert into app.emails (organization_id, direction, status, counterparty_id, sent_by, sent_by_name,
                              from_address, to_addresses, subject, body_text, message_id)
      select ${org}, 'outgoing', 'sending', ${pageCompany}, ${people.tom}, 'tom', 'tom@gss.example.test',
             '{pat@buyer.example.test}', 'Synthetic', 'Synthetic body.', 'gss-page-' || gen_random_uuid()
        from generate_series(1, ${count})`;
    const [shared] = await admin<{ n: number }[]>`
      select count(distinct occurred_at)::int as n from app.emails where counterparty_id = ${pageCompany}`;
    expect(shared?.n).toBe(1);
    const seen = new Set<string>();
    let before: { id: string } | null = null;
    for (let page = 0; page < 5; page += 1) {
      const emails = await db.listEmails(as(people.tom), org, pageCompany, before);
      if (emails === null || emails.length === 0) break;
      for (const email of emails) seen.add(email.id);
      const last = emails[emails.length - 1];
      if (last === undefined) break;
      before = { id: last.id };
    }
    expect(seen.size).toBe(count);
  });

  it('lists nothing for another organization’s member', async () => {
    const outsider = id();
    const otherOrg = id();
    await admin`insert into auth.users (id, email) values (${outsider}, ${`out-${outsider}@example.test`})`;
    await admin`insert into app.organizations (id, display_name) values (${otherOrg}, ${`Synthetic Org ${otherOrg}`})`;
    await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      values (${otherOrg}, ${outsider}, 'org_admin', 'active', now())`;
    expect(await db.listEmails(as(outsider), org, company, null)).toBeNull();
    expect(await db.getEmailSettings(as(outsider), org)).toBeNull();
  });
});

// F-114 step 7: files sent with an email, listed with it, each at a key the database writes.
describe('sending files', () => {
  const sha = (n: number) => n.toString(16).padStart(64, '0');
  const ticket = {
    position: 0,
    fileName: 'ticket.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1200,
    sha256: sha(1),
  };
  const files = [
    ticket,
    {
      position: 1,
      fileName: 'load.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 5000,
      sha256: sha(2),
    },
  ];
  const start = (key: string, attachments = files) =>
    db.startOutgoingEmail(as(people.tom), {
      organizationId: org,
      counterpartyId: company,
      contactId: null,
      fromLocalPart: 'tom',
      domain: 'gss.example.test',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Synthetic tickets',
      body: 'Synthetic body.',
      messageId: `gss-${key}`,
      replyToEmailId: null,
      claudeDraftId: null,
      autoDraftId: null,
      attachments,
    });

  it('lists the files with the email and answers their keys; members read and download them', async () => {
    const started = await start(id());
    expect(started.status).toBe('started');
    if (started.status !== 'started') return;
    expect(started.fileKeys).toEqual([
      `sent/${started.id}/0-${sha(1)}`,
      `sent/${started.id}/1-${sha(2)}`,
    ]);
    const viewed = await db.getEmail(as(people.vera), org, started.id);
    expect(viewed?.attachmentCount).toBe(2);
    expect(viewed?.attachments).toEqual([
      {
        position: 0,
        fileName: 'ticket.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1200,
        disposition: 'attachment',
      },
      {
        position: 1,
        fileName: 'load.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 5000,
        disposition: 'attachment',
      },
    ]);
    expect(await db.storedEmailFile(as(people.vera), org, started.id, 1)).toEqual({
      sentFile: { position: 1, fileName: 'load.jpg', fileKey: `sent/${started.id}/1-${sha(2)}` },
    });
    // A sent email has no original, and no file at a position not listed.
    expect(await db.storedEmailFile(as(people.vera), org, started.id, null)).toBeNull();
    expect(await db.storedEmailFile(as(people.vera), org, started.id, 2)).toBeNull();
  });

  it('keeps nothing when a file is refused by the database', async () => {
    const key = id();
    await expect(start(key, [{ ...ticket, contentType: 'text/html' }])).rejects.toMatchObject({
      code: '23514',
    });
    await expect(start(key, [{ ...ticket, position: 1 }])).rejects.toMatchObject({
      code: '23514',
    });
    const [row] = await admin<{ n: number }[]>`
      select count(*)::int as n from app.emails where message_id = ${`gss-${key}`}`;
    expect(row?.n).toBe(0);
  });

  it('a retry of the same key answers the earlier email, its files not listed twice', async () => {
    const key = id();
    const first = await start(key);
    const second = await start(key);
    expect(second.status).toBe('already_started');
    if (first.status !== 'started') return;
    const [row] = await admin<{ n: number }[]>`
      select count(*)::int as n from app.email_attachments where email_id = ${first.id}`;
    expect(row?.n).toBe(2);
  });

  // D1-02: the Worker deployed before the migration calls the 13-argument function exactly as
  // it did; with both versions present the call is not ambiguous.
  it('still answers the 13-argument call of the Worker before this step', async () => {
    const api = postgres(API_URL, { max: 1, onnotice: () => undefined, fetch_types: false });
    try {
      const [row] = await api.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${people.tom}, true)`;
        return tx<{ result: { status: string; id?: string } }[]>`
          select app.start_outgoing_email(
            ${org}, ${company}, ${null}, ${'tom'}, ${'gss.example.test'},
            array(select t.x from jsonb_array_elements_text(${tx.json(['pat@buyer.example.test'])}::jsonb)
                    with ordinality t(x, n) order by t.n),
            array(select t.x from jsonb_array_elements_text(${tx.json([])}::jsonb)
                    with ordinality t(x, n) order by t.n),
            ${'Synthetic subject'}, ${'Synthetic body.'},
            ${`gss-${id()}`}, ${null}::uuid, ${null}::uuid, ${null}::uuid) as result`;
      });
      expect(row?.result.status).toBe('started');
    } finally {
      await api.end();
    }
  });
});
