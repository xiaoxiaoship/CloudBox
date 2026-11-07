import i18n from './i18n.ts';

/**
 * 管理端仍有部分深层业务文案未逐一改写为 t()。
 * 这里在英文模式下做一次可控的 DOM 文案映射，覆盖管理端现有页面；
 * 切换语言时会刷新页面，避免中英文状态互相污染。
 */
const EN: Record<string, string> = {
  '管理员密码': 'Administrator password',
  '修改后所有管理员会话会立即失效，需要使用新密码重新登录。':
    'All administrator sessions will be revoked after changing the password.',
  '当前密码': 'Current password',
  '新密码': 'New password',
  '确认新密码': 'Confirm new password',
  '至少 8 位，含字母和数字': 'At least 8 characters with letters and numbers',
  '修改密码': 'Change password',
  '用户网页自助注册': 'Public self-registration',
  '已关闭': 'Disabled',
  '已开启': 'Enabled',
  '默认关闭。开启后普通用户登录页会显示“没有账号？点击注册”，注册成功后立即生效，无需重启服务。':
    'Disabled by default. When enabled, the login page shows “No account? Register”. Changes take effect immediately.',
  '新注册用户角色为普通用户，状态正常，默认分配 5 GB 配额；每 IP 每小时最多成功注册 2 次。':
    'New accounts are regular users with a 5 GB quota; at most 2 successful registrations per IP per hour.',
  '用户功能权限': 'User feature permissions',
  '关闭后 Web 端会隐藏对应入口，后端接口同时返回 403。':
    'When disabled, the web entry is hidden and backend APIs return 403.',
  '图片在线预览': 'Image preview',
  '允许用户在浏览器中查看 PNG/JPG/WebP 等图片':
    'Allow users to preview PNG/JPG/WebP images in the browser',
  '视频在线播放': 'Video playback',
  '允许播放 MP4/WebM/Ogg 视频': 'Allow MP4/WebM/Ogg video playback',
  'PDF 在线预览': 'PDF preview',
  '允许在浏览器中渲染 PDF': 'Allow PDF rendering in the browser',
  '在线解压': 'Online extraction',
  '允许把 zip/7z/rar/tar.gz 解压到当前目录':
    'Allow extracting zip/7z/rar/tar.gz into the current directory',
  '安全查杀': 'Security scanning',
  '允许用户对文件发起 ClamAV / VirusTotal 查杀':
    'Allow users to scan files with ClamAV / VirusTotal',
  'API 模式使用 VirusTotal（文件上限 32MB）；本地模式调用配置目录中的 ClamAV 引擎。结果为 infected 的文件会被强制禁止下载、分享和解压。':
    'API mode uses VirusTotal (32MB limit); local mode uses ClamAV. Infected files are blocked from download, sharing and extraction.',
  '查杀模式': 'Scan mode',
  '本地 ClamAV': 'Local ClamAV',
  'VirusTotal API': 'VirusTotal API',
  'VirusTotal API Key': 'VirusTotal API key',
  'ClamAV 目录': 'ClamAV directory',
  '仅保存在本机数据库': 'Stored only in the local database',
  '保存查杀设置': 'Save scan settings',
  'AI 已开启': 'AI enabled',
  'AI 已关闭': 'AI disabled',
  'AI 总开关': 'AI master switch',
  'AI 模式': 'AI mode',
  '管理员共享配置': 'Administrator shared configuration',
  '用户自填配置': 'User-provided configuration',
  '普通用户每日上限': 'Daily limit for regular users',
  '管理员 API Key（脱敏展示：': 'Administrator API key (masked: ',
  '留空保持现有 Key': 'Leave blank to keep the current key',
  '用户模式：管理员 Base URL / API Key 已隐藏，普通用户必须在 Web“个人设置”中填写自己的配置。':
    'User mode: administrator Base URL / API Key are hidden. Users configure them in Web personal settings.',
  '保存 AI 设置': 'Save AI settings',
  '内嵌静态托管': 'Static hosting',
  '站点统一挂载在': 'Sites are served under',
  '下，不额外监听端口。端口复用依赖 frp HTTP/HTTPS 隧道。':
    ' without an extra port. Port reuse relies on an frp HTTP/HTTPS tunnel.',
  '公网基础地址（用于生成链接）': 'Public base URL (used to generate links)',
  'frp 必须使用 HTTP 或 HTTPS 隧道，并用 customDomains/locations（如':
    'frp must use an HTTP or HTTPS tunnel with customDomains/locations (e.g.',
  '）合并到同一公网端口；不要为托管单独映射 TCP 端口。':
    ') on the same public port; do not map a separate TCP port.',
  '保存托管设置': 'Save hosting settings',
  '邮件通知': 'Email notifications',
  'SMTP 告警异步发送；密码 AES-256-GCM 加密，界面脱敏。':
    'SMTP alerts are sent asynchronously; passwords are AES-256-GCM encrypted and masked.',
  '邮件总开关': 'Email master switch',
  'SMTP Host': 'SMTP host',
  'SMTP 用户': 'SMTP user',
  '授权码/密码': 'Password / app password',
  '发件人': 'From',
  '告警接收邮箱': 'Alert recipient',
  '新用户注册': 'New registration',
  '安全告警': 'Security alert',
  '系统错误': 'System error',
  '保存邮件设置': 'Save email settings',
  '发送测试邮件': 'Send test email',
  '系统数据目录': 'System data directory',
  '网盘文件目录': 'Drive files directory',
  '插件目录': 'Plugins directory',
  '更改目录': 'Change directory',
  '在资源管理器中打开': 'Open in File Manager',
  '存放 cloudbox.db、SSL 证书、CA 与 frp 配置。':
    'Stores cloudbox.db, SSL certificates, CA and frp configuration.',
  '存放所有用户上传的文件（storage）。修改后应用会重启。':
    'Stores user-uploaded files (storage). The app restarts after changes.',
  '存放已安装插件与插件专属配置（默认 %APPDATA%/CloudBox/plugins）。修改后应用会重启。':
    'Stores installed plugins and plugin data (default %APPDATA%/CloudBox/plugins). The app restarts after changes.',
  '数据库备份': 'Database backup',
  '使用 SQLite 在线备份 API 导出当前数据库（包含用户、配额、设置与审计日志）。':
    'Export the current database using the online SQLite backup API.',
  '选择位置并备份': 'Choose location and back up',
  '普通用户': 'Regular users',
  '已用空间': 'Used space',
  '总配额': 'Total quota',
  '数据目录': 'Data directory',
  '本机存储': 'Local storage',
  '本地 Web 服务': 'Local web service',
  '服务未启动，仅本机管理': 'Service stopped, local management only',
  '修改后立即生效；在线模式下会自动重启服务，失败则回滚旧端口。':
    'Takes effect immediately; the service restarts when online and rolls back to the old port on failure.',
  '尚未创建用户': 'No users yet',
  'SQLite + 用户文件': 'SQLite + user files',
  '离线': 'Offline',
  '总配额 0 B': 'Total quota 0 B',
  '当前为离线模式，不监听任何端口；管理员仍可浏览与下载用户文件':
    'Offline mode: no ports are listening, but administrators can still browse files',
  '访问地址': 'Access address',
  '打开右上角开关后生成访问地址。': 'Turn on the switch to generate an access address.',
  '端口设置': 'Port settings',
  '监听端口（1024-65535）': 'Listening port (1024-65535)',
  '保存端口': 'Save port',
  '服务概览': 'Dashboard',
  '用户管理': 'Users',
  '文件浏览': 'Files',
  '网络设置': 'Network',
  '插件': 'Plugins',
  '系统设置': 'Settings',
  '离线模式': 'Offline',
  '运行中': 'Running',
  '已停止': 'Stopped',
  '新建用户': 'New user',
  '创建用户': 'Create user',
  '用户名': 'Username',
  '显示名': 'Display name',
  '角色': 'Role',
  '状态': 'Status',
  '配额': 'Quota',
  '操作': 'Actions',
  '名称': 'Name',
  '大小': 'Size',
  '修改时间': 'Modified',
  '上传文件': 'Upload',
  '新建文件夹': 'New folder',
  '下载': 'Download',
  '分享': 'Share',
  '重命名': 'Rename',
  '删除': 'Delete',
  '刷新': 'Refresh',
  '部署为网站': 'Deploy as website',
  '取消部署': 'Undeploy',
  '该目录正在托管中': 'This folder is hosted',
  '插件平台': 'Plugin platform',
  '导入插件': 'Import plugin',
  '配置界面': 'Configure',
  '卸载插件': 'Uninstall plugin',
  '允许此插件接管 Web 界面': 'Allow this plugin to take over the web UI',
  '开启': 'On',
  '关闭': 'Off',
  '保存': 'Save',
  '取消': 'Cancel',
  '确认': 'Confirm',
  '退出': 'Log out',
  '语言': 'Language',
  '中文': '中文',
  'English': 'English',

};

const EN_PAGE: Record<string, string> = {
  '管理员登录': 'Administrator login',
  '管理账户、配额与局域网服务': 'Manage accounts, quotas and LAN services',
  '管理控制台': 'Management Console',
  '创建普通用户、分配配额、重置密码或禁用账户':
    'Create users, assign quotas, reset passwords or disable accounts',
  '离线模式：不监听端口，仅本机管理':
    'Offline mode: no ports are listening; local management only',
  '开启后限流将基于 X-Forwarded-For 头，适用于挂载了 frp 或 Nginx 的场景。 注意：如果直连暴露端口，请保持关闭，防止伪造 IP 头绕过限流。':
    'Rate limiting uses X-Forwarded-For. Keep it off for direct public access to prevent spoofed IP headers from bypassing limits.',
  '展开': 'Expand',
  '收起': 'Collapse',
  'HTTP（推荐，自动带 X-Forwarded-For）': 'HTTP (recommended, forwards X-Forwarded-For)',
  'HTTPS（frps 终止 TLS）': 'HTTPS (TLS terminated by frps)',
  'TCP（原始端口，需 PROXY protocol 才能识别 IP）':
    'TCP (raw port; PROXY protocol required to identify IP)',
  'token（可选）': 'Token (optional)',
  '代理名称': 'Proxy name',
  '保存配置': 'Save configuration',
  'TCP 隧道启用 PROXY protocol v2（仅当本地服务支持时开启；Express 默认不解析该协议，推荐使用 HTTP 隧道）。':
    'Enable PROXY protocol v2 for TCP tunnels only when the local service supports it. Express does not parse it by default; HTTP tunnels are recommended.',
  'frpc 日志': 'frpc logs',
  '暂无日志': 'No logs yet',
  'API 模式使用 VirusTotal（文件上限 32MB）；本地模式调用配置目录中的 ClamAV 引擎。 结果为 infected 的文件会被强制禁止下载、分享和解压。':
    'API mode uses VirusTotal (32 MB limit); local mode uses ClamAV. Infected files are blocked from download, sharing and extraction.',
  '密码': 'Password',
  '登录': 'Log in',
  '管理员用户名': 'Administrator username',
  '管理员密码': 'Administrator password',
  '请输入管理员密码': 'Enter administrator password',
  '管理密码使用 scrypt 哈希存储，会话仅保留在本机内存':
    'Passwords use scrypt hashing; sessions remain in local memory only',
  '用户账户': 'User accounts',
  '创建普通用户，分配配额、重置密码或禁用账户':
    'Create users, assign quotas, reset passwords or disable accounts',
  '用户': 'User',
  '管理员': 'Administrator',
  '普通用户': 'Regular user',
  '正常': 'Active',
  '禁用': 'Disabled',
  '不限量': 'Unlimited',
  '已用': 'Used',
  '最近登录': 'Last login',
  '当前账户': 'Current account',
  '新建用户': 'New user',
  '创建用户': 'Create user',
  '显示名': 'Display name',
  '角色': 'Role',
  '状态': 'Status',
  '配额': 'Quota',
  '操作': 'Actions',
  '用户文件（只读）': 'User files (read-only)',
  '管理员可直接浏览所有用户目录并下载文件，所有路径强制经过 safePath 校验':
    'Administrators can browse all user folders and download files; every path is validated by safePath',
  '根目录': 'Root',
  '只读模式': 'Read-only',
  '该目录为空': 'This folder is empty',
  '名称': 'Name',
  '大小': 'Size',
  '修改时间': 'Modified',
  '传输协议': 'Transport protocol',
  '监听端口': 'Listening port',
  '应用并重启': 'Apply and restart',
  'HTTP 仅建议在可信局域网使用。': 'HTTP is recommended only on a trusted LAN.',
  '信任反向代理的真实 IP': 'Trust reverse proxy real IP',
  '开启后限流将基于 X-Forwarded-For 头，适用于挂载了 frp 或 Nginx 的场景。注意：如果直连暴露端口，请保持关闭，防止伪造 IP 头绕过限流。':
    'Rate limiting uses X-Forwarded-For when enabled. Keep it off for direct public access to prevent spoofed IP headers from bypassing limits.',
  '修改后如果服务正在运行，会自动重启 HTTP 服务以生效。':
    'If the service is running, it restarts automatically to apply the change.',
  'TLS 证书': 'TLS certificate',
  '未配置': 'Not configured',
  '证书保存在数据目录 config/ssl/server.crt 与 server.key，导入后需点击上方“应用并重启”生效。也可以手动导入已有证书，与一键生成互不冲突。':
    'Certificates are stored in config/ssl/server.crt and server.key. Apply and restart after importing.',
  '尚未同时导入证书与私钥。支持 .crt / .pem / .cer 与 .key。':
    'Certificate and private key are not imported yet. Supports .crt / .pem / .cer and .key.',
  '导入证书': 'Import certificate',
  '导入私钥': 'Import private key',
  '私有 CA 证书生成': 'Private CA certificate generation',
  '未生成': 'Not generated',
  '访问地址与二维码': 'Access address and QR code',
  '在线模式后生成访问地址与二维码。': 'The address and QR code appear in online mode.',
  'frp 内网穿透': 'frp tunnel',
  '未运行': 'Not running',
  '当前使用 TCP 隧道指向本地 HTTP 端口；TCP 本身不携带 X-Forwarded-For。':
    'TCP tunnel points to the local HTTP port; TCP does not carry X-Forwarded-For.',
  '启动': 'Start',
  '停止': 'Stop',
  '重启': 'Restart',
  'frps 地址': 'frps address',
  'frps 端口': 'frps port',
  '隧道类型': 'Tunnel type',
  '公网映射端口': 'Public port',
  '示例：frp.example.com': 'e.g. frp.example.com',
  '插件平台': 'Plugin platform',
  '插件在独立子进程中运行；配置界面通过沙箱 iframe 加载。启用/禁用会即时启动或终止子进程。':
    'Plugins run in isolated child processes; configuration UIs load in a sandboxed iframe.',
  '暂无插件。导入 zip 或包含 manifest.json 的文件夹。':
    'No plugins yet. Import a zip or a folder containing manifest.json.',
  '导入插件': 'Import plugin',
  '配置界面': 'Configure',
  '卸载插件': 'Uninstall plugin',
  '允许此插件接管 Web 界面': 'Allow this plugin to take over the web UI',
  '安全查杀': 'Security scanning',
  'API 模式使用 VirusTotal（文件上限 32MB）；本地模式调用配置目录中的 ClamAV 引擎。结果为 infected 的文件会被强制禁止下载、分享和解压。':
    'API mode uses VirusTotal (32 MB limit); local mode uses ClamAV. Infected files are blocked from download, sharing and extraction.',
  '查杀模式': 'Scan mode',
  '本地 ClamAV': 'Local ClamAV',
  'ClamAV 目录': 'ClamAV directory',
  '保存查杀设置': 'Save scan settings',
  '当前为离线模式，不监听端口；仅本机管理':
    'Offline mode: no ports are listening; local management only',
  '证书保存在数据目录': 'Certificates are stored in the data directory',
  '与': 'and',
  '。导入后需点击上方“应用并重启”生效。':
    '. Click “Apply and restart” above after importing.',
  '也可以手动导入已有证书，与一键生成互不冲突。':
    'You can also import existing certificates; this does not conflict with one-click generation.',
  '开启在线模式后生成访问地址与二维码。':
    'The access address and QR code appear when online mode is enabled.',
  '静态托管统一挂载在': 'Static hosting is mounted under',
  '，frp 必须选择 HTTP 或 HTTPS，并使用 locations':
    '; frp must use HTTP or HTTPS and locations',
  '（或通配域名）复用同一端口；不要为托管单独开 TCP 端口。':
    ' (or a wildcard domain) on the same port; do not open a separate TCP port for hosting.',
  '例如：C:\\Program Files\\ClamAV': 'e.g. C:\\Program Files\\ClamAV',
};


function translateText(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return value;
  const dynamic =
    EN[trimmed] ??
    EN_PAGE[trimmed] ??
    (/^(\d+) 个已安装$/.test(trimmed) ? trimmed.replace(/^(\d+) 个已安装$/, '$1 installed') : undefined) ??
    (/^用户ID (\d+)$/.test(trimmed) ? trimmed.replace(/^用户ID (\d+)$/, 'User ID $1') : undefined) ??
    (/^当前用户：(.+) · 已用 (.+) · (.+)$/.test(trimmed)
      ? trimmed.replace(/^当前用户：(.+) · 已用 (.+) · (.+)$/, 'Current user: $1 · Used $2 · $3')
      : undefined) ??
    (/^当前使用 TCP 隧道指向本地 (.+) 端口；TCP 本身不携带 X-Forwarded-For。$/.test(trimmed)
      ? trimmed.replace(
          /^当前使用 TCP 隧道指向本地 (.+) 端口；TCP 本身不携带 X-Forwarded-For。$/,
          'TCP tunnel targets local $1; TCP itself does not carry X-Forwarded-For.',
        )
      : undefined) ??
    (trimmed.includes('（管理员）') ? trimmed.replace('（管理员）', ' (Administrator)') : undefined);
  if (dynamic === undefined) return value;
  return value.replace(trimmed, dynamic);
}

export function applyAdminTranslations(): void {
  if (!i18n.language.toLowerCase().startsWith('en')) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const current = node.nodeValue ?? '';
    const translated = translateText(current);
    if (translated !== current) node.nodeValue = translated;
    node = walker.nextNode();
  }
  for (const element of document.querySelectorAll<HTMLElement>('[placeholder],[title],[aria-label]')) {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const current = element.getAttribute(attr);
      if (current) {
        const translated = translateText(current);
        if (translated !== current) element.setAttribute(attr, translated);
      }
    }
  }
}

export function installAdminTranslations(): () => void {
  applyAdminTranslations();
  let timer: number | null = null;
  const observer = new MutationObserver(() => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      applyAdminTranslations();
    }, 30);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
