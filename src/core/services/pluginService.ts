import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { PluginRepository, PluginRecord } from '../db/repositories/pluginRepo.ts';
import type { EventBus } from './eventBus.ts';
import type { SettingsService } from './settingsService.ts';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** File extensions supported by this plugin, e.g. [".json"]. */
  previews?: string[];
  /** Optional external settings page opened in the browser. */
  adminUrl?: string;
}

export interface PluginStatus extends PluginRecord {
  previews: string[];
  running: boolean;
  hasAdminUi: boolean;
  hasTheme: boolean;
  hasWebOverride: boolean;
  adminUiUrl: string | null;
  directory: string;
}

export interface PluginUiSlot {
  id: string;
  title: string;
  icon: string;
  position: 'bottom-right' | 'bottom-left' | 'sidebar';
  plugin: string;
}

export interface PluginAiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  plugin: string;
}

/** Host capabilities exposed to trusted plugin children over a whitelist RPC. */
export interface PluginHost {
  getSystemStats(): unknown;
  getBannedList(): unknown;
  getUser(userId: number): unknown;
  updateQuota(userId: number, quotaBytes: number | null): unknown;
  getMeta(userId: number, key: string): unknown;
  setMeta(userId: number, key: string, value: unknown): unknown;
  fileRead(userId: number, path: string): Promise<unknown>;
  fileWrite(userId: number, path: string, content: string): Promise<unknown>;
  fileList(userId: number, dir: string): Promise<unknown>;
  fileGetUrl(userId: number, path: string): Promise<unknown>;
}

export interface PluginRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  user: { id: number; username: string; role: string } | null;
  /** Populated by the host after a safePath read for /preview routes. */
  fileContent?: string;
}

export interface PluginResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface ChildState {
  child: ChildProcess;
  ready: boolean;
  pending: Map<string, { resolve: (value: PluginResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
  logs: string[];
}

export const MAX_PLUGIN_PACKAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PLUGIN_PACKAGE_ENTRIES = 2_000;
export const MAX_PLUGIN_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_PLUGIN_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_PLUGIN_COMPRESSION_RATIO = 100;
export const MAX_PLUGIN_LOG_LINES = 1_000;

const NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

function safeRelativePath(value: string): string {
  if (/^[A-Za-z]:|^[/\\]/.test(value)) {
    throw new Error('插件包包含绝对路径');
  }
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) throw new Error('插件包包含非法路径');
  if (normalized.split('/').some((part) => part === '..' || part === '' || part === '.')) {
    throw new Error('插件包包含非法路径');
  }
  return normalized;
}

function normalizePreviews(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const extension = item.trim().toLowerCase().replace(/^\.?/, '.');
    if (!/^\.[a-z0-9]{1,16}$/.test(extension) || result.includes(extension)) continue;
    result.push(extension);
    if (result.length >= 20) break;
  }
  return result;
}

function parseManifestText(text: string): PluginManifest {
  const manifest = JSON.parse(text) as PluginManifest;
  if (!NAME_PATTERN.test(manifest.name ?? '')) {
    throw new Error('manifest.name 必须为小写字母/数字/短横线，2-64 字符');
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('manifest.version 不能为空');
  }
  return {
    name: manifest.name,
    version: manifest.version,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    author: typeof manifest.author === 'string' ? manifest.author : '',
    previews: normalizePreviews(manifest.previews),
  };
}

function readManifest(directory: string): PluginManifest {
  const file = path.join(directory, 'manifest.json');
  if (!existsSync(file)) throw new Error('插件缺少 manifest.json');
  return parseManifestText(readFileSync(file, 'utf8'));
}

function findManifestEntry(zip: AdmZip): AdmZip.IZipEntry {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = safeRelativePath(entry.entryName);
    if (name === 'manifest.json') return entry;
    const slash = name.indexOf('/');
    if (slash > 0 && name.indexOf('/', slash + 1) === -1 && name.slice(slash + 1) === 'manifest.json') {
      return entry;
    }
  }
  throw new Error('插件包根目录或一级子目录缺少 manifest.json');
}

async function findManifestRoot(root: string): Promise<string> {
  if (existsSync(path.join(root, 'manifest.json'))) return root;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && existsSync(path.join(root, entry.name, 'manifest.json'))) {
      return path.join(root, entry.name);
    }
  }
  throw new Error('插件包根目录或一级子目录缺少 manifest.json');
}

export class PluginService {
  private readonly plugins: PluginRepository;
  private readonly events: EventBus;
  private readonly pluginRoot: string;
  private readonly childScript: string;
  private readonly execPath: string;
  private readonly startTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly settings: SettingsService | null;
  private readonly children = new Map<string, ChildState>();
  private host: PluginHost | null = null;
  private readonly uiSlots = new Map<string, PluginUiSlot[]>();
  private readonly aiTools = new Map<string, PluginAiTool>();
  private readonly promptInjections = new Map<string, string>();
  private readonly uiTokens = new Map<string, { plugin: string; userId: number; expiresAt: number }>();
  private sequence = 0;

  constructor(options: {
    plugins: PluginRepository;
    events: EventBus;
    pluginRoot: string;
    childScript?: string;
    execPath?: string;
    startTimeoutMs?: number;
    requestTimeoutMs?: number;
    settings?: SettingsService;
  }) {
    this.plugins = options.plugins;
    this.events = options.events;
    this.pluginRoot = options.pluginRoot;
    this.childScript =
      options.childScript ??
      path.join(process.cwd(), 'dist', 'main', 'plugin-child.cjs');
    this.execPath = options.execPath ?? process.execPath;
    this.startTimeoutMs = options.startTimeoutMs ?? 10_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.settings = options.settings ?? null;
    mkdirSync(this.pluginRoot, { recursive: true });
    this.events.on('file.uploaded', (payload) => this.broadcast('file.uploaded', payload));
    this.events.on('file.deleted', (payload) => this.broadcast('file.deleted', payload));
    this.events.on('user.registered', (payload) => this.broadcast('user.registered', payload));
    this.events.on('user.created', (payload) => this.broadcast('user.created', payload));
    this.events.on('security.alert', (payload) => this.broadcast('security.alert', payload));
    this.events.on('security.banned', (payload) => this.broadcast('security.banned', payload));
    this.events.on('security.limit', (payload) => this.broadcast('security.limit', payload));
    this.events.on('security.global.limit', (payload) => this.broadcast('security.global.limit', payload));
  }

  setHost(host: PluginHost): void {
    this.host = host;
  }

  private appendPluginLog(state: ChildState, name: string, data: unknown, isError: boolean): void {
    for (const line of String(data).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)) {
      const text = line.trimEnd();
      if (!text) continue;
      state.logs.push(text);
      if (state.logs.length > MAX_PLUGIN_LOG_LINES) state.logs.splice(0, state.logs.length - MAX_PLUGIN_LOG_LINES);
      if (isError) console.error(`[plugin:${name}] ${text}`);
      else console.log(`[plugin:${name}] ${text}`);
    }
  }

  private broadcast(event: string, payload: Record<string, unknown>): void {
    for (const state of this.children.values()) {
      if (state.ready && state.child.connected) {
        state.child.send({ type: 'event', event, payload });
      }
    }
  }

  private scanInstalled(): void {
    if (!existsSync(this.pluginRoot)) return;
    for (const entry of readdirSync(this.pluginRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directory = path.join(this.pluginRoot, entry.name);
      if (!existsSync(path.join(directory, 'manifest.json'))) continue;
      try {
        const manifest = readManifest(directory);
        const existing = this.plugins.get(manifest.name);
        this.plugins.upsert({
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? '',
          enabled: existing?.enabled ?? false,
          allowWebOverride: existing?.allowWebOverride ?? false,
          installedAt: existing?.installedAt ?? Date.now(),
          manifestJson: JSON.stringify(manifest),
        });
      } catch {
        // 损坏插件不进入列表
      }
    }
  }

  list(): PluginStatus[] {
    this.scanInstalled();
    return this.plugins.list().map((record) => this.status(record));
  }

  private status(record: PluginRecord): PluginStatus {
    const directory = path.join(this.pluginRoot, record.name);
    let previews: string[] = [];
    try {
      previews = normalizePreviews((JSON.parse(record.manifestJson) as PluginManifest).previews);
    } catch {
      previews = [];
    }
    const manifest = JSON.parse(record.manifestJson) as PluginManifest;
    const configuredAdminUrl = typeof manifest.adminUrl === 'string' && /^https?:\/\//i.test(manifest.adminUrl) ? manifest.adminUrl : null;
    const hasAdminUi = configuredAdminUrl !== null || existsSync(path.join(directory, 'admin-ui', 'index.html'));
    return {
      ...record,
      previews,
      running: this.children.has(record.name) && this.children.get(record.name)!.ready,
      hasAdminUi,
      hasTheme: existsSync(path.join(directory, 'web-theme.css')),
      hasWebOverride: existsSync(path.join(directory, 'web-override', 'index.html')),
      adminUiUrl: configuredAdminUrl ?? (hasAdminUi ? `plugin-admin://${record.name}/index.html` : null),
      directory,
    };
  }

  async importFolder(source: string): Promise<PluginStatus[]> {
    const temp = path.join(this.pluginRoot, `.import-${Date.now()}-${this.sequence++}`);
    try {
      await cp(source, temp, { recursive: true, force: false, errorOnExist: false });
      const root = await findManifestRoot(temp);
      const manifest = readManifest(root);
      const target = path.join(this.pluginRoot, manifest.name);
      if (existsSync(target)) throw new Error(`插件 ${manifest.name} 已存在`);
      await rename(root, target);
      this.plugins.upsert({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        enabled: false,
        allowWebOverride: false,
        installedAt: Date.now(),
        manifestJson: JSON.stringify(manifest),
      });
      return this.list();
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  async importZip(source: string): Promise<PluginStatus[]> {
    const temp = path.join(this.pluginRoot, `.import-${Date.now()}-${this.sequence++}`);
    try {
      await mkdir(temp, { recursive: true });
      const limits = this.settings?.getLowLevel();
      const maxPackageBytes = limits?.pluginPackageBytes ?? MAX_PLUGIN_PACKAGE_BYTES;
      const maxEntries = limits?.pluginPackageEntries ?? MAX_PLUGIN_PACKAGE_ENTRIES;
      const maxUncompressedBytes = limits?.pluginUncompressedBytes ?? MAX_PLUGIN_UNCOMPRESSED_BYTES;
      const maxEntryBytes = limits?.pluginEntryBytes ?? MAX_PLUGIN_ENTRY_BYTES;
      const maxCompressionRatio = limits?.pluginCompressionRatio ?? MAX_PLUGIN_COMPRESSION_RATIO;
      const sourceSize = statSync(source).size;
      if (sourceSize > maxPackageBytes) {
        throw new Error(`插件 ZIP 超过 ${maxPackageBytes / 1024 / 1024}MB 上限`);
      }
      const zip = new AdmZip(source);
      const entries = zip.getEntries();
      if (entries.length > maxEntries) {
        throw new Error(`插件 ZIP 条目数超过 ${maxEntries} 上限`);
      }
      let totalBytes = 0;
      for (const entry of entries) {
        safeRelativePath(entry.entryName);
        if (entry.header.encrypted) {
          throw new Error('插件 ZIP 不能包含加密条目');
        }
        if (entry.isDirectory) continue;
        const size = entry.header.size;
        const compressed = entry.header.compressedSize;
        if (size > maxEntryBytes) {
          throw new Error(`插件 ZIP 单文件解压后超过 ${maxEntryBytes / 1024 / 1024}MB 上限`);
        }
        totalBytes += size;
        if (totalBytes > maxUncompressedBytes) {
          throw new Error(`插件 ZIP 解压后总大小超过 ${maxUncompressedBytes / 1024 / 1024}MB 上限`);
        }
        if (size > 1024 * 1024 && compressed > 0 && size / compressed > maxCompressionRatio) {
          throw new Error('插件 ZIP 压缩比异常，已拒绝解压');
        }
      }
      // Validate the manifest before extracting anything. A non-plugin ZIP must
      // never reach extractAllTo(), even if it is small and has few entries.
      const manifest = parseManifestText(zip.readAsText(findManifestEntry(zip)));
      const target = path.join(this.pluginRoot, manifest.name);
      if (existsSync(target)) throw new Error(`插件 ${manifest.name} 已存在`);
      zip.extractAllTo(temp, true);
      const root = await findManifestRoot(temp);
      await rename(root, target);
      this.plugins.upsert({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        enabled: false,
        allowWebOverride: false,
        installedAt: Date.now(),
        manifestJson: JSON.stringify(manifest),
      });
      return this.list();
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    const record = this.plugins.get(name);
    if (record === null) throw new Error('插件不存在');
    if (enabled) {
      await this.start(name);
      this.plugins.setEnabled(name, true);
    } else {
      await this.stop(name);
      this.plugins.setEnabled(name, false);
    }
  }

  setAllowWebOverride(name: string, allowed: boolean): void {
    if (this.plugins.get(name) === null) throw new Error('插件不存在');
    this.plugins.setAllowWebOverride(name, allowed);
  }

  async start(name: string): Promise<void> {
    const record = this.plugins.get(name);
    if (record === null) throw new Error('插件不存在');
    const existing = this.children.get(name);
    if (existing?.ready) return;

    const directory = path.join(this.pluginRoot, name);
    const storage = path.join(this.pluginRoot, '.storage', name);
    mkdirSync(storage, { recursive: true });

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      CLOUDBOX_PLUGIN_NAME: name,
    };
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';

    if (!existsSync(directory)) throw new Error(`插件目录不存在：${directory}`);
    const child = fork(this.childScript, [directory, storage], {
      cwd: directory,
      env,
      execPath: this.execPath,
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    const state: ChildState = { child, ready: false, pending: new Map(), logs: [] };
    this.children.set(name, state);

    child.stdout?.on('data', (data) => this.appendPluginLog(state, name, data, false));
    child.stderr?.on('data', (data) => this.appendPluginLog(state, name, data, true));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('插件启动超时')), this.startTimeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('exit', onExit);
        child.off('error', onError);
      };
      const onMessage = (message: any) => {
        if (message?.type === 'ready') {
          state.ready = true;
          cleanup();
          resolve();
        } else if (message?.type === 'fatal') {
          cleanup();
          reject(new Error(message.message ?? '插件启动失败'));
        } else if (message?.type === 'context-request') {
          void this.handleContext(name, state, message);
        } else if (message?.type === 'log') {
          const line = `[plugin:${name}:${message.level}] ${(message.args ?? []).join(' ')}`;
          if (message.level === 'error') console.error(line);
          else console.log(line);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        this.children.delete(name);
        reject(error);
      };
      const onExit = (code: number | null) => {
        cleanup();
        this.children.delete(name);
        reject(new Error(`插件进程退出（${code ?? 'unknown'}）`));
      };
      child.on('error', onError);
      child.on('message', onMessage);
      child.once('exit', onExit);
    }).catch(async (error: Error) => {
      await this.stop(name).catch(() => {});
      throw error;
    });

    child.on('message', (message: any) => {
      if (message?.type === 'context-request') {
        void this.handleContext(name, state, message);
        return;
      }
      if (message?.type === 'ai-tool-result') {
        const pending = state.pending.get(message.id);
        if (pending) {
          state.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve({ status: 200, headers: {}, body: message.result ?? null });
          else pending.reject(new Error(message.error ?? '插件 AI 工具执行失败'));
        }
        return;
      }
      if (message?.type !== 'http-response') return;
      const pending = state.pending.get(message.id);
      if (!pending) return;
      state.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve({
        status: Number(message.status) || 500,
        headers: message.headers ?? {},
        body: message.body ?? null,
      });
    });
    child.once('exit', () => {
      for (const pending of state.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('插件进程已退出'));
      }
      state.pending.clear();
      this.children.delete(name);
    });
  }

  async stop(name: string): Promise<void> {
    this.uiSlots.delete(name);
    this.promptInjections.delete(name);
    for (const [toolName, tool] of this.aiTools) if (tool.plugin === name) this.aiTools.delete(toolName);
    const state = this.children.get(name);
    if (!state) return;
    this.children.delete(name);
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('插件已停止'));
    }
    state.pending.clear();
    state.child.send({ type: 'shutdown' });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        state.child.kill();
        resolve();
      }, 1_000);
      state.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.children.keys()].map((name) => this.stop(name)));
  }

  async startAll(): Promise<void> {
    this.scanInstalled();
    for (const record of this.plugins.list()) {
      if (!record.enabled) continue;
      await this.start(record.name).catch((error: unknown) => {
        console.error(`[plugin:${record.name}] 自动启动失败`, error);
      });
    }
  }

  async uninstall(name: string): Promise<PluginStatus[]> {
    const record = this.plugins.get(name);
    if (record === null) throw new Error('插件不存在');
    await this.stop(name);
    const target = path.join(this.pluginRoot, name);
    if (existsSync(target)) await rm(target, { recursive: true, force: true });
    this.plugins.remove(name);
    return this.list();
  }

  private async handleContext(name: string, state: ChildState, message: any): Promise<void> {
    const id = String(message.id ?? '');
    try {
      const method = String(message.method ?? '');
      const args = Array.isArray(message.args) ? message.args : [];
      let result: unknown;
      switch (method) {
        case 'system.getStats': result = this.requireHost().getSystemStats(); break;
        case 'security.getBannedList': result = this.requireHost().getBannedList(); break;
        case 'user.getInfo': result = this.requireHost().getUser(Number(args[0])); break;
        case 'user.updateQuota': result = this.requireHost().updateQuota(Number(args[0]), args[1] === null ? null : Number(args[1])); break;
        case 'user.getMeta': result = this.requireHost().getMeta(Number(args[0]), String(args[1] ?? '')); break;
        case 'user.setMeta': result = this.requireHost().setMeta(Number(args[0]), String(args[1] ?? ''), args[2]); break;
        case 'file.read': result = await this.requireHost().fileRead(Number(args[0]), String(args[1] ?? '')); break;
        case 'file.write': result = await this.requireHost().fileWrite(Number(args[0]), String(args[1] ?? ''), String(args[2] ?? '')); break;
        case 'file.list': result = await this.requireHost().fileList(Number(args[0]), String(args[1] ?? '')); break;
        case 'file.getUrl': result = await this.requireHost().fileGetUrl(Number(args[0]), String(args[1] ?? '')); break;
        case 'ui.register': {
          const slot = args[0] as Partial<PluginUiSlot> | undefined;
          if (!slot || typeof slot.id !== 'string' || slot.id.length > 64 || typeof slot.title !== 'string' || !slot.title.trim()) throw new Error('invalid ui slot');
          const position = slot.position === 'bottom-left' || slot.position === 'sidebar' ? slot.position : 'bottom-right';
          const list = this.uiSlots.get(name) ?? [];
          if (!list.some((entry) => entry.id === slot.id)) list.push({ id: slot.id, title: slot.title.slice(0, 80), icon: String(slot.icon ?? 'sparkles').slice(0, 40), position, plugin: name });
          this.uiSlots.set(name, list);
          result = true;
          break;
        }
        case 'ai.registerTool': {
          const tool = args[0] as Partial<PluginAiTool> | undefined;
          if (!tool || typeof tool.name !== 'string' || !/^[a-zA-Z0-9_-]{2,64}$/.test(tool.name) || typeof tool.description !== 'string' || typeof tool.parameters !== 'object' || tool.parameters === null) throw new Error('invalid AI tool');
          this.aiTools.set(tool.name, { name: tool.name, description: tool.description.slice(0, 500), parameters: tool.parameters as Record<string, unknown>, plugin: name });
          result = true;
          break;
        }
        case 'ai.injectPrompt': {
          const text = String(args[0] ?? '').slice(0, 8_000);
          if (text.trim() !== '') this.promptInjections.set(name, text);
          result = true;
          break;
        }
        default: throw new Error(`不允许的插件能力：${method}`);
      }
      state.child.send({ type: 'context-response', id, ok: true, result });
    } catch (error) {
      state.child.send({ type: 'context-response', id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private requireHost(): PluginHost {
    if (this.host === null) throw new Error('插件宿主未初始化');
    return this.host;
  }

  getUiSlots(userId: number): Array<PluginUiSlot & { iframeUrl: string; token: string }> {
    this.scanInstalled();
    const now = Date.now();
    for (const [token, entry] of this.uiTokens) if (entry.expiresAt <= now) this.uiTokens.delete(token);
    const result: Array<PluginUiSlot & { iframeUrl: string; token: string }> = [];
    for (const record of this.plugins.list()) {
      if (!record.enabled) continue;
      for (const slot of this.uiSlots.get(record.name) ?? []) {
        const token = randomBytes(24).toString('hex');
        this.uiTokens.set(token, { plugin: record.name, userId, expiresAt: now + 10 * 60_000 });
        result.push({ ...slot, iframeUrl: `/plugin-web/${record.name}/ui/index.html`, token });
      }
    }
    return result;
  }

  getUiAsset(name: string, relative: string): string | null {
    if (!NAME_PATTERN.test(name)) return null;
    const base = path.join(this.pluginRoot, name, 'web-ui');
    const target = path.resolve(base, safeRelativePath(relative));
    if (path.relative(base, target).startsWith('..') || !existsSync(target)) return null;
    return target;
  }

  getAiTools(): PluginAiTool[] { return [...this.aiTools.values()]; }
  getPromptInjections(): string[] { return [...this.promptInjections.values()]; }

  async proxy(name: string, request: PluginRequest): Promise<PluginResponse | null> {
    const state = this.children.get(name);
    if (!state?.ready || !state.child.connected) return null;
    const id = `${Date.now()}-${this.sequence++}`;
    return new Promise<PluginResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error('插件请求超时'));
      }, this.requestTimeoutMs);
      state.pending.set(id, { resolve, reject, timer });
      state.child.send({ type: 'http', id, request });
    });
  }

  async callAiTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.aiTools.get(name);
    if (!tool) throw new Error('插件 AI 工具不存在');
    const state = this.children.get(tool.plugin);
    if (!state?.ready || !state.child.connected) throw new Error('插件未运行');
    const id = `${Date.now()}-${this.sequence++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { state.pending.delete(id); reject(new Error('插件 AI 工具超时')); }, this.requestTimeoutMs);
      state.pending.set(id, { resolve: (response) => resolve(response.body), reject, timer });
      state.child.send({ type: 'ai-tool-call', id, name, args });
    });
  }

  /** Enabled plugin extension -> plugin name map, first enabled plugin wins. */
  previewers(): Record<string, string> {
    this.scanInstalled();
    const result: Record<string, string> = {};
    for (const record of this.plugins.list()) {
      if (!record.enabled) continue;
      for (const extension of this.status(record).previews) {
        if (!(extension in result)) result[extension] = record.name;
      }
    }
    return result;
  }

  getThemeCss(): string {
    this.scanInstalled();
    return this.plugins
      .list()
      .filter((record) => record.enabled)
      .map((record) => path.join(this.pluginRoot, record.name, 'web-theme.css'))
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
  }

  getWebOverride(user: { id: number; username: string; role: string } | null = null): { name: string; html: string } | null {
    this.scanInstalled();
    for (const record of this.plugins.list()) {
      if (!record.enabled || !record.allowWebOverride) continue;
      const file = path.join(this.pluginRoot, record.name, 'web-override', 'index.html');
      if (!existsSync(file)) continue;
      const token = randomBytes(24).toString('hex');
      if (user !== null) this.uiTokens.set(token, { plugin: record.name, userId: user.id, expiresAt: Date.now() + 10 * 60_000 });
      const source = `/plugin-web/${record.name}/web-override/index.html`;
      const init = JSON.stringify({ type: 'cloudbox:init', token, user });
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0f172a}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe id="plugin-override" sandbox="allow-scripts allow-forms" src="${source}" title="${record.name}"></iframe><script>const frame=document.getElementById('plugin-override');frame.addEventListener('load',()=>frame.contentWindow?.postMessage(${JSON.stringify(init)},'*'));</script></body></html>`;
      return { name: record.name, html };
    }
    return null;
  }

  getWebOverrideAsset(name: string, relative: string): string | null {
    if (!NAME_PATTERN.test(name)) return null;
    const base = path.join(this.pluginRoot, name, 'web-override');
    let rel = safeRelativePath(relative);
    if (rel.startsWith('web-override/')) rel = rel.slice('web-override/'.length);
    const target = path.resolve(base, rel);
    if (path.relative(base, target).startsWith('..')) return null;
    return existsSync(target) ? target : null;
  }

  getAdminUiPath(name: string, relative = 'index.html'): string | null {
    if (!NAME_PATTERN.test(name)) return null;
    const base = path.join(this.pluginRoot, name, 'admin-ui');
    const target = path.resolve(base, safeRelativePath(relative));
    if (path.relative(base, target).startsWith('..') || !existsSync(target)) return null;
    return target;
  }

  async disableWebOverrideForUninstalled(): Promise<void> {
    // 预留：插件被外部删除时清理状态
  }
}
