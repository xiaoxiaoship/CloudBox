import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { createAdminApp } from '../../src/admin-server/app.ts';
import { AdminSessionRepository } from '../../src/core/db/repositories/adminSessionRepo.ts';
import { AdminAuthService } from '../../src/core/services/admin/adminAuthService.ts';
import { AdminUserService } from '../../src/core/services/admin/adminUserService.ts';
import { InitTokenService } from '../../src/server-entry/initToken.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

function adminServices(t: TestServer) {
  const adminUsers = new AdminUserService({
    db: t.services.db,
    users: t.services.users,
    quotas: t.services.quotas,
    sessions: t.services.sessions,
    auth: t.services.auth,
    audit: t.services.audit,
    settings: t.services.settings,
    loginIps: t.services.loginIps,
    storageRoot: t.storageRoot,
  });
  const auth = new AdminAuthService({
    users: t.services.users,
    sessions: new AdminSessionRepository(t.services.db),
    adminUsers,
    settings: t.services.settings,
    audit: t.services.audit,
  });
  return { adminUsers, auth };
}

function cookieHeader(response: Response): { cookie: string; csrf: string } {
  const raw = (response.headers.get('set-cookie') ?? '')
    .split(/,(?=\s*[^;]+=)/)
    .map((part) => part.split(';')[0]!.trim())
    .filter(Boolean);
  return {
    cookie: raw.join('; '),
    csrf: raw.find((part) => part.startsWith('admin_csrf='))?.split('=')[1] ?? '',
  };
}

describe('admin web management routes', () => {
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

  it('serves users and settings only after setup and passes CSRF', async () => {
    t = await createTestServer({ securityMode: 'advanced' });
    const { adminUsers, auth } = adminServices(t);
    const tokenService = new InitTokenService(t.dataDir);
    const token = tokenService.ensure(true, 1250).token!;
    const app = createAdminApp({
      services: t.services,
      version: '1.0.2-test',
      adminAuth: auth,
      adminUsers,
      initToken: tokenService,
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const setup = await fetch(`${base}/api/admin/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, username: 'webadmin', password: 'Passw0rd!' }),
    });
    assert.equal(setup.status, 201);
    const { cookie, csrf } = cookieHeader(setup);

    const unauthorized = await fetch(`${base}/api/admin/users`);
    assert.equal(unauthorized.status, 401);

    const users = await fetch(`${base}/api/admin/users`, { headers: { cookie } });
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(await users.json()));

    const settings = await fetch(`${base}/api/admin/settings`, { headers: { cookie } });
    assert.equal(settings.status, 200);
    assert.equal((await settings.json() as { security: { mode: string } }).security.mode, 'advanced');

    const create = await fetch(`${base}/api/admin/users`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ username: 'bob', password: 'Passw0rd!', quotaBytes: 1024 }),
    });
    assert.equal(create.status, 201);
  });
});
