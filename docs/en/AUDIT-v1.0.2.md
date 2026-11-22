[中文](../AUDIT-v1.0.2.md) | English

# CloudBox v1.0.2 Static Audit Report (Read-Only)

- Audit date: 2026-11-22
- Scope: `src/`, `admin/src/`, `web/src/`, `tests/`, `scripts/`, `installer/`, `build/`
- Principle: **scan only; do not delete code, do not modify dependencies**

## 1. Dead Code / Unreferenced Candidates

| Item | Evidence | Conclusion |
|---|---|---|
| `installer/winsw/CloudBox.xml` | Confirmed unreferenced, already deleted | Cleaned up |
| `installer/winsw/CloudBoxService.xml` | Referenced by `installer/inno/CloudBox.iss` | Kept |
| `admin/src/components/*.tsx` | Checked `admin/src` references one by one | No component found with zero references |
| `src/admin-server/routes/*.ts` | All mounted by `src/admin-server/app.ts` | Kept |
| `src/main/directoryMigration.ts` | Used by Electron `appChangeDirectory` | Kept; Web uses `AdminDirectoryService` |
| `build/installer.nsh` | electron-builder NSIS `include` | Kept |
| `src/main/updateInstaller.ts` | Used by the GUI update flow | Kept |
| `src/server-entry/updateInstaller.ts` | Used by the Server update flow | Kept |

Conclusion: no large-scale dead code is currently found; only `CloudBox.xml` is a clear candidate as an obsolete copy of the old configuration.

## 2. Admin HTTP Unimplemented / Desktop-Only Methods

`admin/src/api/http.ts` still retains the following `ADMIN_NOT_IMPLEMENTED`:

```text
app.openDataDir
app.openStorageDir
app.openPluginsDir
```

These are not business dead code; they are the capability boundary where Web cannot open the server's local file explorer. The corresponding UI has been disabled or shows a notice.

Capabilities that have been moved out of "unimplemented":

```text
auth.changePassword
users.renameSelf
server.getSchedule / setSchedule
server.importCertificate
ca.exportClientCert
plugins.import
app.changeDirectory
```

## 3. Legacy Dual-Track Security Fields

The current security settings contain both:

### 3.1 Simple Mode Fields

```text
security.lockEnabled
security.maxLoginFailures
security.lockBaseMinutes
security.lockMaxMinutes
security.ipLoginLimit
security.ipWindowMinutes
security.ipLockMinutes
security.simpleRegisterLimit
security.renameEnabled
security.renameLimit
security.renameWindowHours
security.renameLockHours
security.capEnabled
security.capLoginFailures
security.capRegistrationLimit
security.capShareLimit
```

### 3.2 Advanced Mode Policy

```text
security.policy (JSON)
rules/savedRules/ipBan/accountBan/globalBan/accessLists inside security.policy
```

### 3.3 Shared / Boundary Fields

```text
security.mode
security.sessionTtlHours     user Web Session; admin Web is already fixed at 4h
security.adminIdleEnabled    admin frontend idle lock
security.adminIdleMinutes
security.lowLevel            hard limit before WAF
security.capSecret           Cap signing secret
```

Conclusion: under "branching by mode" these fields are all still in use; they are **not dead fields that can be blindly deleted**. The risks are:

- The name `security.sessionTtlHours` looks like an admin Session, but the admin side no longer uses it.
- Simple mode and advanced mode have different semantics for Cap, registration, and renaming.
- Switching modes clears old bans/counters; the old fields are still retained in the settings table.

Recommendation: unify the naming to explicit `simplePolicy` / `advancedPolicy` later, or clearly label them as "user Web only" in the UI.

## 4. Unused npm Dependency Candidates

Scan the dependencies/devDependencies in `package.json` and compare them against `import/require` in the source.

### 4.1 Clear Candidates

| Dependency | Evidence | Suggestion |
|---|---|---|
| `mime-types` | Confirmed no direct reference, already removed from `package.json` / lock | Cleaned up; transitive dependencies of `express` and others may still exist in node_modules |
| `@types/mime-types` | Removed together with `mime-types` | Cleaned up |

### 4.2 Scan False Positives, Should Not Be Deleted

The following dependencies are not directly imported in the source, but are used by build scripts/configuration files:

```text
@electron/rebuild     electron:rebuild script
@tailwindcss/vite     vite/tailwind config
electron-builder      dist:win script
tailwindcss           Tailwind build
typescript            typecheck / tsc
vite                  web/admin build
@types/*              type checking
```

The following use subpaths or dynamic require, which the scanner cannot match directly:

```text
@mertcanureten/node-waf    require('.../lib/rules/builtin.json')
jszip                       tests/helpers/zip.ts
selfsigned                  scripts/e2e-electron-network.ts
```

## 5. Current i18n State

### New Feature Copy That Has Been Completed

- Update check/download/install/restart status
- Admin Session list, refresh, sign out all, current session hint
- Web directory path hint, placeholder, error message
- Certificate/private key import success message
- CA generate/install/uninstall/issue/export messages
- Plugin ZIP import uses the existing `pluginsPage` copy
- The uninstall prompt is handled by the Inno Setup / NSIS bilingual dialog and is not part of the JSON copy

The corresponding keys have been written to:

```text
src/shared/locales/zh-CN.json
src/shared/locales/en-US.json
```

### Remaining Hardcoding (Historical Legacy)

After scanning `admin/src`, a large amount of hardcoded Chinese still remains, mainly in:

```text
admin/src/components/SettingsPage.tsx
admin/src/components/NetworkPage.tsx
admin/src/components/FilesPage.tsx
admin/src/components/LowLevelSecurityPanel.tsx
admin/src/components/Dialog.tsx
admin/src/api/http.ts (error messages)
```

Most of these are copy for the settings/files/security pages that existed before v1.0.2, and are not part of the update, Session, directory, certificate, or plugin flows added this time. If "no hardcoding anywhere in the admin" is required, another complete i18n migration round is needed; it is recommended to schedule that separately, so as not to expand risk within this round's update/uninstall changes.

## 6. Legacy Uninstall Tooling

No standalone uninstaller exe or standalone uninstall script was found:

```text
No standalone uninstaller tool file found
```

Currently uninstalling is implemented by:

- Electron GUI: electron-builder NSIS uninstaller + `build/installer.nsh`
- Windows Server: Inno Setup uninstaller + `installer/inno/CloudBox.iss`

Both have been given the "whether to delete user data" interaction; silent updates skip the prompt and preserve data.

## 7. Suggested Cleanup Scope (To Be Confirmed)

1. ~~Delete the old `installer/winsw/CloudBox.xml` copy~~ (done).
2. ~~Remove `mime-types` / `@types/mime-types`~~ (done).
3. Unify the `security.sessionTtlHours` naming or document it.
4. Open a separate i18n effort covering the existing hardcoding in Settings/Network/Files/LowLevelSecurityPanel.
5. Clean up the deprecated notImplemented wrappers in `admin/src/api/http.ts` (keep only genuinely desktop-only items).

None of the above deletions have been executed.
