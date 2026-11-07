import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createTestServer, TestClient, type TestServer } from '../helpers/testServer.ts';

const VALID_PASSWORD = 'Passw0rd!';

async function publicSettings(baseUrl: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}/api/public/settings`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { allow_public_registration: boolean };
  return body.allow_public_registration;
}

async function register(
  baseUrl: string,
  username: string,
  password = VALID_PASSWORD,
): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

describe('public registration', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await createTestServer();
  });

  afterEach(async () => {
    await t.close();
  });

  it('默认关闭：公开配置为 false，注册返回 403', async () => {
    assert.equal(await publicSettings(t.client.baseUrl), false);

    const response = await register(t.client.baseUrl, 'newuser');
    assert.equal(response.status, 403);
    const body = (await response.json()) as { code: string };
    assert.equal(body.code, 'REGISTRATION_DISABLED');
    assert.equal(t.services.users.findByUsername('newuser'), null);
  });

  it('开启后注册成功，可立即登录并上传文件', async () => {
    t.services.settings.set('allow_public_registration', true, null);
    assert.equal(await publicSettings(t.client.baseUrl), true);

    const response = await register(t.client.baseUrl, 'newuser');
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      user: { username: string; role: string; status: string };
    };
    assert.equal(body.user.username, 'newuser');
    assert.equal(body.user.role, 'user');
    assert.equal(body.user.status, 'active');

    const record = t.services.users.findByUsername('newuser');
    assert.ok(record);
    assert.equal(record.role, 'user');
    assert.equal(record.status, 'active');
    assert.match(record.passwordHash, /^scrypt\$/);
    const quota = t.services.quotas.get(record.id);
    assert.equal(quota?.quotaBytes, 5 * 1024 ** 3);
    assert.ok(existsSync(path.join(t.storageRoot, record.storageKey)));

    const client = new TestClient(t.client.baseUrl);
    await client.login('newuser', VALID_PASSWORD);
    const uploaded = await client.upload('first.txt', Buffer.from('registered user upload'));
    assert.equal(uploaded.status, 201);
  });

  it('用户名 3-20 位字母数字，密码至少 8 位', async () => {
    t.services.settings.set('allow_public_registration', true, null);

    for (const username of ['ab', 'a'.repeat(21), 'user_name', '中文用户']) {
      assert.equal((await register(t.client.baseUrl, username)).status, 400, username);
    }
    assert.equal((await register(t.client.baseUrl, 'validuser', 'short')).status, 400);
  });

  it('重复用户名返回 409', async () => {
    t.services.settings.set('allow_public_registration', true, null);

    assert.equal((await register(t.client.baseUrl, 'newuser')).status, 201);
    const duplicate = await register(t.client.baseUrl, 'newuser');
    assert.equal(duplicate.status, 409);
    assert.equal(
      ((await duplicate.json()) as { code: string }).code,
      'REGISTRATION_USERNAME_TAKEN',
    );
  });

  it('每 IP 每小时最多 2 次成功注册，第三次 429 且不产生账号', async () => {
    t.services.settings.set('allow_public_registration', true, null);

    assert.equal((await register(t.client.baseUrl, 'firstuser')).status, 201);
    assert.equal((await register(t.client.baseUrl, 'seconduser')).status, 201);

    const before = t.services.users.list().length;
    const third = await register(t.client.baseUrl, 'thirduser');
    assert.equal(third.status, 429);
    assert.equal(((await third.json()) as { code: string }).code, 'RATE_LIMITED');
    assert.equal(t.services.users.list().length, before);
    assert.equal(t.services.users.findByUsername('thirduser'), null);
  });
});
