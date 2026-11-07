import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** AES-256-GCM 对称加密；密钥文件只保存在本机数据目录。 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyFile: string) {
    mkdirSync(path.dirname(keyFile), { recursive: true });
    if (existsSync(keyFile)) {
      this.key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    } else {
      this.key = randomBytes(32);
      writeFileSync(keyFile, `${this.key.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    if (this.key.length !== 32) throw new Error('AI 加密密钥损坏');
  }

  encrypt(value: string): string {
    if (!value) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
  }

  decrypt(value: string): string {
    if (!value) return '';
    if (!value.startsWith('enc:v1:')) return value;
    const raw = Buffer.from(value.slice('enc:v1:'.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 6) return 'sk-***';
  if (value.startsWith('sk-')) return `sk-***${value.slice(-3)}`;
  return `${value.slice(0, 2)}***${value.slice(-3)}`;
}
