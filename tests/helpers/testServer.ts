import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createCoreServices, type CoreServices } from '../../src/core/container.ts';
import { closeDatabase, openDatabase } from '../../src/core/db/connection.ts';
import { migrate } from '../../src/core/db/migrator.ts';
import { hashPassword } from '../../src/core/security/password.ts';
import type { PublicUser, UserRecord } from '../../src/core/types/models.ts';
import type { LocalScanner, VirusTotalClient } from '../../src/core/services/scanService.ts';
import type { AiChatClient } from '../../src/core/services/aiService.ts';
import type { MailTransport } from '../../src/core/services/mailService.ts';
import { createApp } from '../../src/server/app.ts';

export const TEST_PASSWORD = 'Passw0rd!';

let cachedHash: Promise<string> | null = null;
function testPasswordHash(): Promise<string> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return cachedHash;
}

function getSetCookies(headers: Headers): string[] {
  const withMethod = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withMethod.getSetCookie === 'function') {
    return withMethod.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

export class TestClient {
  readonly baseUrl: string;
  csrf = '';
  private readonly jar = new Map<string, string>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  cookieHeader(): string {
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async login(username: string, password: string): Promise<{ user: PublicUser; csrfToken: string }> {
    const response = await this.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = (await response.json()) as { user: PublicUser; csrfToken: string };
    if (!response.ok) {
      throw new Error(`登录失败: ${response.status} ${JSON.stringify(body)}`);
    }
    this.csrf = body.csrfToken;
    return body;
  }

  async request(
    pathname: string,
    init: RequestInit = {},
    options: { csrf?: boolean } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size > 0 && !headers.has('cookie')) {
      headers.set('cookie', this.cookieHeader());
    }

    const method = (init.method ?? 'GET').toUpperCase();
    if (
      options.csrf !== false &&
      this.csrf.length > 0 &&
      !['GET', 'HEAD', 'OPTIONS'].includes(method)
    ) {
      headers.set('x-csrf-token', this.csrf);
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, { ...init, headers });

    for (const raw of getSetCookies(response.headers)) {
      const pair = raw.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }

    return response;
  }

  upload(
    filename: string,
    content: Buffer | Uint8Array,
    options: { path?: string; overwrite?: boolean } = {},
  ): Promise<Response> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(content)]), filename);

    const params = new URLSearchParams({ path: options.path ?? '' });
    if (options.overwrite) params.set('overwrite', '1');

    return this.request(`/api/files/upload?${params.toString()}`, {
      method: 'POST',
      body: form,
    });
  }
}

export interface TestServer {
  services: CoreServices;
  user: UserRecord;
  client: TestClient;
  server: Server;
  port: number;
  dataDir: string;
  storageRoot: string;
  tempDir: string;
  addUser: (username: string, quotaBytes?: number | null) => Promise<{ user: UserRecord; client: TestClient }>;
  close: () => Promise<void>;
}

export async function createTestServer(
  options: {
    quotaBytes?: number | null;
    username?: string;
    getPublicRootCa?: () => { enabled: boolean; certPath: string | null };
    now?: () => number;
    trustProxy?: boolean;
    allowPublicRegistration?: boolean;
    virusTotalClient?: VirusTotalClient;
    localScanner?: LocalScanner;
    sevenZipBinary?: string;
    pluginRoot?: string;
    pluginChildScript?: string;
    pluginExecPath?: string;
    aiClient?: AiChatClient;
    secretPath?: string;
    mailTransport?: MailTransport;
    scanEnabled?: boolean;
    scanMode?: 'api' | 'local';
    permissions?: {
      image?: boolean;
      video?: boolean;
      pdf?: boolean;
      extract?: boolean;
      scan?: boolean;
    };
  } = {},
): Promise<TestServer> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-files-'));
  const storageRoot = path.join(dataDir, 'storage');
  const tempDir = path.join(dataDir, 'tmp');
  mkdirSync(storageRoot, { recursive: true });
  mkdirSync(tempDir, { recursive: true });

  const db = openDatabase({ file: ':memory:' });
  migrate(db);

  const services = createCoreServices({
    db,
    storageRoot,
    tempDir,
    now: options.now,
    virusTotalClient: options.virusTotalClient,
    localScanner: options.localScanner,
    sevenZipBinary: options.sevenZipBinary,
    pluginRoot: options.pluginRoot ?? path.join(storageRoot, '.plugins'),
    pluginChildScript:
      options.pluginChildScript ?? path.resolve('src/plugin-runtime/child.cjs'),
    pluginExecPath: options.pluginExecPath ?? process.execPath,
    aiClient: options.aiClient,
    secretPath: options.secretPath ?? path.join(dataDir, 'ai-secret.key'),
    mailTransport: options.mailTransport,
  });
  services.settings.set('network.trustProxy', options.trustProxy ?? false, null);
  services.settings.set(
    'allow_public_registration',
    options.allowPublicRegistration ?? false,
    null,
  );
  services.settings.set('scan.enabled', options.scanEnabled ?? false, null);
  services.settings.set('scan.mode', options.scanMode ?? 'local', null);
  services.settings.set('allow_user_preview_image', options.permissions?.image ?? true, null);
  services.settings.set('allow_user_preview_video', options.permissions?.video ?? true, null);
  services.settings.set('allow_user_preview_pdf', options.permissions?.pdf ?? true, null);
  services.settings.set('allow_user_extract', options.permissions?.extract ?? true, null);
  services.settings.set('allow_user_scan', options.permissions?.scan ?? true, null);
  const username = options.username ?? 'alice';
  const passwordHash = await testPasswordHash();

  const user = services.users.create({
    storageKey: `storage-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username,
    passwordHash,
    createdAt: Date.now(),
  });
  services.quotas.ensure(user.id, options.quotaBytes === undefined ? 2 * 1024 * 1024 : options.quotaBytes, Date.now());
  mkdirSync(path.join(storageRoot, user.storageKey), { recursive: true });

  const app = createApp({
    services,
    version: '0.0.0-test',
    getPublicRootCa: options.getPublicRootCa,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  const baseUrl = `http://127.0.0.1:${port}`;
  const client = new TestClient(baseUrl);
  await client.login(username, TEST_PASSWORD);

  const addUser = async (
    name: string,
    quotaBytes: number | null = 2 * 1024 * 1024,
  ): Promise<{ user: UserRecord; client: TestClient }> => {
    const created = services.users.create({
      storageKey: `storage-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      username: name,
      passwordHash: await testPasswordHash(),
      createdAt: Date.now(),
    });
    services.quotas.ensure(created.id, quotaBytes, Date.now());
    mkdirSync(path.join(storageRoot, created.storageKey), { recursive: true });

    const createdClient = new TestClient(baseUrl);
    await createdClient.login(name, TEST_PASSWORD);
    return { user: created, client: createdClient };
  };

  return {
    services,
    user,
    client,
    server,
    port,
    dataDir,
    storageRoot,
    tempDir,
    addUser,
    close: async () => {
      await services.plugins.stopAll().catch(() => {});
      server.closeAllConnections?.();
      server.close();
      await once(server, 'close');
      closeDatabase(db);
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('waitFor 超时');
}
