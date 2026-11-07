import { randomUUID } from 'node:crypto';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'scanning'
  | 'clean'
  | 'infected'
  | 'completed'
  | 'failed';

export interface TaskRecord {
  id: string;
  userId: number;
  type: 'extract' | 'scan';
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  result: unknown;
  error: string | null;
}

const TASK_TTL_MS = 60 * 60 * 1_000;

/** 进程内异步任务注册表；应用重启后任务自然失效。 */
export class TaskService {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  create(userId: number, type: TaskRecord['type'], initialStatus: TaskStatus): TaskRecord {
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
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  update(
    id: string,
    patch: { status?: TaskStatus; result?: unknown; error?: string | null },
  ): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.result !== undefined) task.result = patch.result;
    if (patch.error !== undefined) task.error = patch.error;
    task.updatedAt = this.now();
    return { ...task };
  }

  getForUser(id: string, userId: number): TaskRecord | null {
    const task = this.tasks.get(id);
    if (!task || task.userId !== userId) return null;
    return { ...task };
  }

  private prune(): void {
    const cutoff = this.now() - TASK_TTL_MS;
    for (const [id, task] of this.tasks) {
      if (task.updatedAt < cutoff) this.tasks.delete(id);
    }
  }
}
