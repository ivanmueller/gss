import { describe, expect, it } from 'vitest';

import { connectionOptions } from './db';

describe('connectionOptions', () => {
  it('requires verified TLS for a remote database', () => {
    expect(connectionOptions('postgresql://u:p@db.example.test:6543/postgres').ssl).toBe(
      'verify-full',
    );
  });

  it('uses no TLS for a local database or for Hyperdrive, which makes the verified connection', () => {
    expect(connectionOptions('postgresql://u:p@127.0.0.1:54322/postgres').ssl).toBe(false);
    expect(connectionOptions('postgresql://u:p@abc.hyperdrive.local:5432/postgres', true).ssl).toBe(
      false,
    );
  });

  it('never uses prepared statements and keeps one connection', () => {
    expect(connectionOptions('postgresql://u:p@db.example.test:6543/postgres')).toMatchObject({
      prepare: false,
      max: 1,
    });
  });
});
