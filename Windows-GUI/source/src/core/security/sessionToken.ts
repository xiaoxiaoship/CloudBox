import { createHash, randomBytes } from 'node:crypto';

/** 32 字节随机数 → base64url，长度固定 43 字符 */
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 生成一次性返回给客户端的原始 token（绝不入库，库里只存哈希） */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** 会话 ID 哈希：SHA-256 十六进制，数据库泄露也无法直接伪造 Cookie */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isSessionTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && SESSION_TOKEN_PATTERN.test(token);
}
