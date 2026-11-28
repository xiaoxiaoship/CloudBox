import { Router } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { requestContext } from '../http/context.ts';
import type { TaskRecord } from '../../core/services/taskService.ts';

function publicTask(task: TaskRecord): TaskRecord {
  if (task.payload === null || typeof task.payload !== 'object') return task;
  const { password: _password, ...payload } = task.payload as Record<string, unknown>;
  return { ...task, payload };
}

export function createTasksRouter(services: CoreServices): Router {
  const router = Router();

  router.post('/cancel-all', (req, res) => {
    res.json({ removed: services.tasks.cancelAllForUser(req.user!.id) });
  });

  router.get('/stats', (_req, res) => {
    res.json(services.tasks.stats());
  });

  router.get('/usage', (_req, res) => {
    res.json(services.tasks.featureUsage());
  });

  router.get('/', (req, res) => {
    res.json(services.tasks.listForUser(req.user!.id, 20).map(publicTask));
  });

  router.delete('/', (req, res) => {
    res.json({ removed: services.tasks.clearForUser(req.user!.id) });
  });

  router.post('/:taskId/restart', async (req, res) => {
    const task = services.tasks.getForUser(req.params.taskId ?? '', req.user!.id);
    if (!task) { res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' }); return; }
    if (task.type === 'upload') { res.status(409).json({ code: 'TASK_NOT_RESTARTABLE', message: '上传任务请重新选择文件上传' }); return; }
    if (task.payload === undefined) { res.status(409).json({ code: 'TASK_NOT_RESTARTABLE', message: '该任务不支持重新开始' }); return; }
    if (task.type === 'compress') {
      const payload = task.payload as { paths: string[]; targetDir: string; archiveName: string; level: number; password?: string };
      res.status(202).json(await services.compression.start(req.user!, payload, requestContext(req, res)));
      return;
    }
    if (task.type === 'extract') {
      const payload = task.payload as { filePath: string; targetDir: string; password?: string };
      res.status(202).json(await services.extraction.start(req.user!, payload.filePath, payload.targetDir, requestContext(req, res), payload.password));
      return;
    }
    const payload = task.payload as { path: string };
    res.status(202).json(await services.scan.start(req.user!, payload.path, requestContext(req, res)));
  });

  router.post('/:taskId/cancel', (req, res) => {
    const task = services.tasks.cancel(req.params.taskId ?? '', req.user!.id);
    if (!task) { res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' }); return; }
    res.json(publicTask(task));
  });

  router.post('/:taskId/pause', (req, res) => {
    const task = services.tasks.pause(req.params.taskId ?? '', req.user!.id);
    if (!task) { res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' }); return; }
    res.json(publicTask(task));
  });

  router.get('/:taskId', (req, res) => {
    const task = services.tasks.getForUser(req.params.taskId ?? '', req.user!.id);
    if (task === null) {
      res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' });
      return;
    }
    res.json(publicTask(task));
  });

  return router;
}
