import { ADMIN_ERROR, AdminError } from '../core/services/adminUserService.ts';
import { AUTH_ERROR, AuthError, type AuthService } from '../core/services/authService.ts';
import { toPublicUser, type PublicUser } from '../core/types/models.ts';

/**
 * 管理员会话只存在于主进程内存中，渲染层永远拿不到原始 token。
 * 所有特权 IPC 都通过 require() 重新校验会话（含角色与过期时间）。
 */
export class AdminSession {
  private readonly auth: AuthService;
  private token: string | null = null;

  constructor(auth: AuthService) {
    this.auth = auth;
  }

  async login(username: string, password: string): Promise<PublicUser> {
    const result = await this.auth.login({
      username,
      password,
      userAgent: 'cloudbox-desktop',
    });

    if (result.user.role !== 'admin') {
      this.auth.logout(result.token);
      throw new AdminError(ADMIN_ERROR.FORBIDDEN, '该账户不是管理员');
    }

    this.token = result.token;
    return result.user;
  }

  current(): PublicUser | null {
    if (this.token === null) return null;

    try {
      const session = this.auth.validateSession(this.token);
      if (session.user.role !== 'admin') return null;
      return toPublicUser(session.user);
    } catch {
      this.token = null;
      return null;
    }
  }

  require(): PublicUser {
    const user = this.current();
    if (user === null) {
      throw new AuthError(AUTH_ERROR.SESSION_INVALID, '管理员会话已失效，请重新登录', 401);
    }
    return user;
  }

  logout(): void {
    if (this.token !== null) {
      this.auth.logout(this.token);
    }
    this.token = null;
  }
}
