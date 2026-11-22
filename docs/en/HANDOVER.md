[中文](../HANDOVER.md) | English

# CloudBox Development and Handover Guide

> Applies to version: v1.0.2  
> Intended audience: maintainers who will take over development, builds, releases, and troubleshooting

## 1. Project Forms

CloudBox v1.0.2 has two runtime forms, which share the same `core/services` and SQLite:

```text
Electron GUI
├── Electron main process
├── preload / IPC
├── User web
└── Does not start admin web

Headless / Web Admin
├── src/server-entry single Node process
├── admin Express :1250
├── User web (controlled by server.online)
└── frpc (optional)
```

Key boundaries:

- Electron does not start 1250.
- The admin Web is fixed at 1250 and cannot be used as the frp localPort.
- The admin Web is intranet-only by default and has no built-in HTTPS.
- The admin Session is fixed at 4 hours and is independent of the user Session.
- Cookies, CSRF, and CSP are separated between the user Web and the admin Web.

## 2. Directory Structure

```text
src/
├── core/           domain models, SQLite, services, migrations
├── server/         user web Express
├── admin-server/   admin web Express, routes, middleware
├── server-entry/   headless startup, init token, service control, updates
├── main/           Electron main process, IPC, windows, CA, frp, updates
├── preload/        contextBridge
├── shared/         IPC types, locales, shared constants
admin/              admin frontend (shared by GUI/Web)
web/                user frontend
resources/          icons, binaries, uninstall helper
installer/          Inno Setup + WinSW
scripts/            build, E2E, packaging, staging, NSIS patch
tests/              unit/integration/E2E
docs/               configuration, architecture, plugins, audit, handover
```

## 3. Data Directories

| Form | Default directory |
|---|---|
| Electron | `%APPDATA%\cloudbox` |
| Headless / Server | `%PROGRAMDATA%\CloudBox` |

Custom path configuration file:

```text
GUI:    %APPDATA%\cloudbox\cloudbox-paths.json
Server: %PROGRAMDATA%\CloudBox\cloudbox-paths.json
```

Fields:

```json
{
  "dataDir": "...",
  "storageDir": "...",
  "pluginsDir": "..."
}
```

The actual data directory after modification is not necessarily under the default path. The uninstaller reads this file, and deletes a custom directory only when the user explicitly chooses to delete data or uses `/DELETEAPPDATA`.

## 4. Build and Test

```bash
npm install
npm run typecheck
npm test
npm run build:web
npm run build:admin
npm run build:headless
npm run build:desktop
```

Desktop installer:

```bash
npm run dist:win
```

Server installer:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-server.ps1
```

Server build flow:

```text
build:web → build:admin → build:headless (including migrations)
→ scripts/prepare-server-stage.mjs
→ npm prune --omit=dev
→ Inno Setup compile
```

Note: `dist/headless` must contain `dist/headless/migrations`. If it is missing, Server startup reports that the migrations directory does not exist.

## 5. Auto-Update

Code:

```text
src/core/services/updateService.ts
src/core/services/updateManager.ts
src/main/updateInstaller.ts
src/server-entry/updateInstaller.ts
admin/src/components/UpdateDialog.tsx
```

Flow:

```text
GitHub Release API
→ select CloudBox-Setup / CloudBox-Server
→ download to temp directory (progress)
→ size + SHA-256 digest verification
→ automatic silent install
→ GUI restart / Server service restart
```

Current status:

- Download, progress, SHA verification, and the state machine have automated tests.
- **End-to-end installation/restart from a real old version to a new version has not yet been verified.**
- Release notes and the README must retain this limitation and must not claim that auto-update is "verified".

## 6. Uninstall

### Interaction

- Electron NSIS: prompts whether to delete user data.
- Server Inno: prompts whether to delete user data.

### Server CLI

```powershell
# Keep data
unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART

# Delete defaults and custom data paths recorded in cloudbox-paths.json
unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DELETEAPPDATA
```

### Custom-path Deletion Helper

```text
resources/uninstall-cleanup.ps1
```

Safety rules:

- Refuses disk root directories.
- Refuses Windows / Program Files / ProgramData / AppData / UserProfile / the install directory.
- Refuses ancestor directories of the default path.
- Stops the CloudBox service before deletion.
- Performs fallback cleanup of the default path.

## 7. Security Invariants

Do not break the following when modifying code:

- The `safePath` file path boundary.
- The admin Web's independent `admin_sessions` + `admin_sid` / `admin_csrf`.
- Login CSRF.
- The 4-hour admin Session.
- Admin Web 1250 is not mapped through frp.
- Cookie/CSP/CSRF isolation between the user Web and the admin Web.
- Audit writes do not trigger extra email events.
- Do not silently change settings defaults, migration versions, password policy, or Cookie attributes.

## 8. Known Limitations

- The admin Web has no built-in HTTPS and is suitable for intranet use only by default.
- No admin login failure lockout / TOTP (product decision).
- Real-world auto-update installation is not verified.
- The Desktop NSIS uninstall prompt depends on injection by `scripts/patch-nsis-uninstaller.mjs`; do not remove that step.
- Inno staging uses a short temporary path to avoid Inno failures caused by Windows long paths.
- Existing pages such as Settings/Network/Files still contain hardcoded text; see `docs/AUDIT-v1.0.2.md`.

## 9. Release Process

1. `npm run typecheck`
2. `npm test`
3. `npm run build:web`
4. `npm run build:admin`
5. `npm run build:headless`
6. `npm run dist:win`
7. `installer\build-server.ps1`
8. Copy the exe + blockmap + latest.yml + SHA256SUMS to the release directory
9. Update `docs` / Release notes
10. Push / release only after user confirmation

Do not regenerate untested assets before uploading.

## 10. Troubleshooting

### Server Service Stops Immediately After Starting

Check:

```text
%PROGRAMDATA%\CloudBox\logs\CloudBoxService.err.log
```

Common causes:

- `dist/headless/migrations` is missing.
- Port 1250 is in use.
- Insufficient permissions on the data directory.
- Native module version mismatch.

### Files in Use During Overwrite Installation

Inno `PrepareToInstall` stops the CloudBox service; if overwriting manually, first run:

```powershell
Stop-Service CloudBox
```

### NSIS Uninstall Shows No Prompt

Confirm that `dist:win` in `package.json` includes:

```text
node scripts/patch-nsis-uninstaller.mjs
```

And after cleaning up:

```text
release\win-unpacked
release\CloudBox-Setup-*-__uninstaller.exe
```

repackage.

### Inno Reports "The System Cannot Find the Path Specified"

Check whether staging is located at the short path `%TEMP%\CloudBoxStage`, and confirm that Inno uses it via `/DStageDir=...`.
