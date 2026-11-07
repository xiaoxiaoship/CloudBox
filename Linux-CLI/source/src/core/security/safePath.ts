import { lstatSync, realpathSync, statSync, type Stats } from 'node:fs';
import path from 'node:path';

/**
 * ============================================================================
 * safePath —— 所有文件操作的唯一入口
 * ============================================================================
 * 七条军规：
 *   1. 拒绝控制字符 / NUL，统一 NFC 规范化
 *   2. 只接受 POSIX 风格相对路径；拒绝绝对路径、盘符、UNC
 *   3. 拒绝 Windows 危险构造：ADS 冒号、结尾点/空格、保留设备名、非法字符
 *   4. 用 path.relative(realRoot, realTarget) 判越界，绝不用 startsWith
 *   5. realpath 解析已存在的最近祖先，确保真实路径仍在根内（防 Junction/符号链接逃逸）
 *   6. 逐段 lstat，命中符号链接/Junction 直接拒绝（根目录本身允许是链接）
 *   7. 对外只返回相对 POSIX 路径，绝不回传绝对路径
 * ============================================================================
 */

export const PATH_ERROR = {
  INVALID: 'PATH_INVALID',
  TRAVERSAL: 'PATH_TRAVERSAL',
  OUTSIDE_ROOT: 'PATH_OUTSIDE_ROOT',
  SYMLINK: 'PATH_SYMLINK',
  NOT_FOUND: 'PATH_NOT_FOUND',
  NOT_A_FILE: 'PATH_NOT_A_FILE',
  NOT_A_DIRECTORY: 'PATH_NOT_A_DIRECTORY',
  TOO_LONG: 'PATH_TOO_LONG',
  INTERNAL: 'PATH_INTERNAL',
} as const;

export type PathErrorCode = (typeof PATH_ERROR)[keyof typeof PATH_ERROR];

export class PathSecurityError extends Error {
  readonly code: PathErrorCode;
  /** 供 HTTP 层直接映射的状态码 */
  readonly httpStatus: number;

  constructor(code: PathErrorCode, message: string, httpStatus = 400) {
    super(message);
    this.name = 'PathSecurityError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Windows 单段最大 255 个 UTF-16 码元 */
const MAX_SEGMENT_LENGTH = 255;
/** 相对路径总长上限（为根目录预留空间，规避 MAX_PATH 问题） */
const MAX_RELATIVE_LENGTH = 900;

/** Windows 保留设备名（含扩展名形式，如 con.txt 同样非法） */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'CONIN$', 'CONOUT$',
]);

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_INVALID_CHARS = /[<>:"|?*]/;
/** 百分号编码的 . / \ —— 上游若漏了 decode，这里再兜一层 */
const ENCODED_TRAVERSAL = /%2e|%2f|%5c/i;

function isNotFoundError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function validateSegment(segment: string): string {
  const normalized = segment.normalize('NFC');

  if (normalized.length === 0) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '路径包含空段');
  }
  if (normalized.length > MAX_SEGMENT_LENGTH) {
    throw new PathSecurityError(PATH_ERROR.TOO_LONG, '单个文件名过长（超过 255 字符）');
  }
  if (CONTROL_CHARS.test(normalized)) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '路径包含控制字符');
  }
  // ':' 是 NTFS 数据流分隔符（file.txt:evil），必须拒绝
  if (WINDOWS_INVALID_CHARS.test(normalized)) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '文件名包含 Windows 非法字符（< > : " | ? *）');
  }
  // Windows 会静默去掉结尾的点和空格，导致 "a." 与 "a" 指向同一文件
  if (normalized.endsWith('.') || normalized.endsWith(' ')) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '文件名不能以点或空格结尾');
  }

  // 设备名按"第一个点之前"判断，con.txt / CON.tar.gz 都非法
  const baseName = normalized.split('.')[0] ?? normalized;
  if (WINDOWS_RESERVED_NAMES.has(baseName.toUpperCase())) {
    throw new PathSecurityError(PATH_ERROR.INVALID, `文件名不能使用 Windows 保留设备名（${baseName}）`);
  }

  return normalized;
}

/**
 * 归一化用户提交的相对路径。
 * 返回 POSIX 风格、无 '.'/'..'、无前导斜杠的相对路径；空字符串表示用户根目录。
 */
export function normalizeRelativePath(input: string): string {
  if (typeof input !== 'string') {
    throw new PathSecurityError(PATH_ERROR.INVALID, '路径必须是字符串');
  }
  if (input.length > MAX_RELATIVE_LENGTH) {
    throw new PathSecurityError(PATH_ERROR.TOO_LONG, '路径过长');
  }
  if (CONTROL_CHARS.test(input)) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '路径包含控制字符');
  }

  // 以下判断必须在反斜杠替换之前进行，否则 UNC 前缀会被误伤
  if (/^[A-Za-z]:/.test(input)) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '不允许使用盘符绝对路径');
  }
  if (input.startsWith('//') || input.startsWith('\\\\')) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '不允许使用 UNC 网络路径');
  }
  if (input.startsWith('/') || input.startsWith('\\')) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '不允许使用绝对路径');
  }
  if (ENCODED_TRAVERSAL.test(input)) {
    throw new PathSecurityError(PATH_ERROR.INVALID, '路径包含可疑的百分号编码');
  }

  const segments: string[] = [];
  for (const raw of input.replaceAll('\\', '/').split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      throw new PathSecurityError(PATH_ERROR.TRAVERSAL, '路径不允许包含上级目录（..）');
    }
    segments.push(validateSegment(raw));
  }

  return segments.join('/');
}

/** 判断 candidate 是否位于 root 之内（含 root 自身），使用 path.relative 语义 */
export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  return !(
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    relative.startsWith('../') ||
    path.isAbsolute(relative)
  );
}

function assertInsideRoot(root: string, candidate: string): void {
  if (!isPathInside(root, candidate)) {
    throw new PathSecurityError(PATH_ERROR.OUTSIDE_ROOT, '路径越界：目标不在用户根目录内', 403);
  }
}

interface DeepestExisting {
  path: string;
  stat: Stats;
}

/** 从目标向上找到第一个真实存在的节点（用于 realpath 校验） */
function findDeepestExisting(absolutePath: string): DeepestExisting | null {
  let current = absolutePath;

  for (;;) {
    try {
      return { path: current, stat: lstatSync(current) };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/** 逐段检查符号链接/Junction；根目录本身不做检查（允许存储根是挂载点） */
function assertNoSymlinkComponents(realRoot: string, absolutePath: string): void {
  const relative = path.relative(realRoot, absolutePath);
  if (relative === '') return;

  let current = realRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isNotFoundError(error)) break; // 后面的段都不存在，交给 mustExist 处理
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new PathSecurityError(
        PATH_ERROR.SYMLINK,
        '路径包含符号链接或目录联接（Junction），已拒绝',
        403,
      );
    }
  }
}

function assertExpectedType(stat: Stats, expect: 'any' | 'file' | 'dir'): void {
  if (expect === 'file' && !stat.isFile()) {
    throw new PathSecurityError(PATH_ERROR.NOT_A_FILE, '目标不是普通文件');
  }
  if (expect === 'dir' && !stat.isDirectory()) {
    throw new PathSecurityError(PATH_ERROR.NOT_A_DIRECTORY, '目标不是目录');
  }
}

export interface ResolveUserPathOptions {
  /** 是否要求路径已存在，默认 true（读操作）；写操作传 false 表示允许新文件 */
  mustExist?: boolean;
  /** 期望的节点类型，默认 any */
  expect?: 'any' | 'file' | 'dir';
}

export interface ResolvedUserPath {
  /** 规范化后的用户根目录真实路径 */
  root: string;
  /** 安全的相对 POSIX 路径，'' 表示根目录 */
  relativePath: string;
  /** 拼接后的绝对路径（仅供服务端内部使用，禁止回传前端） */
  absolutePath: string;
}

/**
 * 将"用户提交的相对路径"安全解析为绝对路径。
 *
 * @param root         用户存储根目录（可以是 Junction，内部会 realpath 归一）
 * @param relativePath 用户输入，如 'photos/2026/a.jpg'
 * @throws PathSecurityError 越界、链接、非法名、类型不符等
 */
export function resolveUserPath(
  root: string,
  relativePath: string,
  options: ResolveUserPathOptions = {},
): ResolvedUserPath {
  const { mustExist = true, expect = 'any' } = options;

  if (expect === 'dir' && !mustExist) {
    throw new Error('resolveUserPath 参数错误：expect=dir 时 mustExist 必须为 true');
  }

  let realRoot: string;
  try {
    realRoot = realpathSync.native(path.resolve(root));
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new PathSecurityError(PATH_ERROR.NOT_FOUND, '用户存储根目录不存在', 500);
    }
    throw error;
  }

  if (!lstatSync(realRoot).isDirectory()) {
    throw new PathSecurityError(PATH_ERROR.NOT_A_DIRECTORY, '用户存储根目录不是目录', 500);
  }
  if (path.parse(realRoot).root === realRoot) {
    throw new PathSecurityError(PATH_ERROR.INTERNAL, '存储根目录不能是磁盘根目录', 500);
  }

  const relative = normalizeRelativePath(relativePath);
  const absolutePath =
    relative === '' ? realRoot : path.join(realRoot, ...relative.split('/'));

  assertInsideRoot(realRoot, absolutePath);

  const deepest = findDeepestExisting(absolutePath);
  if (deepest === null) {
    throw new PathSecurityError(PATH_ERROR.NOT_FOUND, '路径不存在', 404);
  }

  // 真实路径必须仍在根内：这一条专门拦截 Junction / 符号链接指向外部
  assertInsideRoot(realRoot, realpathSync.native(deepest.path));
  assertNoSymlinkComponents(realRoot, absolutePath);

  if (mustExist) {
    if (deepest.path !== absolutePath) {
      throw new PathSecurityError(PATH_ERROR.NOT_FOUND, '路径不存在', 404);
    }
    assertExpectedType(deepest.stat, expect);
  } else {
    if (relative === '') {
      throw new PathSecurityError(PATH_ERROR.INVALID, '不能写入存储根目录本身');
    }
    const parent = path.dirname(absolutePath);
    try {
      if (!statSync(parent).isDirectory()) {
        throw new PathSecurityError(PATH_ERROR.NOT_A_DIRECTORY, '父路径不是目录');
      }
    } catch (error) {
      if (error instanceof PathSecurityError) throw error;
      if (isNotFoundError(error)) {
        throw new PathSecurityError(PATH_ERROR.NOT_FOUND, '父目录不存在', 404);
      }
      throw error;
    }
  }

  return { root: realRoot, relativePath: relative, absolutePath };
}

/** 把内部绝对路径反解为相对 POSIX 路径（用于审计/日志，绝不回传前端绝对路径） */
export function toRelativePath(realRoot: string, absolutePath: string): string {
  const relative = path.relative(realRoot, absolutePath);
  if (relative === '') return '';
  assertInsideRoot(realRoot, absolutePath);
  return relative.split(path.sep).join('/');
}
