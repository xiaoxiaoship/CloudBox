import type { SessionUser } from '../../core/types/models.ts';

declare global {
  namespace Express {
    interface Request {
      /** 由 requireUser 中间件注入；未认证路由上为 undefined */
      user?: SessionUser;
    }
  }
}

export {};
