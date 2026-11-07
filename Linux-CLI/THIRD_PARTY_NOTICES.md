# CloudBox 第三方开源组件与协议声明

版本：CloudBox v1.0.0  
更新日期：2026-11-07

CloudBox 使用了以下第三方开源软件、库和可执行工具。本项目仅通过独立进程、HTTP 接口或正常的库调用方式使用这些组件；除项目自身代码外，未修改任何第三方组件的源代码。

> 本文件用于告知许可证信息，不构成法律意见。各组件的完整许可证文本以其官方发布包、源码仓库或安装目录中的 LICENSE 文件为准。

## 1. 独立进程调用的外部工具

以下二进制工具由 CloudBox 以独立子进程方式调用，不嵌入、不修改、不静态链接其源代码：

| 组件 | 用途 | 许可证 | 调用方式 |
|---|---|---|---|
| frp / frpc | 内网穿透、HTTP/HTTPS 隧道 | Apache License 2.0 | `child_process.spawn` 启动独立 `frpc` 进程 |
| ClamAV / clamscan | 本地病毒扫描 | GNU General Public License v2.0 (GPLv2) | `child_process` 调用系统 `clamscan` |
| 7-Zip / 7za | zip/7z/rar/tar.gz 解压 | GNU Lesser General Public License v2.1 or later (LGPL-2.1+)；7za 同时受 unRAR 相关限制条款约束 | `node-7z` 通过 `child_process` 启动独立 `7za` 进程 |

说明：

- frp 项目：https://github.com/fatedier/frp ，许可证 Apache-2.0。
- ClamAV 项目：https://www.clamav.net/ ，许可证 GPLv2；ClamAV 作为独立程序运行，CloudBox 不修改其源码。
- 7-Zip 项目：https://www.7-zip.org/ ，7za 以 LGPL 方式使用；本项目未修改 7za 二进制。
- 7za 的 unRAR 代码受独立限制条款约束；再分发时请同时保留 7-Zip 的 LICENSE、unRAR 限制说明及版权声明。
- Linux 版本不包含 Electron、Chromium 或管理员 GUI。

## 2. 运行时与框架

| 组件 | 用途 | 许可证 |
|---|---|---|
| Node.js | JavaScript 运行时 | MIT（包含 OpenSSL、V8 等第三方组件，详见 Node.js 发行包） |
| Express | HTTP 服务框架 | MIT |
| better-sqlite3 | SQLite 数据库绑定 | MIT |
| SQLite | 嵌入式数据库 | Public Domain |
| zod | 运行时参数校验 | MIT |
| busboy | multipart 上传解析 | MIT |
| file-type | 文件类型识别 | MIT |
| chardet | 文本编码检测 | MIT |
| iconv-lite | 字符编码转换 | MIT |
| mime-types | MIME 类型解析 | MIT |
| helmet | HTTP 安全响应头 | MIT |
| express-rate-limit | 请求限流 | MIT |
| nodemailer | SMTP 邮件发送 | MIT |
| node-7z | 7-Zip 子进程封装 | MIT |
| 7zip-bin | 7za 二进制分发 | MIT（7za 本体为 LGPL-2.1+） |
| adm-zip | ZIP 处理 | MIT |
| clamscan (npm) | ClamAV Node.js 封装 | MIT（ClamAV 本体为 GPLv2） |
| @modelcontextprotocol/sdk | MCP Server/Client | MIT |
| node-forge | TLS/证书处理 | BSD-3-Clause |
| qrcode | 二维码生成 | MIT |
| pdfjs-dist | PDF 渲染 | Apache-2.0 |
| i18next | 国际化核心 | MIT |
| react-i18next | React i18n 绑定 | MIT |
| commander | Linux CLI 参数解析 | MIT |

## 3. 前端与构建工具（仅 Windows GUI 源码包含）

| 组件 | 用途 | 许可证 |
|---|---|---|
| Electron | Windows 桌面容器 | MIT |
| Chromium | Electron 渲染引擎 | BSD-style 及第三方许可证 |
| React / React DOM | Web 与管理端 UI | MIT |
| Zustand | 前端状态管理 | MIT |
| Vite | 前端构建 | MIT |
| Tailwind CSS | 样式工具 | MIT |
| TypeScript | 类型系统与编译 | Apache-2.0 |
| esbuild | 打包/转译 | MIT |
| electron-builder | Windows 安装包构建 | MIT |
| Playwright Core | E2E 测试 | Apache-2.0 |
| jszip | 测试辅助 | MIT |
| selfsigned | 测试证书 | MIT |

## 4. 许可证保留与再分发

- Windows 安装包通过 Electron 分发时，Electron/Chromium 的完整第三方许可证清单随 Electron 发行包提供。
- Linux 版本不包含 Electron、Chromium 或管理员 GUI。
- `resources/bin/7za` 随 Linux 版本分发时，应保留 `LICENSE-7zip-bin.txt` 及 7-Zip 的许可证/限制说明。
- 如再分发 frp、ClamAV，请分别遵守 Apache-2.0 与 GPLv2 的条款，并保留对应版权和许可证文件。
- 本项目仅通过独立进程调用 frp、ClamAV、7za，未修改其源代码，也未将其源代码与 CloudBox 代码合并。

## 5. 联系方式

如对第三方组件归属或许可证有疑问，请通过项目仓库 Issue 联系维护者，并在再分发前核对所使用版本的官方许可证文本。

---

# CloudBox Third-Party Open-Source Notices — English

Version: CloudBox v1.0.0  
Updated: 2026-11-07

CloudBox uses the third-party open-source software, libraries and executable tools listed below. CloudBox uses these components only through separate processes, HTTP interfaces or normal library calls. Except for CloudBox's own code, no third-party source code has been modified.

> This document provides license information and is not legal advice. The complete license text for each component is the LICENSE file in its official release package, source repository or installation directory.

## 1. External Tools Invoked as Separate Processes

The following binaries are invoked by CloudBox as separate child processes. They are not embedded, modified or statically linked into CloudBox:

| Component | Purpose | License | Integration |
|---|---|---|---|
| frp / frpc | NAT traversal and HTTP/HTTPS tunnels | Apache License 2.0 | `child_process.spawn` starts a separate `frpc` process |
| ClamAV / clamscan | Local antivirus scanning | GNU General Public License v2.0 (GPLv2) | `child_process` invokes the system `clamscan` |
| 7-Zip / 7za | zip/7z/rar/tar.gz extraction | GNU Lesser General Public License v2.1 or later (LGPL-2.1+), subject to the unRAR restriction | `node-7z` starts a separate `7za` process |
| mkcert (optional) | Local development certificates | BSD 3-Clause / MIT (per the actual distribution) | Invoked as an external process when used |

Notes:

- frp: https://github.com/fatedier/frp — Apache-2.0.
- ClamAV: https://www.clamav.net/ — GPLv2. ClamAV runs as a separate program; CloudBox does not modify its source.
- 7-Zip: https://www.7-zip.org/ — 7za is used under LGPL; CloudBox does not modify the 7za binary.
- The unRAR code in 7za is subject to separate restrictions. When redistributing, retain the 7-Zip LICENSE, the unRAR restriction notice and the copyright notices.

## 2. Runtime and Frameworks

| Component | Purpose | License |
|---|---|---|
| Electron | Windows desktop container | MIT |
| Node.js | JavaScript runtime | MIT (includes OpenSSL, V8 and other third-party components; see the Node.js distribution) |
| Chromium | Electron rendering engine | BSD-style and third-party licenses; see the Electron/Chromium distribution |
| Express | HTTP server framework | MIT |
| better-sqlite3 | SQLite database binding | MIT |
| SQLite | Embedded database | Public Domain |
| zod | Runtime validation | MIT |
| busboy | multipart upload parser | MIT |
| file-type | File type detection | MIT |
| chardet | Text encoding detection | MIT |
| iconv-lite | Character encoding conversion | MIT |
| mime-types | MIME type parsing | MIT |
| helmet | HTTP security headers | MIT |
| express-rate-limit | Request rate limiting | MIT |
| nodemailer | SMTP email delivery | MIT |
| node-7z | 7-Zip child-process wrapper | MIT |
| 7zip-bin | 7za binary distribution | MIT (7za itself is LGPL-2.1+) |
| adm-zip | ZIP handling | MIT |
| clamscan (npm) | ClamAV Node.js wrapper | MIT (ClamAV itself is GPLv2) |
| @modelcontextprotocol/sdk | MCP Server/Client | MIT |
| @mkcert/node | Local certificate helper | MIT (per the actual package) |
| node-forge | TLS/certificate handling | BSD-3-Clause |
| qrcode | QR code generation | MIT |
| pdfjs-dist | PDF rendering | Apache-2.0 |
| i18next | Internationalization core | MIT |
| react-i18next | React i18n binding | MIT |
| commander | Linux CLI argument parsing | MIT |

## 3. Frontend and Build Tools (included only in the Windows GUI source)

| Component | Purpose | License |
|---|---|---|
| React / React DOM | Web and administrator UI | MIT |
| Zustand | Frontend state management | MIT |
| Vite | Frontend build tool | MIT |
| Tailwind CSS | Styling | MIT |
| TypeScript | Type system and compiler | Apache-2.0 |
| esbuild | Bundling/transpilation | MIT |
| electron-builder | Windows installer build | MIT |
| Playwright Core | End-to-end testing | Apache-2.0 |
| jszip | Test helper | MIT |
| selfsigned | Test certificates | MIT |

## 4. License Retention and Redistribution

- When distributing Electron through the Windows installer, include the complete Electron/Chromium third-party license list provided with the Electron distribution.
- The Linux edition does not include Electron, Chromium or the administrator GUI.
- When redistributing `resources/bin/7za` with the Linux edition, retain `LICENSE-7zip-bin.txt` and the 7-Zip license/restriction notices.
- When redistributing frp or ClamAV, comply with Apache-2.0 and GPLv2 respectively, and retain their copyright and license files.
- CloudBox invokes frp, ClamAV and 7za only as separate processes. It does not modify their source code or merge their source with CloudBox code.

## 5. Contact

For questions about third-party attribution or licensing, contact the maintainers through the project repository issues. Before redistributing, verify the official license text for the exact versions used.
