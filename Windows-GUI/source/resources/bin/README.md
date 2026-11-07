# frpc

- 版本：v0.72.0（windows_amd64）
- 来源：https://github.com/fatedier/frp/releases/tag/v0.72.0
- 许可证：Apache-2.0（见同目录 LICENSE）
- SHA-256：`B8580B916ECB2E27ECC348BC67BC8B93B0E65266F85FD5D703E2F2F69862B089`

`frpc.exe` 由 CloudBox 管理端作为子进程托管，读取 `data/config/frpc.toml`。
升级时请替换本目录的 `frpc.exe`，并重新执行 `npm run dist:win`。

如果构建环境无法联网下载，也可以手动把对应平台的 `frpc.exe` 放入本目录。

## mkcert

- 版本：随 `@mkcert/node` 0.1.3 附带的 Windows x64 二进制
- 来源：https://github.com/FiloSottile/mkcert
- 许可证：MIT（见同目录 `LICENSE-mkcert.md`）
- SHA-256：`D75ABF3C940AFCAF0442645B4EE45099EC7F14B06EE8AAF43F5847AFEB35C10C`

开发模式下 CaManager 调用 `@mkcert/node` 的 `generate/install/uninstall`；
打包后改用本目录的 `mkcert.exe`，避免 asar 内二进制不可执行的问题。

## 7za

- 来源：`7zip-bin` 5.2.0（Windows x64）
- 用途：`node-7z` 在线解压；开发环境使用 `7zip-bin` 路径，打包后使用本目录的 `7za.exe`
- 许可证：见 `LICENSE-7zip-bin.txt`
