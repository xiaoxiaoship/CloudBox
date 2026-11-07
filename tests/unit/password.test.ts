import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkPasswordStrength,
  hashPassword,
  needsRehash,
  parsePasswordHash,
  verifyPassword,
} from '../../src/core/security/password.ts';

describe('password (scrypt)', () => {
  it('生成带参数与版本号的哈希格式', async () => {
    const hash = await hashPassword('Passw0rd!');
    assert.match(hash, /^scrypt\$v1\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    assert.equal(parsePasswordHash(hash)?.params.N, 32_768);
  });

  it('同一密码两次哈希结果不同（随机盐）', async () => {
    const [a, b] = await Promise.all([hashPassword('Passw0rd!'), hashPassword('Passw0rd!')]);
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('Passw0rd!', a), true);
    assert.equal(await verifyPassword('Passw0rd!', b), true);
  });

  it('错误密码 / 空存储 / 损坏哈希一律返回 false', async () => {
    const hash = await hashPassword('Passw0rd!');
    assert.equal(await verifyPassword('passw0rd!', hash), false);
    assert.equal(await verifyPassword('Passw0rd!', null), false);
    assert.equal(await verifyPassword('Passw0rd!', 'not-a-hash'), false);

    const tampered = hash.slice(0, -2) + (hash.endsWith('AA') ? 'BB' : 'AA');
    assert.equal(await verifyPassword('Passw0rd!', tampered), false);
  });

  it('解析拒绝非法参数（非 2 的幂、超范围）', () => {
    assert.equal(parsePasswordHash('scrypt$v1$12345$8$1$c2FsdA$aGFzaA'), null);
    assert.equal(parsePasswordHash('scrypt$v1$32768$99$1$c2FsdA$aGFzaA'), null);
    assert.equal(parsePasswordHash('bcrypt$v1$32768$8$1$c2FsdA$aGFzaA'), null);
    assert.equal(parsePasswordHash('scrypt$v1$32768$8$1'), null);
  });

  it('needsRehash 能识别弱参数与损坏哈希', async () => {
    const strong = await hashPassword('Passw0rd!');
    assert.equal(needsRehash(strong), false);

    const weak = await hashPassword('Passw0rd!', { N: 1 << 14, r: 8, p: 1, keylen: 64 });
    assert.equal(needsRehash(weak), true);
    assert.equal(needsRehash('broken'), true);
  });

  it('密码强度策略给出可读问题列表', () => {
    assert.equal(checkPasswordStrength('Passw0rd!').ok, true);
    assert.equal(checkPasswordStrength('short').ok, false);
    assert.equal(checkPasswordStrength('alllowercase').issues.some((i) => i.includes('数字')), true);
    assert.equal(checkPasswordStrength('12345678').issues.some((i) => i.includes('字母')), true);
    assert.equal(checkPasswordStrength('has\u0000control').ok, false);
  });
});
