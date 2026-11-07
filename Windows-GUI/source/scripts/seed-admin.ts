#!/usr/bin/env node
/**
 * 管理员初始化 / 应急重置脚本。
 *
 *   node scripts/seed-admin.ts                    # 交互式创建初始管理员
 *   node scripts/seed-admin.ts --username boss    # 指定用户名
 *   node scripts/seed-admin.ts --reset            # 重置现有管理员密码并解锁
 *   node scripts/seed-admin.ts --help
 *
 * 安全约定：密码只从 stdin 读取，仅在内存中参与 scrypt 派生，
 * 数据库中只写入 scrypt 哈希；脚本不写日志文件、不产生命令行历史。
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { closeDatabase, openDatabase } from '../src/core/db/connection.ts';
import { migrate } from '../src/core/db/migrator.ts';
import { AuditRepository } from '../src/core/db/repositories/auditRepo.ts';
import { QuotaRepository } from '../src/core/db/repositories/quotaRepo.ts';
import { SessionRepository } from '../src/core/db/repositories/sessionRepo.ts';
import { SettingsRepository } from '../src/core/db/repositories/settingsRepo.ts';
import { UserRepository } from '../src/core/db/repositories/userRepo.ts';
import { checkPasswordStrength, hashPassword } from '../src/core/security/password.ts';
import { AuditService } from '../src/core/services/auditService.ts';
import { AuthService } from '../src/core/services/authService.ts';
import { SettingsService } from '../src/core/services/settingsService.ts';
import { loadServerConfig } from '../src/server/config.ts';

class CancelledError extends Error {
  constructor() {
    super('用户取消');
    this.name = 'CancelledError';
  }
}

class Prompter {
  private rl: Interface | null = null;
  private readonly queue: string[] = [];
  private readonly waiters: Array<(line: string) => void> = [];
  private closed = false;

  /**
   * 行队列：readline 的 'line' 事件可能一次涌入多行（管道输入），
   * 必须缓冲后按需取用，不能依赖多次 question() 的时序。
   */
  private ensureLineReader(): void {
    if (this.rl !== null) return;

    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    this.rl.on('line', (line) => {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        this.queue.push(line);
      }
    });
    this.rl.on('close', () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) waiter('');
    });
  }

  private nextLine(): Promise<string> {
    this.ensureLineReader();

    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve('');

    return new Promise<string>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async ask(question: string): Promise<string> {
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    }

    process.stdout.write(question);
    const answer = (await this.nextLine()).trim();
    process.stdout.write(`${answer}\n`);
    return answer;
  }

  async askHidden(question: string): Promise<string> {
    if (!process.stdin.isTTY) {
      // 非 TTY 无法隐藏回显（输入本就来自管道），只回显占位符
      process.stdout.write(question);
      const answer = (await this.nextLine()).trim();
      process.stdout.write('********\n');
      return answer;
    }

    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    return await new Promise<string>((resolve, reject) => {
      let value = '';

      const cleanup = (): void => {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
      };

      const onData = (chunk: string): void => {
        for (const char of chunk) {
          if (char === '\u0003') {
            cleanup();
            process.stdout.write('\n');
            reject(new CancelledError());
            return;
          }
          if (char === '\r' || char === '\n') {
            cleanup();
            process.stdout.write('\n');
            resolve(value);
            return;
          }
          if (char === '\u007f' || char === '\b') {
            if (value.length > 0) {
              value = value.slice(0, -1);
              process.stdout.write('\b \b');
            }
            continue;
          }
          if (char >= ' ') {
            value += char;
            process.stdout.write('*');
          }
        }
      };

      process.stdin.on('data', onData);
    });
  }

  close(): void {
    this.rl?.close();
    this.rl = null;
  }
}

function normalizeAdminUsername(value: string): string {
  const username = value.trim();
  if (!/^[^\s/\\:*?"<>|]{1,64}$/u.test(username)) {
    throw new Error('用户名不合法：1-64 个字符，不能包含空格及 / \\ : * ? " < > |');
  }
  return username;
}

async function readAdminPassword(prompter: Prompter): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const password = await prompter.askHidden(
      attempt === 1 ? '请输入管理员密码（输入不回显）: ' : '密码不符合要求，请重试: ',
    );

    if (password.length === 0) {
      console.log('密码不能为空。');
      continue;
    }

    const confirm = await prompter.askHidden('请再次输入密码以确认: ');
    if (password !== confirm) {
      console.log('两次输入不一致。');
      continue;
    }

    const strength = checkPasswordStrength(password);
    if (!strength.ok) {
      console.log(`密码强度不足：${strength.issues.join('；')}`);
      continue;
    }

    return password;
  }

  return null;
}

function printHelp(): void {
  console.log(`CloudBox 管理员初始化脚本

用法:
  node scripts/seed-admin.ts [选项]

选项:
  --username <name>   指定管理员用户名（默认交互式输入，建议 admin）
  --reset             重置已有管理员密码并解锁账户、强制下线所有会话
  --help              显示帮助

说明:
  - 单管理员模式：数据库中已存在管理员时，创建会被拒绝
  - 密码要求：至少 8 位，包含字母和数字
  - 密码仅以 scrypt 哈希写入 SQLite，明文不会落盘`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const config = loadServerConfig();
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.storageRoot, { recursive: true });

  const db = openDatabase({ file: config.dbFile });
  const prompter = new Prompter();

  try {
    const report = migrate(db);
    if (report.applied.length > 0) {
      console.log(`已应用数据库迁移：${report.applied.join(', ')}`);
    }

    const users = new UserRepository(db);
    const quotas = new QuotaRepository(db);
    const sessions = new SessionRepository(db);
    const settings = new SettingsService(new SettingsRepository(db));
    const audit = new AuditService(new AuditRepository(db));
    const auth = new AuthService({ users, sessions, settings, audit });

    const admin = users.findAdmin();

    if (admin !== null && !values.reset) {
      console.error(
        `检测到管理员 "${admin.username}" 已存在。\n如需重置密码，请执行：node scripts/seed-admin.ts --reset`,
      );
      return 1;
    }
    if (admin === null && values.reset) {
      console.error('尚未创建管理员，无法执行 --reset。请先不带 --reset 运行本脚本。');
      return 1;
    }

    let username: string;
    if (admin !== null) {
      username = admin.username;
      console.log(`即将重置管理员 "${username}" 的密码。`);
    } else {
      const input = values.username ?? (await prompter.ask('管理员用户名 [admin]: '));
      username = normalizeAdminUsername(input.length > 0 ? input : 'admin');

      if (users.findByUsername(username) !== null) {
        console.error(`用户名 "${username}" 已被占用（可能是普通用户），请换一个。`);
        return 1;
      }
    }

    const password = await readAdminPassword(prompter);
    if (password === null) {
      console.error('连续 3 次未通过密码校验，已取消。');
      return 1;
    }

    if (admin !== null) {
      await auth.resetPassword({
        userId: admin.id,
        newPassword: password,
        mustChangePassword: false,
        actorType: 'system',
        context: { userAgent: 'cloudbox-seed-cli' },
      });
      console.log(`✔ 已重置管理员 "${admin.username}" 的密码，账户已解锁，所有旧会话已失效。`);
    } else {
      const passwordHash = await hashPassword(password);
      const now = Date.now();

      const created = db.transaction(() => {
        const user = users.create({
          storageKey: randomUUID(),
          username,
          displayName: username,
          passwordHash,
          role: 'admin',
          createdAt: now,
        });
        // 管理员不限量；同时保证 quotas 行存在，后续逻辑无需判空
        quotas.ensure(user.id, null, now);
        return user;
      })();

      mkdirSync(path.join(config.storageRoot, created.storageKey), { recursive: true });

      audit.record({
        actorType: 'system',
        action: 'user.create',
        result: 'success',
        targetType: 'user',
        targetId: String(created.id),
        detail: { username: created.username, role: 'admin', source: 'seed-cli' },
      });

      console.log(`✔ 已创建管理员 "${created.username}"（id=${created.id}）。`);
    }

    console.log(`数据库：${config.dbFile}`);
    console.log('密码仅以 scrypt 哈希写入数据库，明文未落盘。');
    return 0;
  } finally {
    prompter.close();
    closeDatabase(db);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof CancelledError) {
      console.error('\n已取消。');
      process.exitCode = 130;
      return;
    }
    console.error(`执行失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
