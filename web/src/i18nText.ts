import i18n from './i18n.ts';
import { autoEnglish } from '../../src/shared/i18nAuto.ts';

/**
 * English compatibility fallback for legacy Web screens that still contain
 * direct Chinese JSX text. It only translates exact static dictionary entries
 * and never applies pattern-based changes to user data.
 */
const webEnglish: Record<string, string> = {
  '压缩': 'Compress',
  '公告': 'Announcements',
  '无法读取压缩包': 'Unable to read the archive',
  '目录': 'Contents',
  '用户设置': 'User settings',
  '解压': 'Extract',
  '查杀': 'Scan',
  '上传': 'Upload',
  '任务队列': 'Task queue',
  'AI 响应流不可用': 'AI response stream is unavailable',
  '上传长时间无响应，已停止；请检查网络后重试': 'Upload stalled and was stopped. Check your network and try again.',
  '网络中断，上传失败': 'Network interrupted; upload failed',
  '已取消上传': 'Upload canceled',
  '上传超时，请重试': 'Upload timed out. Try again.',
  '确认失败': 'Confirmation failed',
  '管理员已配置共享 AI 服务。': 'The administrator has configured a shared AI service.',
  '请填写自己的 OpenAI 兼容 API 配置。': 'Enter your own OpenAI-compatible API settings.',
  '留空保持现状': 'Leave blank to keep current value',
  '关键': 'Critical',
  '警告': 'Warning',
  '消息': 'Message',
  '关闭公告': 'Close announcements',
  '仅读取压缩包目录，不解压到磁盘。': 'Only reads the archive index; nothing is extracted to disk.',
  '请输入压缩密码': 'Enter a compression password',
  '压缩失败': 'Compression failed',
  '压缩文件': 'Compress files',
  '压缩中…': 'Compressing…',
  '开始压缩': 'Start compression',
  '操作失败，请稍后重试': 'Operation failed. Try again later.',
  '确定': 'OK',
  '名称不能为空': 'Name cannot be empty',
  '压缩包已加密': 'Archive is encrypted',
  '解压中…': 'Extracting…',
  '开始解压': 'Start extraction',
  '解压失败，请检查压缩包是否损坏': 'Extraction failed. Check whether the archive is damaged.',
  '密码不正确，请重新输入': 'Incorrect password. Try again.',
  '解压失败': 'Extraction failed',
  '部署失败': 'Deployment failed',
  '搜索个人盘': 'Search my drive',
  '请输入新的文件名': 'Enter a new file name',
  '移动到': 'Move to',
  '移动完成': 'Move complete',
  '压缩任务已创建': 'Compression task created',
  '可在线预览': 'Preview available',
  '文件夹': 'Folder',
  '管理员已关闭访客模式': 'Guest mode is disabled by the administrator',
  '访客链接不存在或已被撤销': 'Guest link does not exist or was revoked',
  '访客链接已过期，请联系分享者重新生成链接': 'Guest link expired. Ask the owner for a new link.',
  '访问密码不正确，请稍后再试': 'Incorrect access password. Try again later.',
  '当前访客人数已达上限，请稍后再试': 'Guest limit reached. Try again later.',
  '访客会话已过期，请重新进入': 'Guest session expired. Enter the link again.',
  '访客链接对应的账号不可用': 'The account for this guest link is unavailable',
  '尝试次数过多，已被临时限制，请稍后再试': 'Too many attempts. Temporarily blocked; try again later.',
  '访客访问 - CloudBox': 'Guest access - CloudBox',
  '访客链接不可用': 'Guest link unavailable',
  '对方': 'Owner',
  '链接永久有效': 'Link never expires',
  '请输入分享者设置的密码': 'Enter the password set by the owner',
  '关闭插件': 'Close plugin',
  '视频加载失败，文件可能已损坏或编码不受支持': 'Video failed to load. The file may be damaged or use an unsupported codec.',
  '预览容器不可用': 'Preview container unavailable',
  '密码至少包含一个字母': 'Password must contain at least one letter',
  '密码至少包含一个数字': 'Password must contain at least one number',
  '最近 20 条任务；运行中的任务可取消，排队任务可暂停。': 'Latest 20 tasks; running tasks can be canceled and queued tasks paused.',
  '进行中': 'In progress',
  '查杀中': 'Scanning',
  '排队中': 'Queued',
  '等待': 'Waiting',
  '已暂停': 'Paused',
  '已完成': 'Completed',
  '安全': 'Safe',
  '有风险': 'At risk',
  '跳过': 'Skipped',
  '压缩任务': 'Compression task',
  '解压任务': 'Extraction task',
  '查杀任务': 'Scan task',
  '折叠任务队列': 'Collapse task queue',
  '上传失败': 'Upload failed',
  '跟随系统': 'Follow system',
  '改名失败': 'Rename failed',
  '访客链接已生成，旧链接已失效': 'Guest link created; the old link is now invalid',
  '生成访客链接失败': 'Failed to create guest link',
  '删除分享失败': 'Failed to delete share',
  '访客链接已撤销，所有访客会话立即失效': 'Guest link revoked; all guest sessions are now invalid',
  '撤销访客链接失败': 'Failed to revoke guest link',
  '链接已复制到剪贴板': 'Link copied to clipboard',
  '复制失败，请手动选择链接复制': 'Copy failed. Select the link and copy it manually.',
  '账号信息、头像与个人显示设置。': 'Account details, avatar and personal display settings.',
  '访客模式': 'Guest mode',
  '公网地址（固定 IP/域名）': 'Public address (fixed IP/domain)',
  '自动地址（当前 IP/域名）': 'Automatic address (current IP/domain)',
  '访客链接': 'Guest link',
  '永久有效': 'Never expires',
  ' · 已设置访问密码': ' · Access password set',
  ' · 无访问密码': ' · No access password',
  '输入新密码以更新': 'Enter a new password to update',
  '留空则保持无密码，或输入密码': 'Leave blank for no password, or enter a password',
  '更新密码': 'Update password',
  '设置密码': 'Set password',
  '留空则任何人凭链接直接访问': 'Leave blank to allow anyone with the link to access',
  '我的直链分享': 'My direct shares',
  '分享链接已复制到剪贴板': 'Share link copied to clipboard',
  '已过期': 'Expired',
  '缺少 #root 挂载点': 'Missing #root mount point',
  '头像读取失败': 'Failed to read avatar',
  '链接有效期': 'Link validity',
  '暂无公告': 'No announcements',
  '压缩包名称': 'Archive name',
  '压缩级别': 'Compression level',
  '加密压缩包（ZIP AES-256）': 'Encrypt archive (ZIP AES-256)',
};

function translateValue(value: string): string {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  const text = value.trim();
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return value;
  const translated = webEnglish[text] ?? autoEnglish[text];
  return translated === undefined ? value : `${leading}${translated}${trailing}`;
}

function apply(): void {
  if (!i18n.language.toLowerCase().startsWith('en')) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const current = node.nodeValue ?? '';
    const translated = translateValue(current);
    if (translated !== current) node.nodeValue = translated;
    node = walker.nextNode();
  }
  for (const element of document.querySelectorAll<HTMLElement>('[placeholder],[title],[aria-label]')) {
    for (const attribute of ['placeholder', 'title', 'aria-label'] as const) {
      const current = element.getAttribute(attribute);
      if (current === null) continue;
      const translated = translateValue(current);
      if (translated !== current) element.setAttribute(attribute, translated);
    }
  }
}

let installed = false;
export function installWebTextFallback(): void {
  if (installed) return;
  installed = true;
  apply();
  window.setTimeout(apply, 0);
  window.setTimeout(apply, 250);
  let timer: number | null = null;
  const observer = new MutationObserver(() => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      apply();
    }, 40);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  i18n.on('languageChanged', () => window.setTimeout(apply, 0));
}
