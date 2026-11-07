## 近期重要变更

- 管理端侧边栏不再显示监听端口，改为实时显示上传/下载速率（2 秒采样，基于服务端累计收发字节）。
- 静态托管支持 TCP 端口映射：可直接使用 `https://公网IP:映射端口/` 作为公网基础地址；TCP 不携带真实客户端 IP。HTTP/HTTPS 隧道仍推荐用于域名、`locations` 和真实 IP。
- **PROXY protocol v2 当前未适配**：Express/HTTPS 前端不会解析 PROXY v2 头。开启后 frpc 会把 PROXY 头直接发给 HTTPS 监听器，导致 TLS 握手/请求失败。当前版本已禁用该选项并停止生成 `transport.proxyProtocolVersion`；这不是 frps 的问题，而是本地前端未实现 PROXY v2 解析。建议使用 HTTP/HTTPS 隧道，或在未来版本加入 PROXY 前端适配。
- 私有 CA 一键签发服务端证书时新增“包含的域名或 IP（多个用英文逗号分隔）”。会动态追加到 mkcert SAN，并始终保留 `localhost`、`127.0.0.1`、`::1`、本机 hostname 和本机局域网 IP；根 CA 不变。
- Web 文件页补齐英文：标题、面包屑、上传/刷新/删除、表头、空状态、操作提示和存储空间等；管理端状态栏保持中英文显示正确。

## Recent Changes

- The admin sidebar no longer displays the listening port; it now shows real-time upload/download rates (sampled every 2 seconds from server byte counters).
- Static hosting supports TCP port mapping: use `https://public-ip:mapped-port/` as the public base URL. TCP does not carry the real client IP. HTTP/HTTPS tunnels remain recommended for domains, `locations` and real client IPs.
- **PROXY protocol v2 is not adapted yet**: the Express/HTTPS frontend does not parse PROXY v2 headers. Enabling it sends the PROXY header directly to the HTTPS listener and breaks the TLS handshake/request. The option is now disabled and `transport.proxyProtocolVersion` is no longer generated. This is a local frontend limitation, not an frps problem. Use HTTP/HTTPS tunnels, or add a PROXY-aware frontend in a future release.
- One-click private CA server-certificate issuance now accepts “Included domains or IPs (comma-separated)”. Values are appended to the mkcert SAN; `localhost`, `127.0.0.1`, `::1`, the hostname and LAN IPs are always included. The root CA is unchanged.
- The web file page now has complete English labels for title, breadcrumbs, upload/refresh/delete, table headers, empty state, action titles and storage. Admin status text remains correct in both languages.
