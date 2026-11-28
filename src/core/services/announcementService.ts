import type { AnnouncementCategory, AnnouncementRepository, AnnouncementView } from '../db/repositories/announcementRepo.ts';
import type { UserRepository } from '../db/repositories/userRepo.ts';

export class AnnouncementService {
  private readonly repo: AnnouncementRepository;
  private readonly users: UserRepository;
  private readonly now: () => number;
  constructor(options: { repo: AnnouncementRepository; users: UserRepository; now?: () => number }) {
    this.repo = options.repo;
    this.users = options.users;
    this.now = options.now ?? Date.now;
  }

  create(authorId: number, input: { category: AnnouncementCategory; audience: 'all' | 'user'; targetUserId?: number | null; body: string }): AnnouncementView {
    const body = input.body.trim();
    if (body.length === 0) throw new Error('公告内容不能为空');
    if (input.audience === 'user') {
      if (!Number.isSafeInteger(input.targetUserId) || this.users.findById(input.targetUserId!) === null) {
        throw new Error('公告目标用户不存在');
      }
    }
    const record = this.repo.create({
      authorId,
      category: input.category,
      audience: input.audience,
      targetUserId: input.audience === 'user' ? input.targetUserId! : null,
      body,
      createdAt: this.now(),
    });
    return { ...record, read: false, targetUsername: null };
  }

  listForUser(userId: number): { items: AnnouncementView[]; unread: number } {
    return { items: this.repo.listForUser(userId), unread: this.repo.unreadCount(userId) };
  }

  listAll(): AnnouncementView[] { return this.repo.listAll(); }

  delete(id: number): boolean { return this.repo.delete(id); }

  markAllRead(userId: number): void { this.repo.markAllRead(userId, this.now()); }
  markRead(announcementId: number, userId: number): void { this.repo.markRead(announcementId, userId, this.now()); }
}
