# CloudBox Linux CLI v1.0.0

CloudBox Linux 是无头命令行版本，不包含 Electron、Chromium 或管理员 GUI；保留核心网盘后端和 Web 用户端。

## 部署指南

### 环境要求

- Linux x86_64
- Node.js >= 22.18
- 可选：ClamAV（`/usr/bin/clamscan`）
- 可选：frpc（内网穿透，放入 PATH 或 `resources/bin/frpc`）
- 可选：7za（压缩包已提供 `resources/bin/7za`）

### 安装

```bash
tar -xzf cloudbox-linux-0.1.0.tar.gz
cd cloudbox-linux-0.1.0
sudo bash install.sh
```

安装脚本会：

1. 创建 `cloudbox` 系统用户
2. 部署到 `/opt/cloudbox`
3. 创建 `/var/lib/cloudbox`
4. 安装生产依赖
5. 注册并启动 `cloudbox.service`

### 手动运行

```bash
cd source
npm install
node src/cli/index.ts init
node src/cli/index.ts start
```

便携模式（数据写入当前目录 `./data`）：

```bash
node src/cli/index.ts --portable start
```

默认监听 `0.0.0.0:8686`，Web 用户端使用 `dist/web`。

## 指令大全

```text
cloudbox start [--portable] [--port <port>] [--host <host>]
cloudbox init [--username <name>] [--password <password>]
cloudbox config get [key]
cloudbox config set <port|host> <value>
cloudbox reset-admin [--password <password>]
cloudbox plugin list
cloudbox plugin enable <name>
cloudbox plugin disable <name>
```

示例：

```bash
cloudbox init --username admin
cloudbox start --portable --port 8686
cloudbox config set port 9000
cloudbox reset-admin
cloudbox plugin list
```

## 功能差异说明

Linux CLI 保留：

- SQLite、用户/配额、文件上传下载、预览与 Range
- 分享、解压、ClamAV 查杀、AI、MCP
- 插件子进程、静态托管、邮件告警
- Web 用户端

Linux CLI 不包含：

- Electron 管理员 GUI
- 私有 CA / HTTPS / mTLS 管理
- frp 可视化配置与启动管理（仅提供 `frpc` 解析）
- 可视化目录迁移
- 完整的邮件/AI/MCP/托管/权限设置 CLI（目前 `config` 仅支持 port/host）

需要 HTTPS 时，建议使用 Nginx/Caddy 反向代理。

## 致谢与开源协议

CloudBox Linux 使用了以下开源项目：

- **frp**：内网穿透与 HTTP/HTTPS 隧道，Apache-2.0；通过独立 `frpc` 进程调用，未修改源码。
- **ClamAV**：本地病毒扫描，GPLv2；调用系统 `/usr/bin/clamscan`，未修改源码。
- **7-Zip / 7za**：压缩包解压，LGPL-2.1+（含 unRAR 限制条款）；通过独立 `7za` 进程调用，未修改源码。
- Node.js、Express、better-sqlite3、i18next、MCP SDK 等，详见完整清单。

完整组件与许可证信息见：

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

Linux 发布包不包含 Electron 与 Chromium；7za 以独立二进制形式分发，未与 CloudBox 源码合并。

---

# CloudBox Linux CLI v1.0.0 — English

CloudBox Linux is a headless command-line edition. It does not include Electron, Chromium or the administrator GUI; it retains the core drive backend and web client.

## Deployment Guide

### Requirements

- Linux x86_64
- Node.js >= 22.18
- Optional: ClamAV (`/usr/bin/clamscan`)
- Optional: frpc (NAT traversal; place it in PATH or `resources/bin/frpc`)
- Optional: 7za (the archive includes `resources/bin/7za`)

### Installation

```bash
tar -xzf cloudbox-linux-0.1.0.tar.gz
cd cloudbox-linux-0.1.0
sudo bash install.sh
```

The installer will:

1. Create the `cloudbox` system user
2. Deploy to `/opt/cloudbox`
3. Create `/var/lib/cloudbox`
4. Install production dependencies
5. Register and start `cloudbox.service`

### Manual Run

```bash
cd source
npm install
node src/cli/index.ts init
node src/cli/index.ts start
```

Portable mode (data in `./data` under the current directory):

```bash
node src/cli/index.ts --portable start
```

The server listens on `0.0.0.0:8686` by default and serves the web client from `dist/web`.

## Command Reference

```text
cloudbox start [--portable] [--port <port>] [--host <host>]
cloudbox init [--username <name>] [--password <password>]
cloudbox config get [key]
cloudbox config set <port|host> <value>
cloudbox reset-admin [--password <password>]
cloudbox plugin list
cloudbox plugin enable <name>
cloudbox plugin disable <name>
```

Examples:

```bash
cloudbox init --username admin
cloudbox start --portable --port 8686
cloudbox config set port 9000
cloudbox reset-admin
cloudbox plugin list
```

## Feature Differences

The Linux CLI includes:

- SQLite, users/quotas, file upload/download, previews and HTTP Range
- Sharing, archive extraction, ClamAV scanning, AI and MCP
- Plugin child processes, static hosting and email alerts
- Web client

The Linux CLI does not include:

- The Electron administrator GUI
- Private CA / HTTPS / mTLS management
- Visual frp configuration and process management (only `frpc` binary resolution is provided)
- Visual data-directory migration
- Complete CLI settings for email/AI/MCP/hosting/permissions (currently `config` supports only port and host)

For HTTPS, use an Nginx or Caddy reverse proxy.

## Acknowledgments and Open Source Licenses

CloudBox Linux uses the following open-source projects:

- **frp**: NAT traversal and HTTP/HTTPS tunnels, Apache-2.0; invoked as a separate `frpc` process without source modifications.
- **ClamAV**: local antivirus scanning, GPLv2; invoked as the system `/usr/bin/clamscan` without source modifications.
- **7-Zip / 7za**: archive extraction, LGPL-2.1+ (including the unRAR restriction); invoked as a separate `7za` process without source modifications.
- Node.js, Express, better-sqlite3, i18next, the MCP SDK and others are listed in the full inventory.

See the complete component and license information here:

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

The Linux release does not include Electron or Chromium. 7za is distributed as a separate binary and is not merged with CloudBox source code.
