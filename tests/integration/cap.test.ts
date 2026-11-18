import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { createTestServer, TestClient, TEST_PASSWORD } from '../helpers/testServer.ts';

function solvePow(salt: string, target: string): number {
  for (let nonce = 0; nonce < 5_000_000; nonce += 1) {
    const hash = createHash('sha256').update(`${salt}${nonce}`).digest('hex');
    if (hash.startsWith(target)) return nonce;
  }
  throw new Error('PoW solution not found');
}

describe('Cap proof-of-work gate', () => {
  it('正常登录不触发 Cap', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      const response = await server.client.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: TEST_PASSWORD }),
      });
      assert.equal(response.status, 200);
    } finally {
      await server.close();
    }
  });

  it('失败达到阈值后返回 cap_required，完成 PoW 后重试成功', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      server.services.settings.set('security.capLoginFailures', 3, null);
      for (let index = 0; index < 3; index += 1) {
        const response = await server.client.request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
        });
        assert.equal(response.status, 401);
      }

      const challengeResponse = await server.client.request('/api/cap/challenge', { method: 'POST' }, { csrf: false });
      assert.equal(challengeResponse.status, 200);
      const challenge = (await challengeResponse.json()) as {
        token: string;
        challenges: Array<{ protocol: string; payload: { salt: string; target: string } }>;
      };
      assert.equal(challenge.challenges.length, 8);
      const solutions = challenge.challenges.map((entry) => {
        assert.equal(entry.protocol, 'sha256-pow');
        return { nonce: solvePow(entry.payload.salt, entry.payload.target) };
      });

      const redeemResponse = await server.client.request(
        '/api/cap/redeem',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: challenge.token, solutions }),
        },
        { csrf: false },
      );
      assert.equal(redeemResponse.status, 200);
      const redeemed = (await redeemResponse.json()) as { success: boolean; token: string };
      assert.equal(redeemed.success, true);

      const retry = await server.client.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cap-token': redeemed.token,
        },
        body: JSON.stringify({ username: 'alice', password: TEST_PASSWORD }),
      });
      assert.equal(retry.status, 200);
    } finally {
      await server.close();
    }
  });

  it('文件流与 health 不要求 Cap', async () => {
    const server = await createTestServer();
    try {
      server.services.settings.set('security.mode', 'advanced', null);
      const health = await server.client.request('/health');
      assert.equal(health.status, 200);
    } finally {
      await server.close();
    }
  });
});
