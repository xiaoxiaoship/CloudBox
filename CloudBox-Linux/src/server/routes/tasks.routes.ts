import { Router } from 'express';
import type { CoreServices } from '../../core/container.ts';

export function createTasksRouter(services: CoreServices): Router {
  const router = Router();

  router.get('/:taskId', (req, res) => {
    const task = services.tasks.getForUser(req.params.taskId ?? '', req.user!.id);
    if (task === null) {
      res.status(404).json({ code: 'TASK_NOT_FOUND', message: '任务不存在' });
      return;
    }
    res.json(task);
  });

  return router;
}
