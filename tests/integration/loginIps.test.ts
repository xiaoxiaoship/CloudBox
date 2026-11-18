import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestServer } from '../helpers/testServer.ts';

describe('login IP history', () => {
  it('成功登录会记录 IP，管理端可读取', async () => {
    const server = await createTestServer();
    try {
      const history = server.services.loginIps.listForUser(server.user.id);
      assert.ok(history.length >= 1);
      assert.equal(history[0]?.ip, '127.0.0.1');
    } finally {
      await server.close();
    }
  });
});
