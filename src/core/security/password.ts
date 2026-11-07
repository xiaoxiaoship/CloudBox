import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export interface ScryptParams {
  /** CPU/内存代价，必须是 2 的幂 */
  N: number;
  /** 块大小 */
  r: number;
  /** 并行度 */
  p: number;
  /** 派生密钥长度（字节） */
  keylen: number;
}

/**
 * 默认参数：N=32768, r=8, p=1。
 * 内存占用约 128 * N * r = 32 MiB，单次哈希 ~50ms（现代桌面 CPU），
 * 对本地网盘登录足够，且能有效抵抗离线爆破。
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = Object.freeze({
  N: 32_768,
  r: 8,
  p: 1,
  keylen: 64,
});

const SCHEME = 'scrypt';
const VERSION = 'v1';
const SALT_BYTES = 16;
const HASH_FORMAT_PARTS = 7;

const MIN_N = 1 << 14;
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 4;
const MIN_KEYLEN = 32;
const MAX_KEYLEN = 128;

/** 参数变更（或算法升级）后用于判断是否需要重新哈希 */
export function needsRehash(storedHash: string): boolean {
  const parsed = parsePasswordHash(storedHash);
  if (parsed === null) return true;
  const current = DEFAULT_SCRYPT_PARAMS;
  return (
    parsed.params.N !== current.N ||
    parsed.params.r !== current.r ||
    parsed.params.p !== current.p ||
    parsed.params.keylen !== current.keylen
  );
}

interface ParsedPasswordHash {
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

function isValidScryptParams(params: ScryptParams): boolean {
  return (
    Number.isInteger(params.N) &&
    (params.N & (params.N - 1)) === 0 &&
    params.N >= MIN_N &&
    params.N <= MAX_N &&
    Number.isInteger(params.r) &&
    params.r >= 1 &&
    params.r <= MAX_R &&
    Number.isInteger(params.p) &&
    params.p >= 1 &&
    params.p <= MAX_P &&
    Number.isInteger(params.keylen) &&
    params.keylen >= MIN_KEYLEN &&
    params.keylen <= MAX_KEYLEN
  );
}

/**
 * 解析 `scrypt$v1$N$r$p$saltB64url$hashB64url`。
 * 任何格式异常都返回 null（调用方统一按"验证失败"处理，不泄露内部细节）。
 */
export function parsePasswordHash(storedHash: string): ParsedPasswordHash | null {
  if (typeof storedHash !== 'string') return null;

  const parts = storedHash.split('$');
  if (parts.length !== HASH_FORMAT_PARTS) return null;

  const [scheme, version, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (scheme !== SCHEME || version !== VERSION) return null;

  const params: ScryptParams = {
    N: Number(rawN),
    r: Number(rawR),
    p: Number(rawP),
    keylen: 0,
  };
  if (!isValidScryptParams({ ...params, keylen: DEFAULT_SCRYPT_PARAMS.keylen })) return null;

  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(rawSalt ?? '', 'base64url');
    hash = Buffer.from(rawHash ?? '', 'base64url');
  } catch {
    return null;
  }

  if (salt.length !== SALT_BYTES || hash.length < MIN_KEYLEN || hash.length > MAX_KEYLEN) {
    return null;
  }

  params.keylen = hash.length;
  return { params, salt, hash };
}

function deriveKey(
  password: string,
  salt: Buffer,
  params: ScryptParams,
): Promise<Buffer> {
  // 128 * N * r 是 scrypt 的内存需求；maxmem 留 2 倍余量，否则 OpenSSL 直接报错
  const maxmem = 128 * params.N * params.r * 2;
  return scrypt(password.normalize('NFC'), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem,
  });
}

/** 生成密码哈希；格式自带参数与版本号，便于未来平滑升级 */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('密码不能为空');
  }
  if (!isValidScryptParams(params)) {
    throw new Error('非法的 scrypt 参数');
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await deriveKey(password, salt, params);

  return [
    SCHEME,
    VERSION,
    params.N,
    params.r,
    params.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/** 恒定时间比较的固定盐：用户不存在时也执行一次完整派生，抵御时序枚举 */
const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 0x5a);

/**
 * 校验密码。
 * 格式损坏 / 用户不存在（storedHash 为 null）都返回 false，且耗时与正常校验接近。
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) return false;

  const parsed = storedHash ? parsePasswordHash(storedHash) : null;

  if (parsed === null) {
    await deriveKey(password, DUMMY_SALT, DEFAULT_SCRYPT_PARAMS);
    return false;
  }

  const actual = await deriveKey(password, parsed.salt, parsed.params);
  return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
}

export interface PasswordPolicyOptions {
  minLength?: number;
  maxLength?: number;
  requireLetter?: boolean;
  requireDigit?: boolean;
}

export interface PasswordPolicyResult {
  ok: boolean;
  issues: string[];
}

/** 密码强度策略：长度 + 字符类别 + 控制字符，返回人类可读的问题列表 */
export function checkPasswordStrength(
  password: string,
  options: PasswordPolicyOptions = {},
): PasswordPolicyResult {
  const {
    minLength = 8,
    maxLength = 128,
    requireLetter = true,
    requireDigit = true,
  } = options;

  const issues: string[] = [];

  if (typeof password !== 'string' || password.length < minLength) {
    issues.push(`密码长度至少 ${minLength} 个字符`);
  }
  if (password.length > maxLength) {
    issues.push(`密码长度不能超过 ${maxLength} 个字符`);
  }
  if (/[\u0000-\u001f\u007f]/.test(password)) {
    issues.push('密码不能包含控制字符');
  }
  if (requireLetter && !/[A-Za-z]/.test(password)) {
    issues.push('密码至少包含一个字母');
  }
  if (requireDigit && !/\d/.test(password)) {
    issues.push('密码至少包含一个数字');
  }

  return { ok: issues.length === 0, issues };
}

/** 策略不通过时抛出，message 为问题列表拼接 */
export function assertPasswordStrength(
  password: string,
  options: PasswordPolicyOptions = {},
): void {
  const result = checkPasswordStrength(password, options);
  if (!result.ok) {
    throw new Error(`密码强度不足：${result.issues.join('；')}`);
  }
}
