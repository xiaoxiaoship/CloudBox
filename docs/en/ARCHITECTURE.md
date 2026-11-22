[中文](../ARCHITECTURE.md) | English

# CloudBox Architecture & Implementation

> Applies to version: 1.0.2

## Contents

```text
1. Runtime forms
2. Processes and directories
3. Electron entry
4. Headless / Web Admin entry
5. Admin authentication and security boundary
6. User Web
7. Core services
8. Data model and migrations
9. Security policy engine
10. Files, previews, extraction and scanning
11. frp, HTTPS and CA
12. Plugin runtime
13. Frontend and AdminApi
14. Tests, build and release
15. Known limitations
```

---

## 1. Runtime forms

CloudBox 1.0.2 has two runtime forms; they share core/services and SQLite, but their entry points and deployment differ.

```text
Electron GUI
├── main process
├── desktop window + preload IPC
├── user Web (started/stopped by online mode)
└── admin Web not started

Headless / Web Admin
├── server-entry single Node process
├── adminApp :1250 (always started)
├── userApp (started/stopped by online mode)
├── frpc (optional)
└── browser management via /api/admin/*
```

The two forms do not share admin login state:

- Electron uses an in-memory `AdminSession` in the main process.
- Web uses a separate `admin_sessions` table and cookies.

## 2. Processes and directories

```text
src/
├── core/          domain models, services, SQLite, security
├── server/        Express routes and middleware for the user Web
├── admin-server/  Express app, routes and middleware for Web Admin
├── server-entry/  headless startup, init token, service control
├── main/          Electron main process, IPC, windows, tray
├── preload/       contextBridge
├── shared/        IPC types, shared models, i18n, low-level settings
admin/             admin frontend (shared by GUI + Web)
web/               user frontend
tests/             unit/integration tests
installer/         WinSW + Inno Setup
```

Runtime data:

| Form | Data directory |
|---|---|
| Electron | `%APPDATA%\cloudbox` |
| Headless | `%PROGRAMDATA%\CloudBox` |

Headless directory layout:

```text
%PROGRAMDATA%\CloudBox\
├── cloudbox.db
├── ai-secret.key
├── config\
│   ├── admin-init-token.json
│   ├── ssl\
│   └── frpc.toml
├── storage\
├── plugins\
├── logs\
└── tmp\uploads\
```

## 3. Electron entry

`src/main/index.ts`:

- single-instance lock
- creates the window/tray
- `createMainContext()`
- registers IPC
- starts the user Web and plugins
- stops services on exit

`src/main/context.ts` assembles:

```text
SQLite
CoreServices
AdminUserService
AdminSession (in-memory)
TlsManager
CaManager
FrpService
ServerController
```

The GUI does not create `adminApp` and does not listen on 1250.

`src/main/ipc.ts` is the Electron adapter layer:

- `isTrustedSender` validates the window and `file://.../dist/admin/`
- Zod input validation
- admin session
- calls core/admin services
- writes audit entries
- returns `Result<T>`

## 4. Headless / Web Admin entry

`src/server-entry/index.ts`:

```text
createHeadlessController()
→ controller.start()
   ├── startAdmin()
   ├── startUser() if server.online
   └── frp.start() if frp.enabled
```

### 4.1 Headless context

`src/server-entry/context.ts` creates:

- SQLite
- CoreServices
- AdminUserService
- AdminSessionRepository / AdminAuthService
- InitTokenService
- TlsManager / CaManager
- ServerController
- FrpService

### 4.2 ServiceController

`src/server-entry/serviceController.ts`:

- fixed admin port 1250
- checks the port is free before starting
- the user port must not equal 1250
- admin Web starts first
- user Web starts afterwards
- frp starts last
- admin session fixed at 4 hours
- the admin side purges expired `admin_sessions` every hour
- Web Admin can list/revoke all admin sessions

### 4.3 Admin app

`src/admin-server/app.ts`:

```text
Helmet (independent CSP)
JSON 256KB
intranetOnly
/api/admin/app/info
/api/admin/health
/api/admin/auth/*
/api/admin/setup
/api/admin/users
/api/admin/settings
/api/admin/server
/api/admin/system
/api/admin/files
/api/admin/plugins
/api/admin/frp
/api/admin/ca
/api/admin/app/backup
dist/admin static assets + SPA fallback
```

The admin side and the user side do not use the same Express instance.

## 5. Admin authentication and security boundary

### 5.1 Initialization token

When there is no administrator, a 32-byte random token is generated:

- only the SHA-256 hash is stored
- valid for 24 hours
- prints `/setup?token=...` to the console/log
- the token file is deleted after the account is created
- if lost, delete the file and restart to regenerate

### 5.2 Admin session

Table `admin_sessions`:

```text
id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at
```

Admin session TTL is `4 * 60 * 60 * 1000`; the user Web's `security.sessionTtlHours` is not read.

Cookies:

```text
admin_sid   HttpOnly, SameSite=Strict, Secure when HTTPS
admin_csrf  not HttpOnly, SameSite=Strict, Secure when HTTPS
```

### 5.3 Intranet restriction

`createIntranetOnly` reads the socket address directly:

- does not trust `X-Forwarded-For`
- allows loopback / RFC1918 / ULA / link-local
- returns 403 and writes an audit entry when rejected
- can be disabled in settings; disabling requires a red confirmation

Note: frp connections from the local machine appear as loopback, so **1250 should not be mapped through frp**.

### 5.4 CSRF

The admin side uses an independent double-submit:

- `admin_csrf` is issued after login
- non-GET/HEAD/OPTIONS requests require the cookie to match `x-csrf-token`
- failures are audited

### 5.5 Capability differences

Web Admin provides the following through browser file streams:

- directory migration (enter the server absolute path manually)
- plugin ZIP import
- certificate/private key upload
- CA client certificate download
- database backup download

Native desktop file pickers, launch at startup and the tray are still GUI-only. Admin Web has no built-in HTTPS, and 1250 should not be mapped through frp.

## 6. User Web

`src/server/app.ts` assembles:

```text
Helmet / requestId / JSON 1MB
IPS
/health
global IP guard
basic rate limiting
API flood counting
Cap
public config/certificates/plugin themes
/api/admin (keeps the admin namespace guard)
/api/hosting, /api/ai, /api/system
/api/plugins
files, shares, authentication, tasks
plugin Web assets, static hosting
SPA
error handling
```

User Web and admin Web have completely separate session/cookie/CSRF/CSP.

## 7. Core services

`src/core/services/`:

- AuthService
- RegistrationService
- SecurityPolicyService
- FileService
- ExtractionService
- ScanService
- ShareService
- HostingService
- PluginService
- MailService
- SettingsService
- AuditService
- UpdateService

`src/core/services/admin/`:

- AdminUserService
- AdminAuthService
- AdminSettingsService
- AdminServerService
- AdminFrpService
- AdminCaService
- AdminLogService

Electron IPC and HTTP routes only adapt; they do not implement business rules directly.

## 8. Data model and migrations

Migrations live in `src/core/db/migrations/`; the latest is 014.

Main tables:

```text
users, sessions, quotas, shares, file_scans, audit_logs,
plugins, settings, user_login_ips,
security_bans, security_policy_resets, security_policy_counts,
admin_sessions
```

`user_version` and `schema_migrations` record the version; an unknown higher version refuses to start.

## 9. Security policy engine

The policy is stored in the `settings.security.policy` JSON:

```json
{
  "rules": [],
  "savedRules": [],
  "ipBan": {},
  "accountBan": {},
  "globalBan": {},
  "accessLists": {}
}
```

Scopes:

```text
ip | account | global
```

Time semantics:

- `0`: permanent
- empty (internally `-1`): count only, do not ban
- positive number: fixed duration
- variable: `base × 2^overflow`, capped by max

Modes are mutually exclusive:

- simple: legacy lock/IP rate limiting/registration/rename; the policy JSON is not enforced.
- advanced: policy cards + IPS + API flood + allow/deny lists; legacy locks are not enforced.
- switching modes clears bans, counters, legacy locks and in-memory rate limits.

When the global counter reaches the threshold, the user Web stops; manually starting it during recovery cancels that round of automatic recovery.

## 10. Files, previews, extraction and scanning

File operations all go through safePath:

- rejects `..`, absolute paths, UNC, control characters, ADS and Windows reserved device names
- rejects symbolic links/Junctions
- path segment 255, relative path 900

Upload:

```text
busboy single file
→ temp file
→ quota/size/path validation
→ atomic move
→ audit
```

Preview:

- streaming for images/videos/audio/PDF
- text truncated at 512KB
- Office docx/xlsx/pptx rendered in the browser
- heavy preview/per-user concurrency gate, 3-second wait cap

Extraction:

- max 10000 files
- 50GB total size after extraction
- 7z 5-minute timeout
- symbolic links rejected

Scanning:

- VirusTotal API; files >32MB rejected
- local ClamAV; returns skipped for >100MB
- `--max-filesize` / `--max-scansize`
- infected files cannot be downloaded/shared/extracted

## 11. frp, HTTPS and CA

frp:

- auto-generates `frpc.toml`
- TLS to frps
- TCP supports PROXY v2/tcpMux
- HTTP/HTTPS preserves the real IP
- health check 3s/3 attempts/10s by default

TLS:

- minimum TLS 1.2
- mTLS uses the private CA

CA:

- node-forge/mkcert
- rootCA + server certificate
- client PKCS#12 password `changeit`
- uninstall only removes system trust, does not delete files

## 12. Plugin runtime

```text
main process forks index.js
→ IPC request forwarding
→ {status, headers, body}
```

Boundaries:

- manifest name 2–64, lowercase letters/digits/hyphens
- ZIP 20MB, at most 2000 entries
- start 10s, request 15s, stop 1s
- 1000-line ring log for stdout/stderr
- plugins are separate Node child processes, not a strong OS sandbox
- adminUrl has no domain allowlist

## 13. Frontend and AdminApi

`admin/src/api`:

```text
types.ts
electron.ts
http.ts
AdminApiContext.tsx
```

At runtime:

```ts
const api = window.cloudbox
  ? new ElectronAdminApi()
  : new HttpAdminApi();
```

Components obtain it through `useAdminApi()` and do not access preload directly.

Web Admin has no Electron file picker; related operations are hidden or disabled.

## 13.1 Automatic updates

- `UpdateService` parses GitHub Release assets: the GUI selects `CloudBox-Setup-*-x64.exe` and the Server selects `CloudBox-Server-*-x64.exe`.
- `UpdateManager` downloads in the background to a temp directory, verifies against the asset size and GitHub digest, with states idle/checking/available/downloading/downloaded/installing/restarting/error.
- The GUI uses a separate cmd script that waits for exit, then silently runs the installer and restarts `CloudBox.exe`.
- The Server uses a separate cmd script that stops the WinSW service, silently runs the Server installer, and then starts the service; the current process exits with 0 so WinSW does not restart the old version before installation.
- Web Admin polls status via `/api/admin/system/update/status|download|install`; the GUI polls via IPC.
- If the download fails, or the size or digest does not match, the temp file is deleted and an error is reported.

## 13.2 Uninstall data selection

- NSIS `customUnInstall` and Inno Setup `InitializeUninstall` ask during interactive uninstall whether to delete `%APPDATA%\cloudbox` and `%PROGRAMDATA%\CloudBox`.
- Choosing "No" only removes the program itself, shortcuts and registry entries.
- Silent install/update skips the prompt and always keeps the data.
- There is no longer a separate uninstall tool; use the Windows "Apps and features" / installation directory uninstall entry.

## 14. Tests, build and release

```bash
npm run typecheck
npm test
npm run e2e:electron
npm run build:web
npm run build:admin
npm run build:headless
```

Windows:

```text
npm run dist:win           Electron installer/portable build
installer\build-server.ps1 Windows Server service installer
```

The Server build first uses `scripts/prepare-server-stage.mjs` to copy the artifacts to `release/server-stage`, runs `npm prune --omit=dev` to trim dependencies, then compiles with Inno Setup; WinSW is already included at `installer/winsw/CloudBoxService.exe`.

Server installer:

- WinSW `CloudBoxService.exe` + `CloudBoxService.xml`
- `node.exe`
- `dist/headless/index.mjs`
- `dist/admin`
- `dist/web`
- `node_modules`
- `resources`

Output:

```text
release\CloudBox-Server-<version>-x64.exe
```

## 15. Known limitations

- Admin Web is HTTP by default with no built-in TLS.
- 1250 should not be mapped through frp.
- The Web side has no admin login-failure lockout/TOTP/IP allowlist (a product decision).
- GUI idle locking is a frontend timer; server-side sessions remain valid for the 4-hour TTL.
- Admin Web has no built-in HTTPS; 1250 should not be mapped through frp.
- The service installer has not completed install/uninstall regression on an actual clean Windows Server.
- On first install, the user Web is offline by default.
