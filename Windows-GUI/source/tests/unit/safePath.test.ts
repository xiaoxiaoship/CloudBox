import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  normalizeRelativePath,
  PathSecurityError,
  resolveUserPath,
  type PathErrorCode,
  toRelativePath,
} from '../../src/core/security/safePath.ts';

function assertPathError(action: () => unknown, expected: PathErrorCode | PathErrorCode[]): void {
  const codes = Array.isArray(expected) ? expected : [expected];
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PathSecurityError, `期望 PathSecurityError，实际: ${String(error)}`);
    assert.ok(
      codes.includes(error.code),
      `期望错误码 ${codes.join('/')}，实际 ${error.code}`,
    );
    return true;
  });
}

describe('normalizeRelativePath', () => {
  it('归一化正常路径（反斜杠、重复斜杠、点段）', () => {
    assert.equal(normalizeRelativePath('docs/a.txt'), 'docs/a.txt');
    assert.equal(normalizeRelativePath('docs\\sub\\\\a.txt'), 'docs/sub/a.txt');
    assert.equal(normalizeRelativePath('./docs/./a.txt'), 'docs/a.txt');
    assert.equal(normalizeRelativePath(''), '');
    assert.equal(normalizeRelativePath('中文 目录/文件.txt'), '中文 目录/文件.txt');
  });

  it('支持 Unicode 文件名', () => {
    assert.equal(normalizeRelativePath('照片/2026年/风景.jpg'), '照片/2026年/风景.jpg');
  });

  it('拒绝 ../ 穿越（含混合分隔符）', () => {
    assertPathError(() => normalizeRelativePath('../secret'), 'PATH_TRAVERSAL');
    assertPathError(() => normalizeRelativePath('docs/../../secret'), 'PATH_TRAVERSAL');
    assertPathError(() => normalizeRelativePath('docs\\..\\secret'), 'PATH_TRAVERSAL');
  });

  it('拒绝绝对路径、盘符、UNC', () => {
    assertPathError(() => normalizeRelativePath('/etc/passwd'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('C:\\Windows\\win.ini'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('c:/Windows'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('\\\\server\\share'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('//server/share'), 'PATH_INVALID');
  });

  it('拒绝百分号编码穿越', () => {
    assertPathError(() => normalizeRelativePath('%2e%2e/secret'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('docs/%2E%2E/secret'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('..%5csecret'), 'PATH_INVALID');
  });

  it('拒绝 NTFS 数据流与 Windows 非法字符', () => {
    assertPathError(() => normalizeRelativePath('file.txt:evil'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('a<b>c'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('a|b'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('a\u0000b'), 'PATH_INVALID');
  });

  it('拒绝保留设备名（含带扩展名形式）', () => {
    for (const name of ['CON', 'con.txt', 'AUX', 'NUL.tar.gz', 'COM1', 'lpt9.log']) {
      assertPathError(() => normalizeRelativePath(name), 'PATH_INVALID');
    }
  });

  it('拒绝结尾点/空格与超长段', () => {
    assertPathError(() => normalizeRelativePath('name.'), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('name '), 'PATH_INVALID');
    assertPathError(() => normalizeRelativePath('a'.repeat(256)), 'PATH_TOO_LONG');
  });
});

describe('resolveUserPath', () => {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-safepath-'));
  const root = path.join(sandbox, 'user-root');
  const outside = path.join(sandbox, 'outside');
  const junction = path.join(root, 'escape-link');

  before(() => {
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    mkdirSync(path.join(root, '中文'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(root, 'docs', 'a.txt'), 'hello');
    writeFileSync(path.join(root, '中文', '文件.txt'), '你好');
    writeFileSync(path.join(outside, 'secret.txt'), 'top-secret');
  });

  after(() => {
    try {
      unlinkSync(junction);
    } catch {
      // 未创建或已删除
    }
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
  });

  it('解析已存在文件，且绝对路径落在根内', () => {
    const resolved = resolveUserPath(root, 'docs/a.txt', { expect: 'file' });
    assert.equal(resolved.relativePath, 'docs/a.txt');
    assert.equal(resolved.absolutePath, path.join(resolved.root, 'docs', 'a.txt'));
    assert.equal(toRelativePath(resolved.root, resolved.absolutePath), 'docs/a.txt');
  });

  it('空路径解析为根目录（用于列目录）', () => {
    const resolved = resolveUserPath(root, '', { expect: 'dir' });
    assert.equal(resolved.relativePath, '');
    assert.equal(resolved.absolutePath, resolved.root);
  });

  it('读取不存在的路径报 NOT_FOUND', () => {
    assertPathError(() => resolveUserPath(root, 'docs/missing.txt'), 'PATH_NOT_FOUND');
  });

  it('类型不匹配时报 NOT_A_FILE / NOT_A_DIRECTORY', () => {
    assertPathError(() => resolveUserPath(root, 'docs', { expect: 'file' }), 'PATH_NOT_A_FILE');
    assertPathError(
      () => resolveUserPath(root, 'docs/a.txt', { expect: 'dir' }),
      'PATH_NOT_A_DIRECTORY',
    );
  });

  it('写模式允许新文件，但父目录必须存在', () => {
    const resolved = resolveUserPath(root, 'docs/new.txt', { mustExist: false });
    assert.equal(resolved.absolutePath, path.join(resolved.root, 'docs', 'new.txt'));

    assertPathError(
      () => resolveUserPath(root, 'missing-dir/new.txt', { mustExist: false }),
      'PATH_NOT_FOUND',
    );
    assertPathError(
      () => resolveUserPath(root, '', { mustExist: false }),
      'PATH_INVALID',
    );
  });

  it('拒绝穿越与绝对路径（在解析层再兜一次）', () => {
    assertPathError(() => resolveUserPath(root, '../outside/secret.txt'), 'PATH_TRAVERSAL');
    assertPathError(() => resolveUserPath(root, 'C:\\Windows\\win.ini'), 'PATH_INVALID');
    assertPathError(() => resolveUserPath(root, 'docs/a.txt:stream'), 'PATH_INVALID');
  });

  it('拒绝 Junction 指向根目录之外', (t) => {
    try {
      symlinkSync(outside, junction, 'junction');
    } catch {
      t.skip('当前环境不支持创建 Junction（需要 NTFS 且允许重解析点）');
      return;
    }

    assertPathError(
      () => resolveUserPath(root, 'escape-link/secret.txt'),
      ['PATH_OUTSIDE_ROOT', 'PATH_SYMLINK'],
    );

    unlinkSync(junction);
  });

  it('Unicode 目录可正常解析', () => {
    const resolved = resolveUserPath(root, '中文/文件.txt', { expect: 'file' });
    assert.equal(resolved.relativePath, '中文/文件.txt');
  });
});
