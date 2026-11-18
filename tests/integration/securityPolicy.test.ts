import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestServer } from '../helpers/testServer.ts';

describe('security policy executor', () => {
  it('登录失败达到 IP 阈值后写入策略封禁并可解除', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.capEnabled', false, null);
      server.services.settings.set(
        'security.policy',
        JSON.stringify({ rules: [{ feature: 'loginFailure', scope: 'ip', config: { windowMinutes: 15, threshold: 1, banMinutes: 1 } }], ipBan: { threshold: 10, minutes: 30 }, accountBan: { threshold: 10, minutes: 30 } }),
        null,
      );
      const first = await server.client.request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
      }, { csrf: false });
      assert.equal(first.status, 401);
      const second = await server.client.request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
      }, { csrf: false });
      assert.equal(second.status, 403);
      assert.equal((await second.json() as { action?: string }).action, 'security_banned');
      const ban = server.services.securityPolicy.listActive()[0];
      assert.ok(ban);
      server.services.securityPolicy.clear(ban.id);
      assert.equal(server.services.securityPolicy.listActive().length, 0);
    } finally {
      await server.close();
    }
  });

  it('达到全局阈值后清除功能封禁，只保留目标级封禁', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set(
        'security.policy',
        JSON.stringify({ rules: [], ipBan: { threshold: 2, minutes: 30 }, accountBan: { threshold: 10, minutes: 30 } }),
        null,
      );
      server.services.securityPolicy.ban('ip', '1.2.3.4', 'loginFailure', 1);
      server.services.securityPolicy.ban('ip', '1.2.3.4', 'registrationLimit', 1);
      const active = server.services.securityPolicy.listActive();
      assert.equal(active.length, 1);
      assert.equal(active[0]?.feature, 'global');
    } finally {
      await server.close();
    }
  });

  it('解除全局封禁后清空旧计数，不会因一次失败再次触发', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.capEnabled', false, null);
      server.services.settings.set(
        'security.policy',
        JSON.stringify({ rules: [{ feature: 'loginFailure', scope: 'ip', config: { windowMinutes: 15, threshold: 1, banMinutes: 1 } }], ipBan: { threshold: 1, minutes: 30 }, accountBan: { threshold: 10, minutes: 30 } }),
        null,
      );
      const first = await server.client.request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
      }, { csrf: false });
      assert.equal(first.status, 401);
      const second = await server.client.request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
      }, { csrf: false });
      assert.equal(second.status, 403);
      const global = server.services.securityPolicy.listActive()[0];
      assert.equal(global?.feature, 'global');
      server.services.securityPolicy.clear(global.id);
      assert.ok(server.services.securityPolicy.resetAt('ip', '127.0.0.1') > 0);
      const after = await server.client.request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
      }, { csrf: false });
      assert.equal(after.status, 401);
    } finally {
      await server.close();
    }
  });

  it('功能封禁不阻断已登录操作，全局账户封禁阻断所有 API', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.securityPolicy.ban('account', String(server.user.id), 'loginFailure', 1);
      assert.equal((await server.client.request('/api/auth/me')).status, 200);
      server.services.securityPolicy.ban('account', String(server.user.id), 'global', 1);
      const blocked = await server.client.request('/api/auth/me');
      assert.equal(blocked.status, 403);
      assert.equal((await blocked.json() as { action?: string }).action, 'security_banned');
    } finally {
      await server.close();
    }
  });

  it('IP 全局封禁阻断所有 API', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.securityPolicy.ban('ip', '127.0.0.1', 'global', 1);
      const blocked = await server.client.request('/api/public/settings');
      assert.equal(blocked.status, 403);
    } finally {
      await server.close();
    }
  });

  it('解除功能封禁后同样清零旧计数', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.capEnabled', false, null);
      server.services.settings.set(
        'security.policy',
        JSON.stringify({ rules: [{ feature: 'loginFailure', scope: 'ip', config: { windowMinutes: 15, threshold: 1, banMinutes: 1 } }], ipBan: { threshold: 10, minutes: 30 }, accountBan: { threshold: 10, minutes: 30 } }),
        null,
      );
      const bad = async () => server.client.request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
      }, { csrf: false });
      assert.equal((await bad()).status, 401);
      assert.equal((await bad()).status, 403);
      const ban = server.services.securityPolicy.listActive()[0];
      assert.equal(ban?.feature, 'loginFailure');
      server.services.securityPolicy.clear(ban.id);
      assert.ok(server.services.securityPolicy.resetAt('ip', '127.0.0.1') > 0);
      assert.equal((await bad()).status, 401);
    } finally {
      await server.close();
    }
  });

  it('IP 黑名单拦截，白名单跳过全局 IP 封禁', async () => {
    const denied = await createTestServer();
    try {
      denied.services.settings.set('security.mode', 'advanced', null);
      denied.services.settings.set('security.policy', JSON.stringify({ rules: [], ipBan: { threshold: 5, minutes: 30 }, accountBan: { threshold: 5, minutes: 30 }, accessLists: { ipAllow: [], ipDeny: ['127.0.0.1'], accountAllow: [], accountDeny: [] } }), null);
      assert.equal((await denied.client.request('/api/auth/me')).status, 403);
    } finally { await denied.close(); }
    const allowed = await createTestServer();
    try {
      allowed.services.settings.set('security.mode', 'advanced', null);
      allowed.services.settings.set('security.policy', JSON.stringify({ rules: [], ipBan: { threshold: 5, minutes: 30 }, accountBan: { threshold: 5, minutes: 30 }, accessLists: { ipAllow: ['127.0.0.1'], ipDeny: [], accountAllow: [], accountDeny: [] } }), null);
      allowed.services.securityPolicy.ban('ip', '127.0.0.1', 'global', 30);
      assert.equal((await allowed.client.request('/api/auth/me')).status, 200);
    } finally { await allowed.close(); }
  });

  it('账户白名单跳过账户全局封禁并可正常登录', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.policy', JSON.stringify({ rules: [], ipBan: { threshold: 5, minutes: 30 }, accountBan: { threshold: 5, minutes: 30 }, accessLists: { ipAllow: [], ipDeny: [], accountAllow: ['alice'], accountDeny: [] } }), null);
      const admin = server.services.users.findByUsername('alice');
      assert.ok(admin);
      server.services.securityPolicy.ban('account', String(admin.id), 'global', 30);
      assert.equal((await server.client.request('/api/auth/me')).status, 200);
      const login = await server.client.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'Passw0rd!' }) }, { csrf: false });
      assert.equal(login.status, 200);
    } finally { await server.close(); }
  });

  it('API 泛洪按窗口计数并排除 /api/auth/me', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.policy', JSON.stringify({ rules: [{ feature: 'apiFlood', scope: 'ip', config: { windowMinutes: 1, threshold: 1, recordValue: 2 } }], ipBan: { threshold: 5, minutes: 30 }, accountBan: { threshold: 5, minutes: 30 } }), null);
      await server.client.request('/api/files');
      await server.client.request('/api/files');
      const counts = server.services.securityPolicy.listCounts();
      assert.equal(counts.find((entry) => entry.feature === 'apiFlood')?.count, 2);
      const before = server.services.securityPolicy.totalCount();
      await server.client.request('/api/auth/me');
      assert.equal(server.services.securityPolicy.totalCount(), before);
    } finally { await server.close(); }
  });

  it('本地 DDoS 模拟：全局 API 泛洪达到阈值后触发全局保护', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.policy', JSON.stringify({ rules: [{ feature: 'apiFlood', scope: 'global', config: { windowMinutes: 1, threshold: 5, recordValue: 2 } }], ipBan: { threshold: 10, minutes: 30 }, accountBan: { threshold: 10, minutes: 30 }, globalBan: { threshold: 2, recoveryMinutes: 0 } }), null);
      let triggered = 0;
      server.services.securityPolicy.onGlobalLimit = () => { triggered += 1; };
      for (let i = 0; i < 12; i += 1) await server.client.request('/api/files');
      const count = server.services.securityPolicy.listCounts().find((entry) => entry.feature === 'apiFlood');
      assert.equal(count?.count, 2);
      assert.equal(triggered, 1);
    } finally { await server.close(); }
  });
});
