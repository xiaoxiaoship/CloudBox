import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestServer } from '../helpers/testServer.ts';

const ipsPolicy = JSON.stringify({
  rules: [{ feature: 'ips', scope: 'ip', config: { recordValue: 2 } }],
  savedRules: [],
  ipBan: { threshold: 5, minutes: 30 },
  accountBan: { threshold: 5, minutes: 30 },
});

describe('IPS middleware', () => {
  it('拦截 SQL 注入并写入安全封禁与审计', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.policy', ipsPolicy, null);
      const response = await server.client.request("/?id=1'%20UNION%20SELECT%201,2,3%20--", { method: 'GET' });
      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { message?: string }).message, '⚠️ 检测到恶意攻击请求，本次请求已被拦截');
      assert.equal(server.services.securityPolicy.listActive().length, 0);
      assert.equal(server.services.securityPolicy.listCounts().find((entry) => entry.feature === 'ips')?.count, 2);
      const audit = server.services.audit.list({ limit: 20 }).find((entry) => entry.action === 'security.ips.block');
      assert.ok(audit);
      assert.equal(audit.result, 'denied');
      assert.equal(audit.ip, '127.0.0.1');
    } finally {
      await server.close();
    }
  });

  it('拦截 XSS', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.policy', ipsPolicy, null);
      const response = await server.client.request('/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E', { method: 'GET' });
      assert.equal(response.status, 403);
    } finally {
      await server.close();
    }
  });

  it('正常上传和普通文本搜索不触发 IPS', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.policy', ipsPolicy, null);
      const upload = await server.client.upload('contains-script.txt', Buffer.from('<script>alert(1)</script>'));
      assert.equal(upload.status, 201);
      const search = await server.client.request('/api/files?path=hello', { method: 'GET' });
      assert.notEqual(search.status, 403);
      assert.equal(server.services.securityPolicy.listActive().length, 0);
    } finally {
      await server.close();
    }
  });
});
