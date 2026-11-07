import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { PluginRepository, PluginRecord } from '../db/repositories/pluginRepo.ts';
import type { EventBus } from './eventBus.ts';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
}

export interface PluginStatus extends PluginRecord {
  running: boolean;
  hasAdminUi: boolean;
  hasTheme: boolean;
  hasWebOverride: boolean;
  adminUiUrl: string | null;
  directory: string;
}

export interface PluginRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  user: { id: number; username: string; role: string } | null;
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
}

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

function readManifest(directory: string): PluginManifest {
  const file = path.join(directory, 'manifest.json');
  if (!existsSync(file)) throw new Error('插件缺少 manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as PluginManifest;
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
  };
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
  private readonly children = new Map<string, ChildState>();
  private sequence = 0;

  constructor(options: {
    plugins: PluginRepository;
    events: EventBus;
    pluginRoot: string;
    childScript?: string;
    execPath?: string;
  }) {
    this.plugins = options.plugins;
    this.events = options.events;
    this.pluginRoot = options.pluginRoot;
    this.childScript =
      options.childScript ??
      path.join(process.cwd(), 'dist', 'main', 'plugin-child.cjs');
    this.execPath = options.execPath ?? process.execPath;
    mkdirSync(this.pluginRoot, { recursive: true });
    this.events.on('file.uploaded', (payload) => this.broadcast('file.uploaded', payload));
    this.events.on('file.deleted', (payload) => this.broadcast('file.deleted', payload));
    this.events.on('user.registered', (payload) => this.broadcast('user.registered', payload));
    this.events.on('user.created', (payload) => this.broadcast('user.created', payload));
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
    const hasAdminUi = existsSync(path.join(directory, 'admin-ui', 'index.html'));
    return {
      ...record,
      running: this.children.has(record.name) && this.children.get(record.name)!.ready,
      hasAdminUi,
      hasTheme: existsSync(path.join(directory, 'web-theme.css')),
      hasWebOverride: existsSync(path.join(directory, 'web-override', 'index.html')),
      adminUiUrl: hasAdminUi ? `plugin-admin://${record.name}/index.html` : null,
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
      const zip = new AdmZip(source);
      for (const entry of zip.getEntries()) {
        safeRelativePath(entry.entryName);
      }
      zip.extractAllTo(temp, true);
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

    const child = fork(this.childScript, [directory, storage], {
      cwd: directory,
      env,
      execPath: this.execPath,
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    child.stdout?.on('data', (data) => console.log(`[plugin:${name}] ${String(data).trimEnd()}`));
    child.stderr?.on('data', (data) => console.error(`[plugin:${name}] ${String(data).trimEnd()}`));

    const state: ChildState = { child, ready: false, pending: new Map() };
    this.children.set(name, state);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('插件启动超时')), 10_000);
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('exit', onExit);
      };
      const onMessage = (message: any) => {
        if (message?.type === 'ready') {
          state.ready = true;
          cleanup();
          resolve();
        } else if (message?.type === 'fatal') {
          cleanup();
          reject(new Error(message.message ?? '插件启动失败'));
        } else if (message?.type === 'log') {
          const line = `[plugin:${name}:${message.level}] ${(message.args ?? []).join(' ')}`;
          if (message.level === 'error') console.error(line);
          else console.log(line);
        }
      };
      const onExit = (code: number | null) => {
        cleanup();
        this.children.delete(name);
        reject(new Error(`插件进程退出（${code ?? 'unknown'}）`));
      };
      child.on('message', onMessage);
      child.once('exit', onExit);
    }).catch(async (error: Error) => {
      await this.stop(name).catch(() => {});
      throw error;
    });

    child.on('message', (message: any) => {
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

  async proxy(name: string, request: PluginRequest): Promise<PluginResponse | null> {
    const state = this.children.get(name);
    if (!state?.ready || !state.child.connected) return null;
    const id = `${Date.now()}-${this.sequence++}`;
    return new Promise<PluginResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error('插件请求超时'));
      }, 15_000);
      state.pending.set(id, { resolve, reject, timer });
      state.child.send({ type: 'http', id, request });
    });
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

  getWebOverride(): { name: string; html: string } | null {
    this.scanInstalled();
    for (const record of this.plugins.list()) {
      if (!record.enabled || !record.allowWebOverride) continue;
      const file = path.join(this.pluginRoot, record.name, 'web-override', 'index.html');
      if (existsSync(file)) return { name: record.name, html: readFileSync(file, 'utf8') };
    }
    return null;
  }

  getWebOverrideAsset(name: string, relative: string): string | null {
    if (!NAME_PATTERN.test(name)) return null;
    const base = path.join(this.pluginRoot, name, 'web-override');
    const target = path.resolve(base, safeRelativePath(relative));
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
