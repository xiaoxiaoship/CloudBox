import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

async function register(
  server: TestServer,
  username: string,
  forwardedFor: string,
): Promise<Response> {
  return fetch(`${server.client.baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': forwardedFor,
    },
    body: JSON.stringify({ username, password: 'Passw0rd!' }),
  });
}

describe('trust proxy + rate limit IP', () => {
  let server: TestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('默认关闭：忽略 X-Forwarded-For，所有请求共享 127.0.0.1 限流', async () => {
    server = await createTestServer({
      trustProxy: false,
      allowPublicRegistration: true,
    });

    assert.equal((await register(server, 'sharedone', '1.2.3.4')).status, 201);
    assert.equal((await register(server, 'sharedtwo', '1.2.3.4')).status, 201);
    const third = await register(server, 'sharedthree', '5.6.7.8');
    assert.equal(third.status, 429);
    assert.equal(server.services.users.findByUsername('sharedthree'), null);
  });

  it('开启后：按 X-Forwarded-For 独立计数', async () => {
    server = await createTestServer({
      trustProxy: true,
      allowPublicRegistration: true,
    });

    assert.equal((await register(server, 'proxiedone', '1.2.3.4')).status, 201);
    assert.equal((await register(server, 'proxiedtwo', '1.2.3.4')).status, 201);
    assert.equal((await register(server, 'proxiedthree', '1.2.3.4')).status, 429);

    // 不同转发 IP 拥有独立额度，不受 1.2.3.4 已耗尽的影响
    assert.equal((await register(server, 'otherone', '5.6.7.8')).status, 201);
    assert.notEqual(server.services.users.findByUsername('otherone'), null);
  });
});
