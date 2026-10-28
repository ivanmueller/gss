import { VERSION } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of member management: the real driver, as `app_api`, against the real
// migrations, row level security, functions and triggers. Fixtures are synthetic.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { adam: id(), olivia: id(), newbie: id(), bob: id() };
const orgs = { a: id(), b: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
const email = (name: keyof typeof users) => `${name}-${users[name]}@example.test`;

let db: Database;

beforeAll(async () => {
  for (const name of Object.keys(users) as (keyof typeof users)[]) {
    await admin`insert into auth.users (id, email) values (${users[name]}, ${email(name)})`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, 'Synthetic Org A'), (${orgs.b}, 'Synthetic Org B')`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.adam}, 'org_admin', 'active', now()),
    (${orgs.a}, ${users.olivia}, 'operations', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  const both = admin([orgs.a, orgs.b]);
  await admin`delete from app.organization_members where organization_id in ${both}`;
  await admin`delete from app.audit_events where organization_id in ${both}`;
  await admin`delete from app.organizations where id in ${both}`;
  await admin`delete from auth.users where id in ${admin(Object.values(users))}`;
  await admin.end();
});

describe('member management as app_api', () => {
  it('lists the team with emails for admins only', async () => {
    const members = await db.listMembers(as(users.adam), orgs.a);
    expect(members?.map((m) => [m.email, m.role, m.isYou])).toEqual([
      [email('adam'), 'org_admin', true],
      [email('olivia'), 'operations', false],
    ]);
    expect(members?.[0]?.version).toMatch(VERSION);
    expect(await db.listMembers(as(users.olivia), orgs.a)).toBeNull();
    expect(await db.listMembers(as(users.bob), orgs.a)).toBeNull();
  });

  it('adds a person with a login, once, for admins only', async () => {
    expect(await db.addMember(as(users.olivia), orgs.a, email('newbie'), 'viewer')).toEqual({
      status: 'forbidden',
    });
    expect(await db.addMember(as(users.bob), orgs.a, email('newbie'), 'viewer')).toEqual({
      status: 'forbidden',
    });
    expect(await db.addMember(as(users.adam), orgs.a, 'nobody@example.test', 'viewer')).toEqual({
      status: 'no_account',
    });
    const added = await db.addMember(
      as(users.adam),
      orgs.a,
      email('newbie').toUpperCase(),
      'viewer',
    );
    expect(added.status).toBe('added');
    expect(await db.addMember(as(users.adam), orgs.a, email('newbie'), 'trader')).toEqual({
      status: 'already_member',
    });
  });

  it('changes roles, statuses and names, refusing stale versions and own changes', async () => {
    const find = async (name: keyof typeof users) => {
      const member = (await db.listMembers(as(users.adam), orgs.a))?.find(
        (m) => m.userId === users[name],
      );
      if (!member) throw new Error('member missing');
      return member;
    };
    const newbie = await find('newbie');
    const ctx = as(users.adam);
    expect(
      await db.updateMember(ctx, orgs.a, newbie.id, newbie.version, {
        role: 'trader',
        firstName: 'New',
        lastName: 'Synthetic',
      }),
    ).toEqual({ status: 'saved' });
    expect(await find('newbie')).toMatchObject({
      role: 'trader',
      firstName: 'New',
      lastName: 'Synthetic',
    });
    expect(
      await db.updateMember(ctx, orgs.a, newbie.id, newbie.version, { status: 'suspended' }),
    ).toEqual({ status: 'changed' });

    const updated = await find('newbie');
    expect(
      await db.updateMember(ctx, orgs.a, updated.id, updated.version, { lastName: null }),
    ).toEqual({ status: 'saved' });
    expect(await find('newbie')).toMatchObject({ firstName: 'New', lastName: null });

    const self = await find('adam');
    expect(await db.updateMember(ctx, orgs.a, self.id, self.version, { role: 'viewer' })).toEqual({
      status: 'self',
    });
    expect(
      await db.updateMember(ctx, orgs.a, self.id, self.version, { firstName: 'Adam' }),
    ).toEqual({ status: 'saved' });

    expect(
      await db.updateMember(as(users.olivia), orgs.a, newbie.id, newbie.version, {
        role: 'org_admin',
      }),
    ).toEqual({ status: 'forbidden' });
    expect(
      await db.updateMember(as(users.bob), orgs.a, newbie.id, newbie.version, { role: 'viewer' }),
    ).toEqual({ status: 'forbidden' });
    const bobsMember = (await db.listMembers(as(users.bob), orgs.b))?.[0];
    if (!bobsMember) throw new Error('fixture missing');
    expect(
      await db.updateMember(ctx, orgs.a, bobsMember.id, bobsMember.version, { role: 'viewer' }),
    ).toEqual({ status: 'not_found' });

    const audit = await admin<{ entity: string }[]>`
      select entity from app.audit_events where organization_id = ${orgs.a} and actor_id = ${users.adam}
      order by id`;
    expect(audit.map((row) => row.entity)).toEqual([
      'organization_members',
      'organization_members',
      'member_names',
      'member_names',
      'member_names',
    ]);
  });

  it('keeps an active admin: the second admin cannot demote the first when alone', async () => {
    const olivia = (await db.listMembers(as(users.adam), orgs.a))?.find(
      (m) => m.userId === users.olivia,
    );
    if (!olivia) throw new Error('fixture missing');
    expect(
      await db.updateMember(as(users.adam), orgs.a, olivia.id, olivia.version, {
        role: 'org_admin',
      }),
    ).toEqual({ status: 'saved' });
    const adam = (await db.listMembers(as(users.olivia), orgs.a))?.find(
      (m) => m.userId === users.adam,
    );
    if (!adam) throw new Error('fixture missing');
    expect(
      await db.updateMember(as(users.olivia), orgs.a, adam.id, adam.version, {
        status: 'suspended',
      }),
    ).toEqual({ status: 'saved' });
    // Olivia is now the only active admin; suspended Adam can do nothing.
    expect(await db.listMembers(as(users.adam), orgs.a)).toBeNull();
    const self = (await db.listMembers(as(users.olivia), orgs.a))?.find(
      (m) => m.userId === users.olivia,
    );
    if (!self) throw new Error('fixture missing');
    expect(
      await db.updateMember(as(users.olivia), orgs.a, self.id, self.version, { role: 'viewer' }),
    ).toEqual({ status: 'self' });
  });
});
