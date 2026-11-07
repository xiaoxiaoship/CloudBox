import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AiChatClient } from '../../src/core/services/aiService.ts';
import type { RequestContext } from '../../src/core/services/fileService.ts';
import { createTestServer, type TestServer } from '../helpers/testServer.ts';

const ctx: RequestContext = { ip: '127.0.0.1', userAgent: 'test', requestId: null };

describe('native AI and MCP', () => {
  let t: TestServer | null = null;

  afterEach(async () => {
    await t?.close();
    t = null;
  });

  it('API Key 加密落盘、脱敏展示，并完成 write_text_file 工具调用', async () => {
    let calls = 0;
    const client: AiChatClient = {
      async chat() {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                name: 'write_text_file',
                arguments: { path: 'src/hello.txt', content: 'hello from ai' },
              },
            ],
          };
        }
        return { content: '文件已创建。', toolCalls: [] };
      },
    };
    t = await createTestServer({ aiClient: client });
    t.services.ai.saveAdmin({
      enabled: true,
      mode: 'admin',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'sk-secret-12345',
      model: 'test-model',
      dailyLimit: 50,
      mcpEnabled: false,
    });

    const raw = t.services.settings.get('ai.admin_api_key');
    assert.match(raw, /^enc:v1:/);
    assert.ok(!raw.includes('sk-secret-12345'));
    const admin = t.services.ai.adminSettings() as {
      apiKeyMasked: string;
      mcp: { configTemplate: unknown };
    };
    assert.equal(admin.apiKeyMasked, 'sk-***345');

    t.services.settings.set('ai.mode', 'user', null);
    const userSettings = t.services.ai.saveUserSettings(t.user, {
      baseUrl: 'https://user.invalid/v1',
      model: 'user-model',
      apiKey: 'sk-user-secret-999',
      workScope: 'folder',
      workDir: 'src',
    });
    assert.equal((userSettings as { maskedApiKey: string }).maskedApiKey, 'sk-***999');
    t.services.settings.set('ai.mode', 'admin', null);
    const userRow = t.services.db
      .prepare('SELECT api_key_enc FROM user_ai_settings WHERE user_id = ?')
      .get(t.user.id) as { api_key_enc: string };
    assert.match(userRow.api_key_enc, /^enc:v1:/);
    assert.ok(!userRow.api_key_enc.includes('sk-user-secret-999'));

    const events = [];
    for await (const event of t.services.ai.chat(
      t.user,
      [{ role: 'user', content: '创建 src/hello.txt' }],
      ctx,
    )) {
      events.push(event);
    }
    assert.ok(events.some((event) => event.type === 'done'));
    const file = await t.services.files.readText(t.user, 'src/hello.txt', ctx);
    assert.equal(file.content, 'hello from ai');
  });

  it('覆盖已存在文件返回 action_id，确认后才执行', async () => {
    let calls = 0;
    const client: AiChatClient = {
      async chat() {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                name: 'write_text_file',
                arguments: { path: 'existing.txt', content: 'new content' },
              },
            ],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
    };
    t = await createTestServer({ aiClient: client });
    t.services.ai.saveAdmin({
      enabled: true,
      mode: 'admin',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'sk-secret-67890',
      model: 'test-model',
      dailyLimit: 50,
      mcpEnabled: false,
    });
    await t.client.upload('existing.txt', Buffer.from('old content'));

    const events = [];
    for await (const event of t.services.ai.chat(
      t.user,
      [{ role: 'user', content: '覆盖 existing.txt' }],
      ctx,
    )) {
      events.push(event);
    }
    const confirmation = events.find(
      (event) => event.type === 'confirmation',
    ) as { actionId: string } | undefined;
    assert.ok(confirmation?.actionId);
    assert.equal(
      (await t.services.files.readText(t.user, 'existing.txt', ctx)).content,
      'old content',
    );
    const result = await t.services.ai.confirm(t.user, confirmation!.actionId, ctx);
    assert.equal(result.ok, true);
    assert.equal(
      (await t.services.files.readText(t.user, 'existing.txt', ctx)).content,
      'new content',
    );
  });

  it('MCP Token 鉴权、工具列表和工具调用', async () => {
    t = await createTestServer();
    t.services.ai.saveAdmin({
      enabled: true,
      mode: 'admin',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'sk-secret-mcp',
      model: 'test-model',
      dailyLimit: 50,
      mcpEnabled: true,
      mcpToken: 'cbx_test_token',
    });
    t.services.settings.set('mcp.bound_user_id', t.user.id, null);

    const transport = new StreamableHTTPClientTransport(
      new URL(`${t.client.baseUrl}/api/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer cbx_test_token' } } },
    );
    const client = new Client({ name: 'cloudbox-test', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'write_text_file'));
    const blocked = await client.callTool({
      name: 'read_text_file',
      arguments: { path: 'C:\\Windows\\win.ini' },
    });
    assert.match(JSON.stringify(blocked), /PATH|INVALID|绝对|非法/);
    await client.callTool({
      name: 'write_text_file',
      arguments: { path: 'mcp/hello.txt', content: 'from mcp' },
    });
    assert.equal(
      (await t.services.files.readText(t.user, 'mcp/hello.txt', ctx)).content,
      'from mcp',
    );
    await client.close();

    const badTransport = new StreamableHTTPClientTransport(
      new URL(`${t.client.baseUrl}/api/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer wrong' } } },
    );
    const badClient = new Client({ name: 'bad', version: '1.0.0' });
    await assert.rejects(() => badClient.connect(badTransport));
    await badClient.close().catch(() => {});
  });
});
