# CloudBox v0.1.0

CloudBox 是一个本地多用户网盘系统，提供 Windows Electron 管理员控制台、Web 用户端，以及独立无头 Linux CLI 版本。

CloudBox is a local multi-user network drive with a Windows Electron administrator console, a browser-based web client, and a standalone headless Linux CLI edition.

> Windows 安装包体积超过 GitHub 普通 Git 的 100MB 单文件限制，因此安装包通过 **GitHub Releases** 提供；源码与文档保存在仓库中。
>
> The Windows installers exceed GitHub's 100MB per-file limit for regular Git, so they are provided as **GitHub Releases** assets; source and documentation are in the repository.

## 下载 / Downloads

| 文件 / File | 说明 / Description |
|---|---|
| [CloudBox-Setup-0.1.0-x64.exe](https://github.com/xiaoxiaoship/CloudBox/releases/download/v0.1.0/CloudBox-Setup-0.1.0-x64.exe) | Windows 安装版 / Windows installer |
| [CloudBox-Portable-0.1.0-x64.exe](https://github.com/xiaoxiaoship/CloudBox/releases/download/v0.1.0/CloudBox-Portable-0.1.0-x64.exe) | Windows 便携版 / Windows portable |
| [cloudbox-linux-0.1.0.tar.gz](https://github.com/xiaoxiaoship/CloudBox/releases/download/v0.1.0/cloudbox-linux-0.1.0.tar.gz) | Linux CLI 发布包 / Linux CLI package |

也可直接查看 [Releases](https://github.com/xiaoxiaoship/CloudBox/releases/tag/v0.1.0)。

## 仓库结构 / Repository Layout

```text
CloudBox_v0.1.0_Release/
├─ Windows-GUI/
│  ├─ bin/                     # Windows 安装包（通过 Releases 提供）
│  ├─ source/                  # Windows 完整源码
│  ├─ docs/PLUGIN_API.md
│  ├─ THIRD_PARTY_NOTICES.md
│  └─ README_Windows.md
├─ Linux-CLI/
│  ├─ bin/                     # Linux 发布包 / install.sh / systemd unit
│  ├─ source/                  # Linux CLI 源码
│  ├─ docs/PLUGIN_API.md
│  ├─ THIRD_PARTY_NOTICES.md
│  └─ README_Linux.md
└─ README.md
```

## 中文说明

### 核心功能

- 本地多用户网盘：上传、下载、目录、配额
- 图片、视频、音频、PDF、文本在线预览，支持 HTTP Range
- 文件分享、7za 安全解压、ClamAV 本地查杀
- AI 助手与 MCP Server
- 插件平台：独立子进程、沙箱 iframe 配置界面
- 静态网站托管
- 邮件告警（SMTP 密码 AES-256-GCM 加密）
- 中英文界面、用户头像
- 私有 CA / HTTPS / mTLS、frp 内网穿透、目录迁移

### Windows 安装

1. 下载 `CloudBox-Setup-0.1.0-x64.exe` 或 `CloudBox-Portable-0.1.0-x64.exe`。
2. 运行安装程序或便携版。
3. 首次启动创建管理员账号。
4. 在管理员控制台开启“本地 Web 服务”，用浏览器访问提示地址。

安装包未签名，Windows SmartScreen 可能提示“未知发布者”。请核对下载来源后继续。

### Linux CLI

```bash
tar -xzf cloudbox-linux-0.1.0.tar.gz
cd cloudbox-linux-0.1.0
sudo bash install.sh
```

详细命令、部署方式与功能差异见 [Linux-CLI/README_Linux.md](Linux-CLI/README_Linux.md)。

### 文档

- [Windows 说明 / Windows README](Windows-GUI/README_Windows.md)
- [Linux 说明 / Linux README](Linux-CLI/README_Linux.md)
- [插件 API / Plugin API](Windows-GUI/docs/PLUGIN_API.md)
- [第三方开源声明 / Third-Party Notices](Windows-GUI/THIRD_PARTY_NOTICES.md)

### 致谢与开源协议

CloudBox 使用了 **frp**（Apache-2.0）进行内网穿透、**ClamAV**（GPLv2）进行本地查杀、**7-Zip / 7za**（LGPL-2.1+，含 unRAR 限制）进行解压；这些工具均通过独立进程调用，未修改其源码。

完整组件和许可证信息见 [THIRD_PARTY_NOTICES.md](Windows-GUI/THIRD_PARTY_NOTICES.md)。

## English

### Core Features

- Local multi-user drive with uploads, downloads, folders and quotas
- Image, video, audio, PDF and text previews with HTTP Range seeking
- Share links, secure 7za extraction and ClamAV scanning
- AI assistant and MCP server
- Plugin platform with isolated child processes and sandboxed iframe configuration UIs
- Static website hosting
- SMTP email alerts with AES-256-GCM encrypted passwords
- Chinese/English UI and user avatars
- Private CA / HTTPS / mTLS, frp tunneling and data-directory migration

### Windows Installation

1. Download `CloudBox-Setup-0.1.0-x64.exe` or `CloudBox-Portable-0.1.0-x64.exe`.
2. Run the installer or portable executable.
3. Create the administrator account on first launch.
4. Enable the local web service in the administrator console and open the displayed address.

The installers are unsigned. Windows SmartScreen may report an “Unknown publisher” warning; verify the download source before continuing.

### Linux CLI

```bash
tar -xzf cloudbox-linux-0.1.0.tar.gz
cd cloudbox-linux-0.1.0
sudo bash install.sh
```

See [Linux-CLI/README_Linux.md](Linux-CLI/README_Linux.md) for commands, deployment and feature differences.

### Documentation

- [Windows README](Windows-GUI/README_Windows.md)
- [Linux README](Linux-CLI/README_Linux.md)
- [Plugin API](Windows-GUI/docs/PLUGIN_API.md)
- [Third-Party Notices](Windows-GUI/THIRD_PARTY_NOTICES.md)

### Acknowledgments and Licenses

CloudBox uses **frp** (Apache-2.0) for NAT traversal, **ClamAV** (GPLv2) for local antivirus scanning, and **7-Zip / 7za** (LGPL-2.1+, including the unRAR restriction) for archive extraction. These tools are invoked as separate processes; their source code is not modified.

See [THIRD_PARTY_NOTICES.md](Windows-GUI/THIRD_PARTY_NOTICES.md) for the complete component and license inventory.

## License

CloudBox 项目自身代码的许可证由仓库维护者补充；第三方组件遵循各自许可证。
The license for CloudBox's own code is to be provided by the repository maintainer; third-party components remain under their respective licenses.
