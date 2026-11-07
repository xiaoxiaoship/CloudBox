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

## 瀹屾暣鍔熻兘涓庡疄鐜版満鍒讹紙琛ュ厖锛?
### 璐﹀彿銆佷細璇濅笌瀹夊叏

- 瀵嗙爜浣跨敤 **scrypt** 鍝堝笇锛圢=32768锛夛紝鏁版嵁搴撲腑涓嶄繚瀛樻槑鏂囧瘑鐮併€?- 鐧诲綍浼氳瘽浣跨敤闅忔満浼氳瘽浠ょ墝锛涙暟鎹簱鍙繚瀛樹护鐗岀殑 SHA-256 鍝堝笇锛屾祻瑙堝櫒浣跨敤 `HttpOnly`銆乣SameSite=Lax` Cookie銆?- 榛樿浼氳瘽鏈夋晥鏈?`security.sessionTtlHours = 168` 灏忔椂锛沗last_seen` 姣?60 绉掓渶澶氭洿鏂颁竴娆★紝闄嶄綆鏁版嵁搴撳啓鍏ャ€?- 闈?GET/HEAD 璇锋眰瑕佹眰 CSRF Token锛汣SRF Cookie 涓?Session Cookie 鍒嗙銆?- **鐧诲綍澶辫触閿佸畾鎸夎处鍙疯鏁帮紝涓嶆槸鎸?IP**锛氶粯璁よ繛缁け璐?**5 娆?*鍚庨攣瀹氥€傜 5 娆¤捣閿佸畾 60 绉掞紝涔嬪悗鎸?`60s 脳 2^(澶辫触娆℃暟-5)` 鎸囨暟澧為暱锛屾渶闀?60 鍒嗛挓銆?- 绠＄悊鍛?GUI 鐨勨€滅敤鎴风鐞嗏€濇彁渚?**蹇€熻В閿?*锛氭竻闄よ璐﹀彿鐨?`failed_attempts` 涓?`locked_until`锛屾棤闇€绛夊緟閿佸畾鍒版湡锛涚敤鎴峰瘑鐮侀噸缃€佺鐢ㄨ处鍙枫€佷細璇濇挙閿€涔熷湪绠＄悊绔畬鎴愩€?- 璐﹀彿涓嶅瓨鍦ㄦ椂浠嶆墽琛屼竴娆?scrypt 鏍￠獙锛岄檷浣庨€氳繃鍝嶅簲鏃堕棿鏋氫妇鐢ㄦ埛鍚嶇殑椋庨櫓銆?- IP 缁村害鍙︽湁鐙珛闄愭祦锛氱櫥褰?30 娆?15 鍒嗛挓/IP锛涘叏閮?API 600 娆?鍒嗛挓/IP锛涗笂浼?120 娆?鍒嗛挓/IP锛涙敞鍐?2 娆?灏忔椂/IP锛涘垎浜垱寤?10 娆?鍒嗛挓/鐢ㄦ埛锛涘垎浜笅杞?60 娆?鍒嗛挓/IP+Token锛涜В鍘?鏌ユ潃 10 娆?鍒嗛挓/鐢ㄦ埛銆?- 闄愭祦瑙﹀彂杩斿洖 429锛屽苟鍙彂閫?`security.alert` 閭欢鍛婅锛涘彲閫変俊浠?`X-Forwarded-For`锛堜粎寤鸿鍦?frp/Nginx 鍙嶅悜浠ｇ悊鍚庡紑鍚級銆?- 瀹夊叏瀹¤璁板綍鐧诲綍鎴愬姛/澶辫触/閿佸畾銆侀€€鍑恒€佷細璇濊疆鎹?鎾ら攢銆佺鐞嗗憳閲嶇疆瀵嗙爜銆佺敤鎴风鐢?瑙ｉ攣銆佹彃浠跺惎鍋溿€佹墭绠″彉鏇淬€侀偖浠惰缃彉鏇寸瓑鎿嶄綔銆?- 鏂囦欢璺緞缁熶竴缁忚繃 `safePath` 鏍￠獙锛涙嫆缁?`..`銆佺粷瀵硅矾寰勩€佺鍙烽摼鎺ラ€冮€革紱涓婁紶涓存椂鐩綍銆侀厤棰濆拰鏂囦欢澶у皬鍧囧彈闄愩€?- 榛樿鍗曟枃浠朵笂闄?2 GB锛涙墍鏈変笂浼犻€氳繃 busboy 娴佸紡澶勭悊锛屼笉鎶婂畬鏁存枃浠惰鍏ュ唴瀛樸€?
### 鏂囦欢銆侀瑙堜笌鍒嗕韩

- 鏈湴澶氱敤鎴风綉鐩橈細鐩綍銆佷笂浼犮€佷笅杞姐€侀噸鍛藉悕銆佸垹闄ゃ€侀厤棰濄€佺敤閲忕粺璁°€?- 鍥剧墖/瑙嗛/PDF/鏂囨湰棰勮锛涢煶棰戞敮鎸?MP3/WAV/OGG/FLAC/AAC/M4A銆?- 棰勮鎺ュ彛浣跨敤鏈嶅姟绔?MIME 鐧藉悕鍗曚笌鏂囦欢榄旀暟鏍￠獙锛汬TML/SVG 绛変富鍔ㄥ唴瀹逛笉鍐呰仈鎵ц銆?- 涓嬭浇/棰勮鏀寔鍗曟 HTTP Range锛岃繑鍥?206銆乣Content-Range`銆乣Accept-Ranges`锛屽彲鎷栧姩鎾斁杩涘害銆?- 鏂囦欢鍒嗕韩浣跨敤闅忔満 Token锛屽彲璁剧疆鏈夋晥鏈燂紱鍏紑鍒嗕韩鎺ュ彛涓庣櫥褰曟€佸垎浜帴鍙ｅ垎绂汇€?- 7za 瑙ｅ帇 zip / 7z / rar / tar.gz锛涘鍘嬬缉鍖呮潯鐩€愭潯鍋氳矾寰勬牎楠岋紝闃绘 zip-slip锛涜В鍘嬭鍏ラ厤棰濄€?- ClamAV 鏈湴鏌ユ潃涓?VirusTotal API 鏌ユ潃锛沄irusTotal 鏂囦欢涓婇檺 32 MB锛沬nfected 鏂囦欢寮哄埗绂佹涓嬭浇銆佸垎浜拰瑙ｅ帇銆?- 闊抽鎾斁鍣細鍏ㄥ眬 Zustand 鐘舵€併€佸綋鍓嶇洰褰曡嚜鍔ㄦ挱鏀惧垪琛ㄣ€佷笂涓€棣?涓嬩竴棣栥€佽繘搴?闊抽噺銆佸垏鎹㈢洰褰曚笉涓柇锛涘獟浣撴祦鎸?Range 璇诲彇锛屼笉鏁撮杞藉叆鍐呭瓨銆?
### 鏉冮檺涓庣敤鎴?
- 绠＄悊鍛樺彲寮€鍏筹細鍥剧墖棰勮銆佽棰戦瑙堛€丳DF 棰勮銆佸湪绾胯В鍘嬨€佸畨鍏ㄦ煡鏉€銆?- 鍏抽棴鏉冮檺鍚?Web 绔殣钘忓叆鍙ｏ紝鍚庣鎺ュ彛鍚屾椂杩斿洖 403锛屼笉鑳介€氳繃鐩存帴璋冪敤缁曡繃銆?- 鐢ㄦ埛瑙掕壊锛氱鐞嗗憳/鏅€氱敤鎴凤紱鐘舵€侊細姝ｅ父/绂佺敤锛涢厤棰濆彲涓?null锛堜笉闄愰噺锛夈€?- 鐢ㄦ埛鍙嚜鍔╂敞鍐岋紙鍙紑鍏筹紝榛樿鍏抽棴锛夛紱娉ㄥ唽闄愭祦 2 娆?灏忔椂/IP锛岄粯璁ゅ垎閰?5 GB 閰嶉銆?- 鐢ㄦ埛鍙湪 Web Header 鐐瑰嚮澶村儚涓婁紶 PNG/JPEG/WebP锛堟渶澶?600 KB锛夛紱澶村儚浠?data URL 淇濆瓨鍒?`users.avatar_data`锛岀鐞嗙鐢ㄦ埛鍒楄〃鏄剧ず缂╃暐鍥俱€?
### AI 涓?MCP

- 鍘熺敓 AI 鍔╂墜鍏煎 OpenAI 椋庢牸 Chat Completions锛屾敮鎸?Function Calling / ReAct 宸ュ叿寰幆銆?- AI 妯″紡锛氱鐞嗗憳鍏变韩 Key 鎴栫敤鎴疯嚜濉?Key锛汚PI Key 浣跨敤 AES-256-GCM 鍔犲瘑钀界洏锛岀晫闈㈠彧鏄剧ず鑴辨晱鍊笺€?- 姣忔棩璇锋眰涓婇檺榛樿 50锛涘伐浣滆寖鍥村彲閫夆€滀粎鎸囧畾鏂囦欢澶光€濇垨鈥滃叏鐩樷€濓紙楂樺嵄锛夛紝楂樺嵄宸ュ叿璋冪敤闇€瑕佺敤鎴风‘璁ゃ€?- AI 宸ュ叿鐨勬枃浠惰矾寰勫悓鏍风粡杩囩綉鐩樼浉瀵硅矾寰勫拰 safePath 鏍￠獙锛屼笉鑳借闂涓绘満缁濆璺緞銆?- 涓嫳鏂囩晫闈㈠垏鎹㈡椂锛岃嫳鏂囪姹備細鍦?System Prompt 杩藉姞 鈥淧lease reply to the user in English.鈥濄€?- 鍘熺敓 MCP Server 浣跨敤 Streamable HTTP锛岀鐐?`/api/mcp`锛孊earer Token 閴存潈锛屽彲缁戝畾涓€涓綉鐩樼敤鎴凤紱鏀寔鏂囦欢鍒楄〃銆佽鍙栥€佸啓鍏ャ€佹悳绱㈢瓑宸ュ叿锛堜互瀹為檯宸ュ叿娉ㄥ唽琛ㄤ负鍑嗭級銆?
### 鎻掍欢骞冲彴

- 鎻掍欢鍦?`child_process.fork` 鐙珛瀛愯繘绋嬩腑杩愯锛涗富杩涚▼涓?`require` 鎻掍欢浠ｇ爜銆?- 瀛愯繘绋嬬幆澧冨彉閲忔渶灏忓寲锛涗富杩涚▼涓庢彃浠堕€氳繃 IPC 杞彂 HTTP 璇锋眰銆佷簨浠朵笌鏃ュ織銆?- 鎻掍欢 `manifest.json` 瀹氫箟鍚嶇О/鐗堟湰锛沗index.js` 瀵煎嚭 `activate(ctx)`銆?- `ctx` 鎻愪緵 `createRouter/registerRouter`銆乣on` 浜嬩欢銆乣storage` 绉佹湁瀛樺偍銆乣logger`銆乣manifest`銆?- 鎻掍欢绠＄悊绔?UI 浠?`sandbox="allow-scripts allow-forms"` iframe 鍔犺浇锛涙敮鎸?`web-theme.css` 娉ㄥ叆涓?`web-override/` 鎺ョ Web 棣栭〉銆?- 鎻掍欢瀵煎叆 ZIP 鏃堕€愭潯鏍￠獙璺緞锛屾嫆缁?`../` 鍜岀粷瀵硅矾寰勶紱鍚敤/绂佺敤/鎺ョ/鍗歌浇鍐欏璁℃棩蹇椼€?- 瀵煎叆榛樿绂佺敤锛涙彃浠跺紓甯歌繑鍥?`PLUGIN_ERROR`锛屼笉浼氳涓绘湇鍔″穿婧冦€?
### 闈欐€佹墭绠°€乀LS 涓?frp

- 闈欐€佺珯鐐规寕杞藉湪 `/host/:username/*`锛屾敮鎸?public/private 鍙鎬э紱private 绔欑偣蹇呴』鐧诲綍銆?- 鎵樼璇诲彇缁忚繃 safePath 鏍￠獙锛孋SP sandbox锛汼PA fallback 鍒?`index.html`銆?- 绉佹湁 CA 閫氳繃 mkcert 鐢熸垚锛涙湇鍔＄璇佷功浣嶄簬 `config/ssl/server/`锛孋A 浣嶄簬 `config/ssl/ca/`锛涙敮鎸?HTTPS 涓?mTLS銆?- 鐧诲綍椤靛湪 HTTPS 涓?CA 鍙敤鏃舵樉绀烘牴璇佷功涓嬭浇鍏ュ彛锛涘鎴风鏈俊浠?CA 鏃堕渶鍏堝湪娴忚鍣ㄤ腑缁х画璁块棶鎴栧鍏ユ牴璇佷功銆?- mTLS 寮€鍚悗瀹㈡埛绔繀椤诲厛鏈夊鎴风璇佷功锛屽惁鍒?TLS 鎻℃墜闃舵灏变細澶辫触锛岀櫥褰曢〉鏃犳硶浣滀负棣栨璇佷功寮曞鍏ュ彛銆?- frp 鏀寔 TCP/HTTP/HTTPS 闅ч亾锛涢厤缃寘鍚?`serverAddr/serverPort`銆乣auth.method/auth.token`銆佸畼鏂规牸寮忚姹傜殑椤跺眰 `user`銆乣[transport] protocol=tcp` 涓?`[transport.tls] enable=true`銆?- frp 鏃ュ織淇濆瓨鍦ㄧ鐞嗙鍐呭瓨鐜舰缂撳啿锛孏UI 缃戠粶璁剧疆瀹炴椂鏌ョ湅锛汿CP 鍙€?PROXY protocol v2锛屼絾 Express 榛樿涓嶈В鏋愯鍗忚锛屽缓璁?HTTP/HTTPS 闅ч亾銆?
### 閭欢銆侀€氱煡涓庤繍缁?
- SMTP 閫氳繃 nodemailer 寮傛鍙戦€侊紝涓嶉樆濉炰富绾跨▼锛涘瘑鐮佷娇鐢?AES-256-GCM 鍔犲瘑锛岀晫闈㈣劚鏁忋€?- 鏀寔鏂扮敤鎴锋敞鍐屻€佸畨鍏ㄥ憡璀︼紙璐﹀彿閿佸畾/IP 闄愭祦锛夈€佺郴缁熼敊璇笁绫讳簨浠讹紱鍚岀被浜嬩欢 60 绉掑喎鍗达紝澶辫触鍙啓鏃ュ織涓嶆姏鍑恒€?- 绠＄悊绔彲鍙戦€佹祴璇曢偖浠躲€?- 鏀寔鏁版嵁搴撳湪绾垮浠姐€佹暟鎹?瀛樺偍/鎻掍欢鐩綍杩佺Щ锛涜縼绉诲墠鏍￠獙鐩爣璺緞骞堕噸鍚簲鐢ㄣ€?- Windows 鍗歌浇宸ュ叿鏀寔榛樿/鑷畾涔夋暟鎹洰褰曘€佺▼搴忔湰浣撱€佸揩鎹锋柟寮忋€佹敞鍐岃〃鍗歌浇椤?杞欢椤?鍚姩椤癸紱鍚姩鐢宠绠＄悊鍛樻潈闄愶紝鏀寔涓枃/English銆?- 涓嫳鏂?i18n锛歚zh-CN` / `en-US`锛岃瑷€鍋忓ソ瀛?`localStorage`锛岄粯璁ゆ寜 `navigator.language` 璇嗗埆銆?
### 榛樿璺緞

- Windows 榛樿鏁版嵁鐩綍锛歚%APPDATA%\cloudbox`
  - `cloudbox.db`銆乣storage/`銆乣plugins/`銆乣config/`銆乣tmp/`
  - `config/ssl/`銆乣config/frpc.toml`
- Windows 榛樿缂撳瓨鐩綍锛歚%LOCALAPPDATA%\cloudbox`
- Linux 绯荤粺妯″紡锛歚/var/lib/cloudbox`
- Linux `--portable`锛氬綋鍓嶇洰褰?`./data`

## Complete Features & Mechanisms (English)

### Accounts, Sessions and Security

- Passwords use **scrypt** hashing (N=32768); plaintext passwords are never stored.
- Login sessions use random tokens; only SHA-256 token hashes are stored. The browser cookie is `HttpOnly` and `SameSite=Lax`.
- Default session TTL is `security.sessionTtlHours = 168` hours. `last_seen` is updated at most once every 60 seconds.
- Non-GET/HEAD requests require a CSRF token; the CSRF cookie is separate from the session cookie.
- **Login failure locking is account-based, not IP-based**: after **5 consecutive failures**, the account is locked. The first lock is 60 seconds; subsequent locks grow as `60s 脳 2^(failures-5)` up to 60 minutes.
- The administrator GUI provides **quick unlock** in Users: it clears `failed_attempts` and `locked_until` immediately. Password reset, disable and session revocation are also available there.
- A dummy scrypt verification runs for unknown usernames to reduce timing-based account enumeration.
- Independent IP rate limits: login 30/15 min/IP; all APIs 600/min/IP; uploads 120/min/IP; registration 2/hour/IP; share creation 10/min/user; share download 60/min/IP+token; extraction/scan 10/min/user.
- Rate limiting returns 429 and can emit a `security.alert` email. `X-Forwarded-For` trust is optional and should be enabled only behind frp/Nginx.
- Audit logs cover login success/failure/lock, logout, session rotation/revocation, admin password reset, user disable/unlock, plugin changes, hosting changes and mail settings changes.
- All paths pass `safePath` validation, rejecting `..`, absolute paths and symlink escapes. Upload temporary storage, quotas and file size are bounded.
- Default single-file limit is 2 GB; uploads stream through busboy and are not loaded fully into memory.

### Files, Previews and Sharing

- Local multi-user drive with folders, upload, download, rename, delete, quotas and usage.
- Image, video, PDF and text previews; audio supports MP3/WAV/OGG/FLAC/AAC/M4A.
- Preview MIME whitelists and magic-byte checks are enforced; active HTML/SVG is not rendered inline.
- Downloads and previews support single HTTP Range requests with 206, `Content-Range` and `Accept-Ranges`.
- Share links use random tokens and optional expiry; public and authenticated share routes are separate.
- 7za extracts zip / 7z / rar / tar.gz with per-entry path validation and zip-slip protection; extraction counts toward quotas.
- ClamAV local scanning and VirusTotal API scanning (32 MB VirusTotal limit); infected files are blocked from download, sharing and extraction.
- Global audio player with Zustand state, current-folder playlist, previous/next, seek, volume and navigation persistence; media streams by Range rather than loading the whole track.

### Permissions and Users

- Administrators can toggle image preview, video preview, PDF preview, extraction and security scanning.
- Disabled features are hidden in the web UI and the backend also returns 403.
- Roles: administrator/user; status: active/disabled; quota can be null (unlimited).
- Optional public registration (default off), limited to 2 registrations/hour/IP and 5 GB default quota.
- Users can upload a PNG/JPEG/WebP avatar (max 600 KB) from the web header. It is stored as a data URL in `users.avatar_data`; the admin user list shows a thumbnail.

### AI and MCP

- Native AI assistant compatible with OpenAI-style Chat Completions, Function Calling and a ReAct tool loop.
- AI modes: administrator-shared key or user-supplied key. API keys are AES-256-GCM encrypted and masked in the UI.
- Default daily limit is 50. Work scope can be a specific folder or the entire drive (high risk); high-risk tool calls require confirmation.
- AI tool paths use the same relative-path and safePath checks; host absolute paths are rejected.
- When the UI is English, the system prompt appends 鈥淧lease reply to the user in English.鈥?- Native MCP server uses Streamable HTTP at `/api/mcp`, Bearer-token authentication and an optional bound CloudBox user. Available tools follow the registered tool set (file listing, reading, writing, search, etc.).

### Plugin Platform

- Plugins run in isolated `child_process.fork` processes; the main process never `require`s plugin code.
- Child environment variables are minimized; HTTP requests, events and logs cross an IPC boundary.
- `manifest.json` defines name/version; `index.js` exports `activate(ctx)`.
- `ctx` exposes router creation, events, private storage, logger and manifest.
- Admin plugin UIs load in a sandboxed iframe (`allow-scripts allow-forms`); plugins can inject `web-theme.css` or take over the web UI via `web-override/`.
- ZIP imports validate every path and reject `../` and absolute paths. Enable/disable/takeover/uninstall are audited.
- Imports are disabled by default. Plugin errors return `PLUGIN_ERROR` without crashing the main service.

### Static Hosting, TLS and frp

- Static sites are served at `/host/:username/*` with public/private visibility; private sites require login.
- Hosting reads use safePath and a sandbox CSP; SPAs fall back to `index.html`.
- Private CA is generated with mkcert. Server certificates live in `config/ssl/server/` and CA files in `config/ssl/ca/`; HTTPS and mTLS are supported.
- When HTTPS is enabled and the CA exists, the login page exposes a root-certificate download link. Clients that do not trust the CA must bypass the warning first or install the CA.
- With mTLS enabled, clients must present a client certificate before the TLS handshake completes, so the login page cannot serve as the first certificate bootstrap.
- frp supports TCP/HTTP/HTTPS tunnels. Config includes `serverAddr/serverPort`, `auth.method/auth.token`, the official top-level `user`, `[transport] protocol=tcp` and `[transport.tls] enable=true`.
- frpc output is kept in an in-memory ring buffer and shown live in the admin network page. TCP PROXY protocol v2 is optional, but Express does not parse it by default; HTTP/HTTPS tunnels are recommended.

### Email, Notifications and Operations

- SMTP uses nodemailer asynchronously; the main thread is never blocked. Passwords are AES-256-GCM encrypted and masked.
- Events: new registration, security alert (account lock/IP rate limit) and system error. Identical alerts have a 60-second cooldown; failures are logged only.
- Administrators can send a test email.
- Online database backup and data/storage/plugin directory migration are supported; target paths are validated and the app restarts after migration.
- The Windows uninstaller supports default/custom data folders, program files, shortcuts, uninstall/software/startup registry entries; it requests administrator rights and supports Chinese/English.
- i18n: `zh-CN` / `en-US`, stored in `localStorage`, detected from `navigator.language` by default.

### Default Paths

- Windows data: `%APPDATA%\cloudbox`
  - `cloudbox.db`, `storage/`, `plugins/`, `config/`, `tmp/`
  - `config/ssl/`, `config/frpc.toml`
- Windows cache: `%LOCALAPPDATA%\cloudbox`
- Linux system mode: `/var/lib/cloudbox`
- Linux `--portable`: `./data`

