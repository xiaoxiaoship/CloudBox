# CloudBox-Linux

CloudBox 的无头 Linux 命令行版本，独立于 Windows Electron 工程，不包含 Electron、管理员 GUI 或构建工具链中的 Electron 依赖。

## 功能

- 无头 Express 服务，监听 `0.0.0.0`
- 原生用户/配额/文件/分享/权限/解压/查杀/AI/MCP/插件/静态托管/邮件 API
- 保留 Web 用户端（`dist/web`）
- Linux 路径：默认 `/var/lib/cloudbox`
- 便携模式：当前目录 `./data`
- Linux 二进制：`7za`（无 `.exe`）、`frpc`（无 `.exe`）
- ClamAV 默认：`/usr/bin/clamscan`

## 快速开始

```bash
# Node.js >= 22.18
npm install
node src/cli/index.ts init --username admin
node src/cli/index.ts --portable start --port 8686
```

或使用安装后的 `cloudbox`：

```bash
cloudbox init
cloudbox start
cloudbox start --portable
```

访问：

```text
http://127.0.0.1:8686/health
http://127.0.0.1:8686/
```

## CLI

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

全局 `--portable` 使用当前目录的 `./data`；否则 Linux 默认使用 `/var/lib/cloudbox`。

## systemd 安装

```bash
sudo ./install.sh
systemctl status cloudbox
```

安装脚本会：

1. 创建 `cloudbox` 系统用户
2. 复制到 `/opt/cloudbox`
3. 初始化 `/var/lib/cloudbox`
4. 安装生产依赖
5. 注册并启动 `cloudbox.service`

修改端口：

```bash
sudo -u cloudbox cloudbox config set port 9000
sudo systemctl restart cloudbox
```

## 打包

```bash
npm run package:tar
# cloudbox-linux-0.1.0.tar.gz
```

压缩包不包含 `node_modules`，部署后执行 `npm install --omit=dev`。

## 与 Windows 工程隔离

本目录是独立副本；`src/main`、`src/preload`、Electron 管理员 GUI 与构建配置均未复制。根目录的 Windows/Electron 工程不受影响。
