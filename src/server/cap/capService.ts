import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  generateChallenge,
  validateChallenge,
  type ValidateChallengeBody,
} from 'capjs-core';
import type { Request } from 'express';
import type { SettingsService } from '../../core/services/settingsService.ts';

export const CAP_HEADER = 'x-cap-token';

export class CapError extends Error {
  readonly reason: string;

  constructor(reason: string, message = 'Cap verification failed') {
    super(message);
    this.name = 'CapError';
    this.reason = reason;
  }
}

interface TokenPayload {
  scope: string | null;
  expires: number;
  iat?: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Small in-process implementation of Cap's server side. Challenges are
 * stateless JWT-like blobs signed by capjs-core; only the consumed nonce is
 * kept in memory, which is enough to stop replaying the same solution.
 */
export class CapService {
  private readonly settings: SettingsService;
  private readonly consumedNonces = new Map<string, number>();
  private readonly challengeMarks = new Map<string, number>();

  constructor(settings: SettingsService) {
    this.settings = settings;
  }

  enabled(): boolean {
    return this.settings.get('security.capEnabled');
  }

  loginThreshold(): number {
    return this.settings.get('security.capLoginFailures');
  }

  registrationLimit(): number {
    return this.settings.get('security.capRegistrationLimit');
  }

  shareLimit(): number {
    return this.settings.get('security.capShareLimit');
  }

  async challenge(): Promise<{
    token: string;
    format: 2;
    challenges: Array<{ protocol: string; payload: Record<string, unknown> }>;
    expires: number;
  }> {
    if (!this.enabled()) throw new CapError('disabled', 'Cap is disabled');
    const result = await generateChallenge(this.secret(), {
      format: 2,
      protocols: ['sha256-pow'],
      challengeCount: 8,
      challengeSize: 32,
      challengeDifficulty: 4,
      expiresMs: 5 * 60_000,
      scope: 'cloudbox',
    });
    return result as {
      token: string;
      format: 2;
      challenges: Array<{ protocol: string; payload: Record<string, unknown> }>;
      expires: number;
    };
  }

  async redeem(body: ValidateChallengeBody): Promise<{ token: string; expires: number }> {
    if (!this.enabled()) throw new CapError('disabled', 'Cap is disabled');
    const result = await validateChallenge(this.secret(), body, {
      scope: 'cloudbox',
      tokenTtlMs: 10 * 60_000,
      consumeNonce: (signatureHex, ttlMs) => this.consume(signatureHex, ttlMs),
      signToken: (data) => this.signToken(data),
    });
    if (!result.success) throw new CapError(result.reason, 'Challenge validation failed');
    return { token: result.token, expires: result.expires };
  }

  needsChallenge(key: string, level: number): boolean {
    if (level <= 0) return false;
    return (this.challengeMarks.get(key) ?? 0) < level;
  }

  markChallengePassed(key: string, level: number): void {
    if (level > 0) this.challengeMarks.set(key, Math.max(this.challengeMarks.get(key) ?? 0, level));
  }

  clearAccountMark(userId: number): void {
    this.challengeMarks.delete(`account:${userId}`);
  }

  clearIpMark(ip: string): void {
    this.challengeMarks.delete(`ip:${ip}`);
  }

  hasValidToken(req: Request): boolean {
    const raw = req.get(CAP_HEADER);
    return raw !== undefined && this.verifyToken(raw) !== null;
  }

  requireResponse(): { code: string; action: string; message: string } {
    return {
      code: 'CAP_REQUIRED',
      action: 'cap_required',
      message: '请完成人机验证后再继续',
    };
  }

  verifyToken(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payloadPart = parts[0] ?? '';
    const signaturePart = parts[1] ?? '';
    const expected = createHmac('sha256', this.secret()).update(payloadPart).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signaturePart, 'base64url');
    } catch {
      return null;
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as TokenPayload;
      if (typeof payload.expires !== 'number' || payload.expires <= Date.now()) return null;
      if (payload.scope !== null && payload.scope !== 'cloudbox') return null;
      return payload;
    } catch {
      return null;
    }
  }

  private secret(): string {
    return this.settings.get('security.capSecret');
  }

  private consume(signatureHex: string, ttlMs: number): boolean {
    const now = Date.now();
    for (const [key, expires] of this.consumedNonces) {
      if (expires <= now) this.consumedNonces.delete(key);
    }
    if (this.consumedNonces.has(signatureHex)) return false;
    this.consumedNonces.set(signatureHex, now + Math.max(1_000, ttlMs));
    return true;
  }

  private signToken(data: TokenPayload): string {
    const payloadPart = b64url(JSON.stringify(data));
    const signature = createHmac('sha256', this.secret()).update(payloadPart).digest();
    return `${payloadPart}.${b64url(signature)}`;
  }
}

export function createCapService(settings: SettingsService): CapService {
  return new CapService(settings);
}
