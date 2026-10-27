import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase } from '../src/db';

// A fake database at a non-local address (127.0.0.2) that agrees to TLS and presents a
// self-signed certificate for another host name. A client that verifies the server
// must refuse it before sending anything over the encrypted channel.
let server: Server;
let port = 0;
let startupMessages = 0;
let onStartup: () => void = () => undefined;
let dir = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gss-tls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=impostor.example.test',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const key = readFileSync(join(dir, 'key.pem'));
  const cert = readFileSync(join(dir, 'cert.pem'));
  server = createServer((socket) => {
    socket.once('data', () => {
      // The client's SSLRequest: answer "S" (TLS accepted), then switch to TLS.
      socket.write('S');
      const secure = new TLSSocket(socket, { isServer: true, key, cert });
      secure.on('data', () => {
        // Anything here (the startup message, with the user name) means the client
        // accepted the impostor's certificate.
        startupMessages += 1;
        onStartup();
        secure.destroy();
      });
      secure.on('error', () => undefined);
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.2', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe('postgresDatabase TLS', () => {
  it('refuses a remote server whose certificate it cannot verify', async () => {
    const db = postgresDatabase(
      `postgresql://app_api:synthetic-password@127.0.0.2:${String(port)}/postgres`,
    );
    const accepted = new Promise<'accepted'>((resolve) => {
      onStartup = () => {
        resolve('accepted');
      };
    });
    try {
      const outcome = await Promise.race([
        db.memberships('00000000-0000-4000-8000-00000000a11c').then(
          () => 'answered',
          () => 'refused',
        ),
        accepted,
      ]);
      expect(outcome).toBe('refused');
      expect(startupMessages).toBe(0);
    } finally {
      await db.close();
    }
  });
});
