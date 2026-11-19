// Tests of scripts/setup-hyperdrive.js against a stand-in Cloudflare API (F-247-1-R12-01): each
// Hyperdrive configuration is only ever pointed at its own Supabase project. Synthetic passwords.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./setup-hyperdrive.js', import.meta.url));
const PETRO = 'petro_api.ubgyatbzjctsgzcsvwgc';
const POOLER = 'aws-1-us-east-2.pooler.supabase.com';

let server;
let apiBase;
let calls = [];

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body });
      const result = req.method === 'GET' ? [] : { id: 'made-up-id' };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, result }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  apiBase = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function run(target, url) {
  calls = [];
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    CLOUDFLARE_API_TOKEN: 'made-up-token',
    CLOUDFLARE_ACCOUNT_ID: 'made-up-account',
    CLOUDFLARE_API_BASE: apiBase,
    HYPERDRIVE_TARGET: target,
    SUPABASE_HYPERDRIVE_URL: url,
  };
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, output: `${stdout}${stderr}` });
    });
  });
}

describe('setup-hyperdrive', () => {
  test('sets up the oil and gas configuration for petroleum-staging', async () => {
    const result = await run('petroleum', `postgresql://${PETRO}:made-up@${POOLER}:5432/postgres`);
    assert.equal(result.code, 0, result.output);
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/hyperdrive/configs'));
    const body = JSON.parse(created.body);
    assert.equal(body.name, 'gss-petroleum-staging');
    assert.deepEqual(
      { host: body.origin.host, user: body.origin.user, database: body.origin.database },
      { host: POOLER, user: PETRO, database: 'postgres' },
    );
    assert.equal(body.caching.disabled, true);
    assert.ok(!result.output.includes('made-up@'), 'the password is never printed');
  });

  const refused = [
    [
      'a petro_api login of another project',
      `postgresql://petro_api.otherprojectref:x@${POOLER}:5432/postgres`,
    ],
    [
      'another host',
      `postgresql://${PETRO}:x@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`,
    ],
    ['another database', `postgresql://${PETRO}:x@${POOLER}:5432/other`],
    ["grain's login", `postgresql://app_api.nfwizbcpjpqxdoojfbdr:x@${POOLER}:5432/postgres`],
    ['petro_api without a project', `postgresql://petro_api:x@${POOLER}:5432/postgres`],
  ];
  for (const [what, url] of refused) {
    test(`refuses ${what} for the oil and gas configuration, changing nothing`, async () => {
      const result = await run('petroleum', url);
      assert.equal(result.code, 1, result.output);
      assert.equal(calls.length, 0, 'no call to Cloudflare');
      assert.ok(!result.output.includes(':x@'), 'the URL is never printed');
    });
  }

  test("refuses the oil and gas login, or another project's, for grain's configuration", async () => {
    for (const user of [PETRO, 'app_api.otherprojectref']) {
      const result = await run('staging', `postgresql://${user}:x@${POOLER}:5432/postgres`);
      assert.equal(result.code, 1, result.output);
      assert.equal(calls.length, 0);
    }
  });

  test("sets up grain's configuration for gss-staging", async () => {
    const result = await run(
      'staging',
      `postgresql://app_api.nfwizbcpjpqxdoojfbdr:made-up@${POOLER}:6543/postgres`,
    );
    assert.equal(result.code, 0, result.output);
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/hyperdrive/configs'));
    const body = JSON.parse(created.body);
    assert.equal(body.name, 'gss-staging');
    assert.equal(body.origin.port, 5432, 'always the session pooler');
  });
});
