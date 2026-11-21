import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { createAdminApp } from '../../src/admin-server/app.ts';
import { isPrivateAddress } from '../../src/admin-server/middleware/intranetOnly.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

describe('admin web skeleton', () => {
  let t: TestServer | null = null;
  let server: import('node:http').Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === null) { resolve(); return; }
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    server = null;
    await t?.close();
    t = null;
  });

  it('serves an unauthenticated admin health endpoint', async () => {
    t = await createTestServer();
    const app = createAdminApp({ services: t.services, version: '1.0.2-test' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; service: string; version: string };
    assert.equal(body.ok, true);
    assert.equal(body.service, 'cloudbox-admin');
    assert.equal(body.version, '1.0.2-test');
  });

  it('classifies private and public addresses for intranet enforcement', () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '172.16.0.1', '192.168.1.10', 'fd00::1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.1', '2001:db8::1']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });
});
