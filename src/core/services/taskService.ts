import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'paused'
  | 'cancelled'
  | 'running'
  | 'scanning'
  | 'clean'
  | 'infected'
  | 'skipped'
  | 'completed'
  | 'failed';

export interface TaskRecord {
  id: string;
  userId: number;
  type: 'extract' | 'scan' | 'compress' | 'upload';
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  result: unknown;
  error: string | null;
  payload?: unknown;
  progress?: number;
  queuePosition?: number | null;
  residualPaths?: string[];
  hidden?: boolean;
}

const TASK_TTL_MS = 60 * 60 * 1_000;

/** 进程内异步任务注册表；应用重启后任务自然失效。 */
export class TaskService {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly now: () => number;

  private readonly storeFile: string | null;
  private readonly cancelHandlers = new Map<string, () => void>();

  constructor(options: { now?: () => number; storeFile?: string } = {}) {
    this.now = options.now ?? Date.now;
    this.storeFile = options.storeFile ?? null;
    this.load();
  }

  private load(): void {
    if (!this.storeFile || !existsSync(this.storeFile)) return;
    try {
      const rows = JSON.parse(readFileSync(this.storeFile, 'utf8')) as TaskRecord[];
      for (const task of rows) {
        if (!task || typeof task.id !== 'string') continue;
        if (task.status === 'running' || task.status === 'scanning' || task.status === 'queued') {
          task.status = 'failed';
          task.error = '服务重启中断';
          task.queuePosition = null;
        }
        this.tasks.set(task.id, task);
      }
      this.prune();
      this.save();
    } catch { /* ignore corrupt task store */ }
  }

  private save(): void {
    if (!this.storeFile) return;
    try { writeFileSync(this.storeFile, JSON.stringify([...this.tasks.values()]), 'utf8'); } catch { /* best effort */ }
  }

  create(userId: number, type: TaskRecord['type'], initialStatus: TaskStatus, payload?: unknown): TaskRecord {
    this.prune();
    const now = this.now();
    const task: TaskRecord = {
      id: randomUUID(),
      userId,
      type,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
      payload,
      queuePosition: initialStatus === 'queued' ? 1 : null,
      residualPaths: [],
    };
    this.tasks.set(task.id, task);
    this.save();
    return { ...task };
  }

  update(
    id: string,
    patch: { status?: TaskStatus; result?: unknown; error?: string | null; progress?: number; queuePosition?: number | null; residualPaths?: string[] },
  ): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.result !== undefined) task.result = patch.result;
    if (patch.error !== undefined) task.error = patch.error;
    if (patch.progress !== undefined) task.progress = patch.progress;
    if (patch.queuePosition !== undefined) task.queuePosition = patch.queuePosition;
    if (patch.residualPaths !== undefined) task.residualPaths = patch.residualPaths;
    task.updatedAt = this.now();
    this.save();
    return { ...task };
  }

  getForUser(id: string, userId: number): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task || task.userId !== userId) return null;
    return { ...task };
  }

  listForUser(userId: number, limit = 20): TaskRecord[] {
    this.prune();
    return [...this.tasks.values()]
      .filter((task) => task.userId === userId && task.hidden !== true)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(20, limit)))
      .map((task) => ({ ...task }));
  }

  registerCancel(id: string, handler: () => void): void {
    this.cancelHandlers.set(id, handler);
  }

  unregisterCancel(id: string): void {
    this.cancelHandlers.delete(id);
  }

  cancel(id: string, userId: number): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task || task.userId !== userId) return null;
    this.cancelHandlers.get(id)?.();
    this.cancelHandlers.delete(id);
    task.status = 'cancelled';
    task.updatedAt = this.now();
    this.save();
    return { ...task };
  }

  pause(id: string, userId: number): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task || task.userId !== userId) return null;
    if (task.status === 'queued' || task.status === 'pending') task.status = 'paused';
    else if (task.status === 'running' || task.status === 'scanning') {
      this.cancelHandlers.get(id)?.();
      this.cancelHandlers.delete(id);
      task.status = 'paused';
    }
    else return { ...task };
    task.updatedAt = this.now();
    this.save();
    return { ...task };
  }

  cancelAllForUser(userId: number): number {
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.userId !== userId) continue;
      this.cancelHandlers.get(id)?.();
      this.cancelHandlers.delete(id);
      if (task.status === 'running' || task.status === 'scanning' || task.status === 'queued' || task.status === 'pending') {
        task.status = 'cancelled';
        task.error = '页面退出取消';
      }
      task.hidden = true;
      task.queuePosition = null;
      task.updatedAt = this.now();
      removed += 1;
    }
    this.save();
    return removed;
  }

  listResidual(): TaskRecord[] {
    return [...this.tasks.values()]
      .filter((task) => (task.status === 'failed' || task.status === 'cancelled') && (task.residualPaths?.length ?? 0) > 0)
      .map((task) => ({ ...task }));
  }

  clearResidual(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.residualPaths = [];
    task.updatedAt = this.now();
    this.save();
  }

  clearForUser(userId: number): number {
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.userId === userId) { this.tasks.delete(id); removed += 1; }
    }
    this.save();
    return removed;
  }

  featureUsage(): Record<'extract' | 'scan' | 'compress', { users: number; running: number; queued: number; paused: number }> {
    const result = {
      extract: { users: new Set<number>(), running: 0, queued: 0, paused: 0 },
      scan: { users: new Set<number>(), running: 0, queued: 0, paused: 0 },
      compress: { users: new Set<number>(), running: 0, queued: 0, paused: 0 },
    };
    for (const task of this.tasks.values()) {
      if (task.type === 'upload') continue;
      const bucket = result[task.type];
      if (task.status === 'running' || task.status === 'scanning') { bucket.running += 1; bucket.users.add(task.userId); }
      else if (task.status === 'queued' || task.status === 'pending') { bucket.queued += 1; bucket.users.add(task.userId); }
      else if (task.status === 'paused') bucket.paused += 1;
    }
    return {
      extract: { ...result.extract, users: result.extract.users.size },
      scan: { ...result.scan, users: result.scan.users.size },
      compress: { ...result.compress, users: result.compress.users.size },
    } as Record<'extract' | 'scan' | 'compress', { users: number; running: number; queued: number; paused: number }>;
  }

  stats(): { running: number; queued: number; paused: number } {
    this.prune();
    const result = { running: 0, queued: 0, paused: 0 };
    for (const task of this.tasks.values()) {
      if (task.status === 'running' || task.status === 'scanning') result.running += 1;
      else if (task.status === 'queued' || task.status === 'pending') result.queued += 1;
      else if (task.status === 'paused') result.paused += 1;
    }
    return result;
  }

  private prune(): void {
    const cutoff = this.now() - TASK_TTL_MS;
    for (const [id, task] of this.tasks) {
      if (task.updatedAt < cutoff) this.tasks.delete(id);
    }
  }
}
