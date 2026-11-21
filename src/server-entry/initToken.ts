import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listLanIps } from '../main/serverController.ts';

export const INIT_TOKEN_TTL_MS = 24 * 60 * 60_000;

interface StoredToken {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
}

export interface InitTokenResult {
  required: boolean;
  token: string | null;
  url: string | null;
  expiresAt: number | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class InitTokenService {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'config', 'admin-init-token.json');
    mkdirSync(path.dirname(this.file), { recursive: true });
  }

  get path(): string {
    return this.file;
  }

  /** Called on startup. Only prints a token when a new one is generated. */
  ensure(needsSetup: boolean, port: number): InitTokenResult {
    if (!needsSetup) {
      this.clear();
      return { required: false, token: null, url: null, expiresAt: null };
    }

    const existing = this.read();
    if (existing !== null && existing.expiresAt > Date.now()) {
      return { required: true, token: null, url: null, expiresAt: existing.expiresAt };
    }

    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const stored: StoredToken = {
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: now + INIT_TOKEN_TTL_MS,
    };
    writeFileSync(this.file, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(this.file, 0o600); } catch { /* Windows ACL */ }

    const host = listLanIps()[0] ?? '127.0.0.1';
    return {
      required: true,
      token,
      url: `http://${host}:${port}/setup?token=${encodeURIComponent(token)}`,
      expiresAt: stored.expiresAt,
    };
  }

  verify(token: string): boolean {
    const stored = this.read();
    if (stored === null || stored.expiresAt <= Date.now()) return false;
    return safeEqualHex(stored.tokenHash, hashToken(token));
  }

  consume(): void {
    this.clear();
  }

  private read(): StoredToken | null {
    if (!existsSync(this.file)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredToken>;
      if (
        typeof raw.tokenHash !== 'string' ||
        typeof raw.createdAt !== 'number' ||
        typeof raw.expiresAt !== 'number'
      ) {
        return null;
      }
      return { tokenHash: raw.tokenHash, createdAt: raw.createdAt, expiresAt: raw.expiresAt };
    } catch {
      return null;
    }
  }

  private clear(): void {
    try { rmSync(this.file, { force: true }); } catch { /* ignore */ }
  }
}
