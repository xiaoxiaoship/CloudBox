import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createCoreServices, type CoreServices } from '../../src/core/container.ts';
import { closeDatabase, openDatabase } from '../../src/core/db/connection.ts';
import { migrate } from '../../src/core/db/migrator.ts';
import { createApp } from '../../src/server/app.ts';

describe('HTTP /health', () => {
  let services: CoreServices;
  let server: Server;
  let baseUrl: string;
  let dataDir: string;

  before(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-health-'));
    mkdirSync(path.join(dataDir, 'storage'), { recursive: true });
    mkdirSync(path.join(dataDir, 'tmp'), { recursive: true });

    const db = openDatabase({ file: ':memory:' });
    migrate(db);
    services = createCoreServices({
      db,
      storageRoot: path.join(dataDir, 'storage'),
      tempDir: path.join(dataDir, 'tmp'),
    });

    const app = createApp({ services, version: '0.0.0-test' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    closeDatabase(services.db);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('返回 200 与数据库状态', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(response.headers.get('x-request-id'));

    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'cloudbox');
    assert.equal(body.database, 'ok');
    assert.equal(body.version, '0.0.0-test');
  });

  it('未知路由返回统一 JSON 404', async () => {
    const response = await fetch(`${baseUrl}/api/not-exist`);
    assert.equal(response.status, 404);

    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.message, '接口不存在');
  });

  it('透传合法的 X-Request-Id', async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { 'x-request-id': 'trace_12345678' },
    });
    assert.equal(response.headers.get('x-request-id'), 'trace_12345678');
  });
});
