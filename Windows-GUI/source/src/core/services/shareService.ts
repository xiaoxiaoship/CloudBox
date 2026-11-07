import { randomBytes } from 'node:crypto';
import type { ShareRepository, ShareRecord } from '../db/repositories/shareRepo.ts';
import type { UserRepository } from '../db/repositories/userRepo.ts';
import { toSessionUser, type SessionUser } from '../types/models.ts';
import type { AuditService } from './auditService.ts';
import type {
  DownloadTarget,
  FileService,
  RequestContext,
} from './fileService.ts';

export const SHARE_ERROR = {
  NOT_FOUND: 'SHARE_NOT_FOUND',
  EXPIRED: 'SHARE_EXPIRED',
  USER_INVALID: 'SHARE_USER_INVALID',
} as const;

export type ShareErrorCode = (typeof SHARE_ERROR)[keyof typeof SHARE_ERROR];

export class ShareError extends Error {
  readonly code: ShareErrorCode;
  readonly httpStatus: number;

  constructor(code: ShareErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'ShareError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface CreatedShare {
  share: ShareRecord;
  filePath: string;
  token: string;
  expiresAt: number;
}

/**
 * 分享服务：
 *  - 创建时复用 FileService.inspectFile → resolveUserPath 校验文件真实存在且不越界
 *  - 下载时复用 FileService.openDownload → 现有 Range 流式下载
 *  - storage_key 使用创建时的快照，用户目录变化后也不会指向其他目录
 */
export class ShareService {
  private readonly shares: ShareRepository;
  private readonly users: UserRepository;
  private readonly files: FileService;
  private readonly audit: AuditService;
  private readonly now: () => number;

  constructor(options: {
    shares: ShareRepository;
    users: UserRepository;
    files: FileService;
    audit: AuditService;
    now?: () => number;
  }) {
    this.shares = options.shares;
    this.users = options.users;
    this.files = options.files;
    this.audit = options.audit;
    this.now = options.now ?? Date.now;
  }

  async create(
    user: SessionUser,
    filePath: string,
    durationSeconds: number,
    ctx: RequestContext,
  ): Promise<CreatedShare> {
    const target = await this.files.inspectFile(user, filePath, ctx, 'share.create');
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = now + durationSeconds * 1_000;

    const share = this.shares.create({
      token,
      userId: user.id,
      storageKey: user.storageKey,
      filePath: target.relativePath,
      expiresAt,
      createdAt: now,
    });

    this.audit.record({
      actorType: ctx.actor?.type ?? (user.role === 'admin' ? 'admin' : 'user'),
      actorId: ctx.actor?.id ?? user.id,
      action: 'share.create',
      result: 'success',
      targetType: 'share',
      targetId: String(share.id),
      targetPath: share.filePath,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
      detail: { durationSeconds, expiresAt },
    });

    return {
      share,
      filePath: target.relativePath,
      token,
      expiresAt,
    };
  }

  async resolveDownload(token: string, ctx: RequestContext): Promise<DownloadTarget> {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
      throw new ShareError(SHARE_ERROR.NOT_FOUND, '分享链接不存在', 404);
    }

    const share = this.shares.findByToken(token);
    if (share === null) {
      throw new ShareError(SHARE_ERROR.NOT_FOUND, '分享链接不存在', 404);
    }

    if (this.now() > share.expiresAt) {
      throw new ShareError(SHARE_ERROR.EXPIRED, '分享链接已过期', 410);
    }

    const user = this.users.findById(share.userId);
    if (user === null || user.storageKey !== share.storageKey) {
      throw new ShareError(SHARE_ERROR.NOT_FOUND, '分享链接对应的用户不存在', 404);
    }

    const target = await this.files.openDownload(toSessionUser(user), share.filePath, ctx);

    this.audit.record({
      actorType: 'anonymous',
      actorId: null,
      action: 'share.download',
      result: 'success',
      targetType: 'share',
      targetId: String(share.id),
      targetPath: share.filePath,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
      detail: { size: target.size },
    });

    return target;
  }
}
