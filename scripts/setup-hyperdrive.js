// Creates or updates the Cloudflare Hyperdrive configuration the staging Worker uses to
// reach Supabase, with Supabase's CA certificate so the database's certificate is
// verified. Run by .github/workflows/hyperdrive-staging.yml; prints no secrets.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SUPABASE_HYPERDRIVE_URL
// (postgresql://app_api.<project-ref>:<password>@<pooler-host>:5432/postgres).
import { appendFileSync, readFileSync } from 'node:fs';

const CONFIG_NAME = 'gss-staging';
const CA_NAME = 'supabase-root-2021-ca';
const CA_FILE = new URL('../supabase/certs/supabase-root-2021-ca.crt', import.meta.url);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const token = required('CLOUDFLARE_API_TOKEN');
const account = required('CLOUDFLARE_ACCOUNT_ID');
// CLOUDFLARE_API_BASE only for trying the script against a stand-in API.
const apiBase = process.env.CLOUDFLARE_API_BASE ?? 'https://api.cloudflare.com/client/v4';
const base = `${apiBase}/accounts/${account}`;

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const messages = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
    const error = new Error(
      `${method} ${path} failed (${res.status}): ${messages || 'no details'}`,
    );
    error.status = res.status;
    throw error;
  }
  return json.result;
}

function origin() {
  let url;
  try {
    url = new URL(required('SUPABASE_HYPERDRIVE_URL'));
  } catch {
    // Never echo the value: it holds the password.
    throw new Error('SUPABASE_HYPERDRIVE_URL is not a valid postgresql:// URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password) {
    throw new Error(
      'SUPABASE_HYPERDRIVE_URL must be postgresql://user:password@host:port/database.',
    );
  }
  return {
    scheme: 'postgres',
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

async function ensureCa() {
  const existing = (await api('GET', '/mtls_certificates')).find(
    (cert) => cert.name === CA_NAME && cert.ca,
  );
  if (existing) return existing.id;
  const created = await api('POST', '/mtls_certificates', {
    name: CA_NAME,
    ca: true,
    certificates: readFileSync(CA_FILE, 'utf8'),
  });
  return created.id;
}

async function main() {
  const target = origin();
  const caId = await ensureCa();
  console.log(`CA certificate ${CA_NAME}: ${caId}`);

  const existing = (await api('GET', '/hyperdrive/configs')).find((c) => c.name === CONFIG_NAME);
  let config;
  let sslmode;
  // verify-full also checks the host name; verify-ca only that Supabase's CA signed it.
  for (sslmode of ['verify-full', 'verify-ca']) {
    const body = {
      name: CONFIG_NAME,
      origin: target,
      mtls: { ca_certificate_id: caId, sslmode },
      // Never cache: the API's queries return different rows per user (row level security
      // keyed on app.user_id), so a cached result could reach the wrong user.
      caching: { disabled: true },
    };
    try {
      config = existing
        ? await api('PUT', `/hyperdrive/configs/${existing.id}`, body)
        : await api('POST', '/hyperdrive/configs', body);
      break;
    } catch (error) {
      console.log(`With sslmode ${sslmode}: ${error.message}`);
      if (sslmode === 'verify-ca') throw error;
    }
  }

  const summary = [
    '### Hyperdrive for staging',
    '',
    `- Configuration: \`${CONFIG_NAME}\``,
    `- ID: \`${config.id}\``,
    `- Database host: \`${target.host}:${String(target.port)}\` as \`${target.user}\``,
    `- TLS: \`${sslmode}\` with \`${CA_NAME}\``,
    '- Query caching: off',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
