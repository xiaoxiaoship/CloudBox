import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CoreServices } from '../container.ts';
import { normalizeRelativePath, resolveUserPath } from '../security/safePath.ts';

export interface CacheCleanupResult {
  removedFiles: number;
  removedLogs: number;
}

/**
 * Remove transient upload/cache files and trim audit data to the configured
 * log budget. Shared by the manual button and the automatic scheduler.
 */
export async function clearResourceCache(services: CoreServices): Promise<CacheCleanupResult> {
  let removedFiles = 0;
  const cutoff = Date.now() - 60 * 60_000;
  const tempDir = services.files.getTempDir();
  try {
    for (const row of await readdir(tempDir, { withFileTypes: true })) {
      if (!row.isFile() || !row.name.endsWith('.part')) continue;
      const target = path.join(tempDir, row.name);
      try {
        if ((await stat(target)).mtimeMs > cutoff) continue;
        await rm(target, { force: true });
        removedFiles += 1;
      } catch { /* ignore per-file races */ }
    }
  } catch { /* temp dir may not exist */ }

  const residualTasks = services.tasks.listResidual();
  for (const task of residualTasks) {
    const user = services.users.findById(task.userId);
    if (!user) { services.tasks.clearResidual(task.id); continue; }
    const root = path.join(services.files.getStorageRoot(), user.storageKey);
    for (const raw of task.residualPaths ?? []) {
      try {
        const relative = normalizeRelativePath(raw);
        if (relative === '') continue;
        const absolute = resolveUserPath(root, relative).absolutePath;
        await rm(absolute, { recursive: true, force: true });
        removedFiles += 1;
      } catch { /* path outside user root or already gone */ }
    }
    services.tasks.clearResidual(task.id);
  }

  services.audit.pruneBefore(Date.now() - 30 * 24 * 60 * 60_000);
  const removedLogs = services.audit.trimToBytes(
    services.settings.get('maxLogSizeMB') * 1024 * 1024,
  );
  services.audit.record({
    actorType: 'system',
    actorId: null,
    action: 'system.cache.cleanup',
    result: 'success',
    targetType: 'system',
    targetId: null,
    ip: null,
    userAgent: null,
    requestId: null,
    detail: { removedFiles, removedLogs, residualTasks: residualTasks.length },
  });
  return { removedFiles, removedLogs };
}
