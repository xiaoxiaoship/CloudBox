import { Router } from 'express';
import { pingDatabase, type Db } from '../../core/db/connection.ts';

export interface HealthRouterDeps {
  db: Db;
  version: string;
}

/**
 * GET /health
 * 无鉴权、无敏感信息；数据库不可用时返回 503，便于进程守护/托盘状态灯判断。
 */
export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const databaseOk = pingDatabase(deps.db);

    res.status(databaseOk ? 200 : 503).json({
      status: databaseOk ? 'ok' : 'degraded',
      service: 'cloudbox',
      version: deps.version,
      uptimeSeconds: Math.round(process.uptime()),
      database: databaseOk ? 'ok' : 'error',
      time: new Date().toISOString(),
    });
  });

  return router;
}
