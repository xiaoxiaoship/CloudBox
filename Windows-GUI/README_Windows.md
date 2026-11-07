# CloudBox Windows GUI v1.0.0

CloudBox 是本地多用户网盘程序，Windows 版本提供管理员 Electron 控制台和浏览器 Web 用户端。

## 核心功能

- 本地多用户文件网盘：上传、下载、目录管理、配额
- 图片 / 视频 / 音频 / PDF / 文本在线预览，支持 HTTP Range 拖动
- 文件分享链接、有效期与访问控制
- 7za 解压 zip / 7z / rar / tar.gz，带路径穿越防护
- ClamAV 本地查杀 / VirusTotal API 查杀
- 原生 AI 助手、MCP Server
- 插件平台：独立子进程、沙箱 iframe 配置界面
- 内嵌静态网站托管
- 邮件告警（SMTP，密码 AES-256-GCM 加密）
- 中英文双语、用户头像
- 私有 CA / HTTPS / mTLS、frp 内网穿透、目录迁移

## 安装

### 安装版

1. 打开 `bin/CloudBox-Setup-0.1.0-x64.exe`。
2. 按安装向导完成安装。
3. 启动 CloudBox。
4. 首次使用创建管理员账号并设置数据目录。
5. 管理员控制台开启“本地 Web 服务”，浏览器访问提示的地址。

### 便携版

1. 打开 `bin/CloudBox-Portable-0.1.0-x64.exe`。
2. 首次启动创建管理员账号。
3. 数据默认保存在 `%APPDATA%/CloudBox`；可在系统设置中更改数据目录。

> 安装包未配置代码签名证书，Windows SmartScreen 可能提示“未知发布者”。请核对文件来源后继续。

## 目录说明

```text
Windows-GUI/
├─ bin/
│  ├─ CloudBox-Setup-0.1.0-x64.exe
│  └─ CloudBox-Portable-0.1.0-x64.exe
├─ source/                 # 完整工程源码（不含 node_modules/release/.git）
├─ docs/
│  └─ PLUGIN_API.md
├─ THIRD_PARTY_NOTICES.md
└─ README_Windows.md
```

## 致谢与开源协议

CloudBox 的实现离不开以下开源项目：

- **frp**：用于内网穿透和 HTTP/HTTPS 隧道，许可证 Apache-2.0。CloudBox 通过独立 `frpc` 子进程调用，未修改其源码。
- **ClamAV**：用于本地病毒扫描，许可证 GPLv2。CloudBox 通过独立 `clamscan` 进程调用，未修改其源码。
- **7-Zip / 7za**：用于压缩包解压，7za 使用 LGPL-2.1+（并受 unRAR 相关限制条款约束）。CloudBox 通过 `node-7z` 启动独立 `7za` 进程，未修改其源码。
- Electron、Node.js、Express、better-sqlite3、React、Vite、Tailwind CSS、i18next、pdfjs-dist 等，详见组件清单。

完整的第三方组件、版本用途、许可证和再分发注意事项见：

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

CloudBox 仅通过独立进程或正常库调用使用第三方组件；未修改 frp、ClamAV、7za 的源代码，也未将其源码与 CloudBox 代码合并。

---

# CloudBox Windows GUI v1.0.0 — English

CloudBox is a local multi-user network drive. The Windows edition provides an Electron administrator console and a browser-based web client.

## Core Features

- Local multi-user drive: uploads, downloads, folders and quotas
- Image, video, audio, PDF and text previews with HTTP Range seeking
- Share links with expiry and access control
- Archive extraction for zip / 7z / rar / tar.gz with path-traversal protection
- ClamAV local scanning and VirusTotal API scanning
- Native AI assistant and MCP server
- Plugin platform with isolated child processes and sandboxed iframe configuration UIs
- Embedded static website hosting
- SMTP email alerts with AES-256-GCM encrypted passwords
- Chinese/English UI and user avatars
- Private CA / HTTPS / mTLS, frp tunneling and data-directory migration

## Installation

### Installer

1. Run `bin/CloudBox-Setup-0.1.0-x64.exe`.
2. Follow the installation wizard.
3. Start CloudBox.
4. On first run, create the administrator account and choose the data directory.
5. In the administrator console, enable the local web service and open the displayed address in a browser.

### Portable

1. Run `bin/CloudBox-Portable-0.1.0-x64.exe`.
2. Create the administrator account on first launch.
3. Data is stored in `%APPDATA%/CloudBox` by default; change it in Settings.

> The installers are not code-signed. Windows SmartScreen may show an “Unknown publisher” warning. Verify the file source before continuing.

## Directory Layout

```text
Windows-GUI/
├─ bin/
│  ├─ CloudBox-Setup-0.1.0-x64.exe
│  └─ CloudBox-Portable-0.1.0-x64.exe
├─ source/                 # full source (without node_modules/release/.git)
├─ docs/
│  └─ PLUGIN_API.md
├─ THIRD_PARTY_NOTICES.md
└─ README_Windows.md
```

## Acknowledgments and Open Source Licenses

CloudBox is built on the following open-source projects:

- **frp**: used for NAT traversal and HTTP/HTTPS tunnels, licensed under Apache-2.0. CloudBox invokes it as a separate `frpc` process and does not modify its source.
- **ClamAV**: used for local antivirus scanning, licensed under GPLv2. CloudBox invokes it as a separate `clamscan` process and does not modify its source.
- **7-Zip / 7za**: used for archive extraction. 7za is licensed under LGPL-2.1+ and is subject to the unRAR restriction. CloudBox starts a separate `7za` process through `node-7z` and does not modify its source.
- Electron, Node.js, Express, better-sqlite3, React, Vite, Tailwind CSS, i18next, pdfjs-dist and others are listed in the component inventory.

See the complete third-party component, license and redistribution information here:

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

CloudBox uses third-party components only through separate processes or normal library calls. It does not modify the source code of frp, ClamAV or 7za, and does not merge their source code with CloudBox.
