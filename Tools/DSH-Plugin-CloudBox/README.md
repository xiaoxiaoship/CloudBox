# dsh-plugin-cloudbox

DSH/Cordis 插件：通过 CloudBox 原生 MCP Server 把网盘文件工具注册给 DSH 模型。

## 安装到 DSH

成品包：

```text
dsh-plugin-cloudbox-1.0.0.tar.gz
```

在 DSH 插件管理中选择该压缩包安装，或使用：

```bash
dsh plugin --profile default add ./dsh-plugin-cloudbox-1.0.0.tar.gz
```

插件已声明 DSH bundle：

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

安装后重启 DSH。

## 配置

在 DSH 的插件配置中填写：

```yaml
cloudboxUrl: https://127.0.0.1:8888
mcpToken: cbx_xxxxxxxxxxxxxxxxx
```

`mcpToken` 在 CloudBox 管理端：

```text
系统设置 → AI 与 MCP 服务
```

生成，且 CloudBox 必须同时开启 AI 总开关和 MCP 服务。

也支持环境变量：

```text
CLOUDBOX_URL
CLOUDBOX_MCP_TOKEN
```

首次安装未填写 Token 时，插件不会报安装失败，只会记录提示；填入 Token 并重启/重载后即可注册工具。

## 提供的工具

工具名会注册为：

```text
cloudbox_*
```

例如：

```text
cloudbox_list_files
cloudbox_read_text_file
cloudbox_write_text_file
```

## 网盘路径 vs 本地路径

- 网盘路径：相对于 CloudBox 用户根目录的 POSIX 路径，如 `src/main.py`、`照片/2026.jpg`。
- 本地路径：DSH 所在机器的宿主机路径，CloudBox MCP 不接受，会由 safePath 拒绝。
- 需要操作本地文件时，请使用 DSH 自带的本地工具，而不是 `cloudbox_*` 工具。

## 安全说明

- CloudBox 对每个 path 执行 safePath 校验，拒绝 `../`、绝对路径和越出用户根目录的路径。
- MCP 使用 Bearer Token 鉴权；Token 只绑定一个 CloudBox 用户根目录。
- CloudBox 对 MCP 的写/删除操作记录审计日志。
