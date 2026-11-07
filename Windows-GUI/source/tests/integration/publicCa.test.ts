import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

const FAKE_CA = '-----BEGIN CERTIFICATE-----\ncloudbox-test-ca\n-----END CERTIFICATE-----\n';

describe('GET /api/public/root-ca.crt', () => {
  let server: TestServer;
  let certDir: string;
  let certPath: string;
  let enabled = true;
  let availablePath: string | null;

  before(async () => {
    certDir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-public-ca-'));
    certPath = path.join(certDir, 'rootCA.pem');
    writeFileSync(certPath, FAKE_CA);
    availablePath = certPath;

    server = await createTestServer({
      getPublicRootCa: () => ({ enabled, certPath: availablePath }),
    });
  });

  after(async () => {
    await server.close();
    rmSync(certDir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('HTTPS + CA 可用时无需鉴权返回证书附件', async () => {
    enabled = true;
    availablePath = certPath;

    const response = await fetch(`${server.client.baseUrl}/api/public/root-ca.crt`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/x-x509-ca-cert');
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /attachment;\s*filename="root-ca\.crt"/,
    );
    assert.equal(await response.text(), FAKE_CA);
  });

  it('未开启 HTTPS 时返回 404', async () => {
    enabled = false;
    availablePath = certPath;

    const response = await fetch(`${server.client.baseUrl}/api/public/root-ca.crt`);
    assert.equal(response.status, 404);
    const body = (await response.json()) as { code: string };
    assert.equal(body.code, 'NOT_FOUND');
  });

  it('未配置 CA 或文件不存在时返回 404', async () => {
    enabled = true;
    availablePath = null;

    const response = await fetch(`${server.client.baseUrl}/api/public/root-ca.crt`);
    assert.equal(response.status, 404);

    availablePath = path.join(certDir, 'missing.pem');
    const missing = await fetch(`${server.client.baseUrl}/api/public/root-ca.crt`);
    assert.equal(missing.status, 404);
  });

  it('HEAD 请求可用于登录页探测是否显示下载入口', async () => {
    enabled = true;
    availablePath = certPath;

    const response = await fetch(`${server.client.baseUrl}/api/public/root-ca.crt`, {
      method: 'HEAD',
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/x-x509-ca-cert');
  });
});
