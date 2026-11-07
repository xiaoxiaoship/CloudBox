# dsh-plugin-cloudbox

DSH 的 CloudBox 网盘对接插件。它通过 CloudBox 原生 MCP Server 拉取文件工具，并动态注册给 DSH 模型。

## 配置

```json
{
  "cloudboxUrl": "http://127.0.0.1:8686",
  "mcpToken": "cbx_xxxxxxxxxxxxxxxxx"
}
```

`mcpToken` 在 CloudBox 管理员“系统设置 → AI 与 MCP 服务”中生成；CloudBox 必须同时开启 AI 总开关与 MCP 服务。

## 安装到 DSH

1. 在 CloudBox 中启用 AI 与 MCP，复制 MCP Token。
2. 构建插件：

```bash
cd dsh-plugin-cloudbox
npm install
npm run build
```

3. 将 `dsh-plugin-cloudbox` 目录作为本地 DSH 插件挂载，配置项填入 `cloudboxUrl` 与 `mcpToken`。
4. 重启 DSH，确认工具列表中出现 `cloudbox_list_files`、`cloudbox_read_text_file`、`cloudbox_write_text_file` 等工具。
5. 当 DSH 使用这些工具时，System Prompt 会注入：

> 你当前接入的是一个远程网盘系统（CloudBox）。所有文件工具的 `path` 参数必须是网盘内部的相对路径（如 `src/main.py`），绝对不能传入你本地宿主机的绝对路径（如 `C:\` 或 `/Users/`）。如果想操作本地文件，请使用你自带的本地工具。

## 网盘路径 vs 本地路径

- **网盘路径**：相对于 CloudBox 用户根目录的 POSIX 路径，如 `src/main.py`、`照片/2026.jpg`。这些工具只操作网盘。
- **本地路径**：DSH 所在机器的宿主机路径，如 `C:\Users\me\project\main.py` 或 `/Users/me/main.py`。CloudBox MCP **不接受**这些路径，传入会被 safePath 拒绝。
- 需要操作本地文件时，使用 DSH 自带的本地文件工具，而不是 `cloudbox_*` 工具。

## 安全说明

- CloudBox 端对每个 path 执行 safePath 校验，拒绝 `../`、绝对路径和跳出用户根目录。
- MCP 使用 Bearer Token 鉴权；Token 只绑定一个 CloudBox 用户根目录。
- CloudBox 对 MCP 的写/删除操作记录审计日志。
