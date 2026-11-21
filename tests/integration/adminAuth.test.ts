import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createAdminApp } from '../../src/admin-server/app.ts';
import { AdminSessionRepository } from '../../src/core/db/repositories/adminSessionRepo.ts';
import { AdminAuthService } from '../../src/core/services/admin/adminAuthService.ts';
import { AdminUserService } from '../../src/core/services/admin/adminUserService.ts';
import { InitTokenService } from '../../src/server-entry/initToken.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

async function startAdmin(t: TestServer, tokenService: InitTokenService, auth: AdminAuthService) {
  const app = createAdminApp({
    services: t.services,
    version: '1.0.2-test',
    adminAuth: auth,
    initToken: tokenService,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

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
  const sessions = new AdminSessionRepository(t.services.db);
  const auth = new AdminAuthService({
    users: t.services.users,
    sessions,
    adminUsers,
    settings: t.services.settings,
    audit: t.services.audit,
  });
  return { auth, adminUsers, sessions };
}

describe('admin web authentication', () => {
  let t: TestServer | null = null;
  let server: import('node:http').Server | null = null;

  async function setup() {
    t = await createTestServer();
    const { auth } = adminServices(t);
    const tokenService = new InitTokenService(t.dataDir);
    const init = tokenService.ensure(true, 1250);
    assert.equal(init.required, true);
    assert.ok(init.token);
    const started = await startAdmin(t, tokenService, auth);
    server = started.server;
    return { ...started, auth, token: init.token!, tokenService };
  }

  async function close() {
    await new Promise<void>((resolve) => {
      if (server === null) { resolve(); return; }
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    server = null;
    await t?.close();
    t = null;
  }

  it('prints a setup URL once and consumes the token after creating the admin', async () => {
    const ctx = await setup();
    try {
      const status = await fetch(`${ctx.baseUrl}/api/admin/auth/status`);
      assert.equal(status.status, 200);
      const statusBody = (await status.json()) as { needsSetup: boolean; csrfToken: string };
      assert.equal(statusBody.needsSetup, true);
      assert.ok(statusBody.csrfToken);

      const response = await fetch(`${ctx.baseUrl}/api/admin/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: ctx.token, username: 'webadmin', password: 'Passw0rd!' }),
      });
      assert.equal(response.status, 201);
      assert.match(response.headers.get('set-cookie') ?? '', /admin_sid=/);
      const body = (await response.json()) as { user: { username: string; role: string } };
      assert.equal(body.user.username, 'webadmin');
      assert.equal(body.user.role, 'admin');
      assert.equal(ctx.tokenService.verify(ctx.token), false);
    } finally {
      await close();
    }
  });

  it('supports independent login session and CSRF logout', async () => {
    const ctx = await setup();
    try {
      const setupResponse = await fetch(`${ctx.baseUrl}/api/admin/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: ctx.token, username: 'webadmin', password: 'Passw0rd!' }),
      });
      assert.equal(setupResponse.status, 201);

      const login = await fetch(`${ctx.baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'webadmin', password: 'Passw0rd!' }),
      });
      assert.equal(login.status, 200);
      const cookies = (login.headers.get('set-cookie') ?? '')
        .split(/,(?=\s*[^;]+=)/)
        .map((part) => part.split(';')[0]!.trim())
        .filter(Boolean);
      const cookieHeader = cookies.join('; ');
      const csrf = cookies.find((part) => part.startsWith('admin_csrf='))?.split('=')[1] ?? '';
      assert.ok(csrf);

      const me = await fetch(`${ctx.baseUrl}/api/admin/auth/me`, { headers: { cookie: cookieHeader } });
      assert.equal(me.status, 200);

      const deniedLogout = await fetch(`${ctx.baseUrl}/api/admin/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookieHeader },
      });
      assert.equal(deniedLogout.status, 403);

      const logout = await fetch(`${ctx.baseUrl}/api/admin/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookieHeader, 'x-csrf-token': csrf },
      });
      assert.equal(logout.status, 204);
    } finally {
      await close();
    }
  });

  it('rejects invalid setup token and non-admin login', async () => {
    const ctx = await setup();
    try {
      const invalid = await fetch(`${ctx.baseUrl}/api/admin/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'wrong-token', username: 'webadmin', password: 'Passw0rd!' }),
      });
      assert.equal(invalid.status, 403);

      const login = await fetch(`${ctx.baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'Passw0rd!' }),
      });
      assert.equal(login.status, 401);
    } finally {
      await close();
    }
  });
});
