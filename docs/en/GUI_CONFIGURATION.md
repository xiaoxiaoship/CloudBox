[中文](../GUI_CONFIGURATION.md) | English

# CloudBox Configuration Guide

> Applies to: 1.0.2  

This guide covers both the **Electron GUI** and the **Web Admin**. They share business settings, but entry points, authentication and some desktop capabilities differ.

## Contents

```text
1. Read First: GUI vs Web Admin
2. First Start and Login
3. Administrator Account
4. Security and Runtime
   4.1 Simple Mode
   4.2 Advanced Mode: Scopes and Drag-and-Drop
   4.3 Policy Fields and Time Entry Rules
   4.4 Feature Descriptions
   4.5 Global Bans, Counters and Lists
   4.6 Low-level Security Controls
   4.7 Local Resources and Logs
5. Feature Controls
6. System and Storage
7. Network Settings
8. Users, Files and Plugins
9. Theme, Import/Export and Restore
10. Common Blank-Field Questions
```

---

## 1. Read First: GUI vs Web Admin

| Capability | Electron GUI | Web Admin |
|---|---|---|
| Admin entry point | Desktop window | Browser `:1250` |
| Admin login | First-run wizard + GUI login | `/setup?token=...` initialization, then login |
| Admin session | Electron main-process memory | Separate `admin_sessions` table |
| API channel | Electron IPC | HTTP `/api/admin/*` |
| Data directory | `%APPDATA%\cloudbox` | `%PROGRAMDATA%\CloudBox` |
| User Web switch | GUI online mode | Web Admin online mode |
| Admin Web itself | Not started | Fixed at 1250, always running |
| Desktop file picker | Supported | Not supported |
| Directory migration | Supports native picker | Supports manual absolute path input |
| Plugin import | Folder/ZIP | Browser ZIP upload |
| Certificate/private key import | Native file picker | Browser upload |
| CA client certificate export | Save to local machine | Download to browser device |
| Database backup | Save to local machine | Download to browser device |
| Admin Web intranet restriction | Not applicable | On by default, can be disabled |

**Security note:** Do not map port 1250 of the Web Admin through frp. frp should only map the user Web port.

## 2. First Start and Login

### GUI

1. Start the installed or portable version.
2. On first run, the create-administrator wizard opens.
3. Enter the administrator username, password and password confirmation.
4. The password must be at least 8 characters and contain both letters and digits.
5. After creation you are logged in automatically to "Service Overview".

### Web Admin

1. Install and start the `CloudBox` Windows service.
2. Check the service log or console to find:

   ```text
   http://<intranet IP>:1250/setup?token=...
   ```

3. Open that URL in a browser on the same intranet.
4. Enter the username, password and password confirmation to complete initialization.
5. The token is valid for 24 hours by default and becomes invalid immediately after the account is created.

Token file:

```text
%PROGRAMDATA%\CloudBox\config\admin-init-token.json
```

If the token is lost or has expired:

1. Stop the CloudBox service.
2. Delete `admin-init-token.json`.
3. Restart the service.
4. Check the log for the new URL.

> The initialization token is stored only as a SHA-256 hash; the original token cannot be derived from the file.

## 3. Administrator Account

Path:

```text
System Settings → Administrator Account
```

### Administrator username

- 1–64 characters.
- Spaces and characters such as `/ \ : * ? " < > |` are not allowed.
- The Web Admin currently has no HTTP interface for changing the administrator username; make the change in the GUI.

### Change password

- Current password
- New password
- Confirm new password

After the change, the old administrator sessions become invalid and you must log in again.

> The Web Admin changes the password through `POST /api/admin/auth/password`; after the change, all admin sessions become invalid immediately and you must log in again.

### Administrator GUI idle lock

- On by default.
- 30 minutes by default.
- Value range 1–1440 minutes.
- After inactivity, the administrator front end logs out automatically and you must log in again.
- This lock is a front-end timer; the server-side Session still expires according to the Session TTL.

### Admin session

- Admin sessions are fixed at **4 hours**, independent of the user Web `security.sessionTtlHours`.
- The Web Admin can display the list of current admin sessions (IP, UA, last activity, expiry time).
- `Log out all` revokes all admin sessions of the current administrator and clears the Cookie.
- The login interface uses double-submit CSRF; before logging in you must first call `/api/admin/auth/status` to obtain `admin_csrf`.

### Admin Web intranet-only access

Shown only in the Web Admin.

- On by default.
- Basis: the socket address is read directly and `X-Forwarded-For` is not trusted.
- Allows loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, IPv6 ULA/link-local.
- Disabling requires a second confirmation.
- After disabling, any client that can reach 1250 can see the administrator login page.
- Disabling is not recommended; if remote administration is required, use a VPN, an SSH tunnel or an HTTPS reverse proxy + firewall allowlist.

## 4. Security and Runtime

Path:

```text
System Settings → Security and Runtime
```

### 4.1 Simple Mode

Suitable for users who are not familiar with policy cards.

| Field | Default | Unit | Effect |
|---|---:|---|---|
| Enable legacy security limits | On | — | Master switch |
| Account failure threshold | 5 | times | Lock the account after this many consecutive failures |
| First lock minutes | 1 | minutes | Duration of the first lock |
| Maximum lock minutes | 60 | minutes | Upper limit of the increasing lock |
| IP login request limit | 30 | times / window | Login request limit for the same IP |
| IP statistics window | 15 | minutes | Statistics window |
| IP lock time | 15 | minutes | Lock time after the limit is exceeded |
| Registrations per IP per hour | 2 | times / hour | Registration rate limit |
| Rename limit | On | — | Whether renaming is restricted |
| Rename count limit | 1 | times | Allowed count within the statistics window |
| Rename statistics window | 24 | hours | Statistics period |
| Rename lock duration | 24 | hours | Lock time after the limit is exceeded |

Simple mode only enforces legacy account locking, IP login rate limiting, registration restriction and rename restriction; it does not run advanced policy cards or IPS.

### 4.2 Advanced Mode: Scopes and Drag-and-Drop

Advanced mode uses the JSON policy engine.

Three drop zones:

```text
By IP | By account | Global policy
```

- **By IP**: login failures, connections and requests from the same source IP.
- **By account**: the behavior of a single login account and its number of devices/IPs.
- **Global policy**: statistics for the server as a whole, regardless of source and account.

Feature card source groups:

- General
- Applies to IP and global
- Applies to account and global
- Global only

Drag rules:

- Dragging from "Available Features" into a scope enables it.
- Dragging from a scope to "Saved but disabled": keeps the parameters but disables it.
- Dragging from "Saved but disabled" back to the original scope: enables it again.
- Dragging from "Saved but disabled" outside the area: deletes it after a confirmation prompt.
- Global-only cards cannot be dragged into the IP/account areas.
- The same feature can appear only once in the same scope.

### 4.3 Policy Fields and Time Entry Rules

Common fields:

| Field | Meaning |
|---|---|
| Statistics window | Over how long counts accumulate |
| Threshold | How many times before it triggers |
| Record value | How much the upper-level ban counter increases after a trigger |
| Fixed ban | How many minutes each fixed ban lasts |
| First ban | Starting minutes of a variable ban |
| Maximum ban | Upper limit of a variable ban |
| Counting method | By time window / accumulated since the last unban |

Time entry rules:

```text
0          = permanent ban
blank      = no time limit, count only (fixed ban fields)
positive   = ban for that many minutes/hours
variable   = starts at 1, cannot be blank or 0
```

Variable ban calculation:

```text
ban duration = first ban × 2^(times over threshold)
ban duration does not exceed the maximum ban
```

For example:

```text
first ban 1 minute, maximum 60 minutes:
1st time over the limit 1 minute
2nd time 2 minutes
3rd time 4 minutes
...
capped at 60 minutes
```

When a fixed ban is left blank, the policy only counts and increases the ban count at the upper level; it does not ban the current feature directly.

### 4.4 Feature Descriptions

| Feature | Available scopes | Effect |
|---|---|---|
| Login failure limit | IP / account | Counts login failures and restricts login after the threshold is reached |
| Registration volume limit | IP / global | Counts successful registrations within the time window |
| Cap human verification | IP / global | Requires completing PoW after the threshold is reached |
| Rename limit | Account / global | Limits the number of renames within the statistics period |
| Concurrent online users | Account / global | Limits the number of simultaneously connected clients |
| Historical IP count limit | Account / global | Limits the number of distinct login IPs seen within the period |
| Concurrent online IP limit | Account / global | Limits the number of distinct IPs online at the same time |
| IPS attack signature blocking | IP / global | On a match of XSS/SQLi/path traversal/command injection/scanner signatures, blocks only the current request and counts it |
| API flood blocking | IP / account / global | Counts `/api` requests per window; by default excludes health checks, task polling, current-user and Range requests |
| Count toward IP global ban counter | Global only | On IP-level triggers, adds the record value to the upper-level global counter |
| Count toward account global ban counter | Global only | On account-level triggers, adds the record value to the upper-level global counter |

### 4.5 Global Bans, Counters and Lists

#### IP / account global bans

- IP threshold defaults to 10, ban for 30 minutes.
- Account threshold defaults to 10, ban for 30 minutes.
- Once the total record value of the feature restrictions for the same target reaches the threshold:
  - the feature bans for that target are cleared;
  - it is escalated to an IP/account global ban;
  - subsequent operations by that target are blocked.

#### Global policy

- Global counter threshold defaults to 15.
- Automatic recovery interval defaults to 5 minutes.
- Recovery interval 0 = no automatic recovery.
- After the global threshold is reached, the user Web is stopped automatically.
- Going offline does not clear IP/account bans.
- If the user Web is started manually during automatic recovery, the timer for that round of automatic recovery stops, to avoid a conflict.

#### Viewing current bans

Top-level tabs:

- Ban records
- Current counts

Counts include:

- Tab trigger counts
- IPS counts
- API flood counts
- Global counts

Individual and bulk clearing are supported; the counter window refreshes every 2 seconds.

"Unban All and Clear All Counts" deletes bans, clears counters, writes the reset time and resets the legacy failure counts to zero.

#### Blacklist and whitelist

- IP blacklist rejects immediately.
- IP whitelist skips global bans and automatic policy restrictions.
- The same applies to the account blacklist/whitelist.
- Changes take effect after saving the network security settings.

### 4.6 Low-level Security Controls

Path:

```text
Advanced Mode → "Low-level Security Controls" at the bottom
```

All are enabled by default. Any change requires passing a red-warning second confirmation.

Notes:

- These restrictions are enforced before WAF policies.
- Values that are too small make the low-level layer block normal requests before the policies do.
- Network/plugin timeout parameters take full effect at the next service or plugin start.

#### Basic protection

| Field | Default | Unit |
|---|---:|---|
| Global API rate limit | 600 | times/minute |
| Upload rate limit | 120 | times/minute |
| Share creation rate limit | 10 | times/minute |
| Share download rate limit | 60 | times/minute |
| Extraction rate limit | 10 | times/minute |
| Scan rate limit | 10 | times/minute |
| IP registration limit | 2 | times/hour |

#### IO and resources

| Field | Default | Unit |
|---|---:|---|
| Single-file upload limit | 2 GiB | bytes |
| File list limit | 5000 | items |
| Batch operation limit | 100 | items |
| Text preview limit | 512 KiB | bytes |
| Extraction concurrency | 10 | tasks |
| Scan concurrency | 10 | tasks |
| Local ClamAV size limit | 100 MiB | bytes |
| Local ClamAV timeout | 300 | seconds |
| Front-end concurrent uploads | 10 | uploads |
| Upload drain limit | 16 MiB | bytes |
| Share validity limit | 7200 | seconds |

#### Lifecycle and network

| Field | Default | Unit |
|---|---:|---|
| User Session validity | 168 | hours |
| Online determination window | 300 | seconds |
| PROXY wait timeout | 3000 | milliseconds |
| frp health check timeout | 3 | seconds |
| frp health check interval | 10 | seconds |
| Minimum TLS version | TLS 1.2 | — |
| HTTP headers timeout | 60000 | milliseconds |
| HTTP request timeout | 300000 | milliseconds |

#### Plugins and IPC

| Field | Default | Unit |
|---|---:|---|
| Plugin start timeout | 10000 | milliseconds |
| Plugin request timeout | 15000 | milliseconds |

#### Hard red lines (display only)

- safePath path safety
- CSRF
- Password policy
- Zip-bomb protection base thresholds (10000 files / 50GB / 5 minutes)
- JSON 1MB limit
- Cookie Secure/HttpOnly

#### WAF conflict warning

If a WAF policy threshold is higher than the low-level limit, for example:

```text
API flood threshold 800 times/minute
low-level API rate limit 600 times/minute
```

the low-level layer returns 429 first and the policy does not trigger first. The panel displays a conflict warning.

### 4.7 Local Resources and Logs

- Maximum concurrent extraction tasks: default 10.
- Maximum concurrent scan tasks: default 10.
- Global concurrency for heavy previews: default 10 (PDF/Office/large videos).
- Per-user preview concurrency: default 10.
- Log storage limit: default 100 MB.
- Clear cache: deletes temporary upload files and expired audit logs.
- Runtime log: recent logs of the current process.
- Audit log: operation records in the database.

## 5. Feature Controls

### 5.1 User Web Self-Registration

- Master switch.
- When enabled, the user Web login page shows a registration entry.
- New users default to a normal user with a 5GB quota.
- In advanced mode, registration frequency is controlled by "Registration volume limit".
- Simple mode uses the registrations per IP per hour limit.

### 5.2 User Feature Permissions

- Image online preview
- Video online playback
- PDF online preview
- Office online preview
- Online extraction
- Security scanning

When disabled, the front end hides the entry and the backend interface returns 403.

### 5.3 Security Scanning

- Master switch
- Mode: local ClamAV / VirusTotal API
- VirusTotal API Key
- ClamAV directory
- In local mode, files over the size limit return `skipped`
- `infected` files cannot be downloaded, shared or extracted

### 5.4 AI Service

- Master switch
- Admin shared configuration / user-provided configuration
- Base URL, model, API Key
- Daily limit for normal users

### 5.5 Embedded Static Hosting

- Master switch
- Public base address
- Sites are mounted at `/host/`
- No additional listening port
- Port reuse relies on frp HTTP/HTTPS tunnels
- Supports public/private sites
- Hosted pages are isolated from the main site API

### 5.6 Email Notifications

- Email master switch
- SMTP Host / Port / TLS
- SMTP user
- Authorization code/password
- Sender, alert recipient email
- Events: new user registration, security alert, security restriction trigger, local resource alert, system error
- Send test email

The password is encrypted with AES-256-GCM; if it cannot be decrypted, the authorization code must be re-entered.

## 6. System and Storage

### 6.1 Startup and Tray (GUI)

- Start automatically at boot
- After auto-start, minimized to the tray
- Manual start still shows the main window

The Web Admin has no tray/auto-start settings; the Windows service handles this.

### 6.2 Database Backup

- SQLite online backup
- Includes users, quotas, settings and audit logs
- Does not include the drive files themselves
- Backing up the database also backs up `ai-secret.key`
- GUI saves to the local machine
- Web downloads to the browser's device

### 6.3 System Data Directory

Contains the database, certificates, CA, frp configuration and encryption keys.

- The GUI can change and migrate it.
- The Web Admin can change the directory by entering an absolute server path; the target directory must be empty.
- Changing the data directory copies `cloudbox.db`, `config` and `ai-secret.key`, then the service restarts automatically; to avoid losing the path pointer, the old database directory is not deleted automatically.
- Drive/plugin directories are cleaned up after migration completes and delete-old-files is checked.

### 6.4 Drive File Directory

All user-uploaded files. Both GUI and Web can migrate it; Web uses an absolute path input, and the target directory must be empty.

### 6.5 Plugin Directory

Installed plugins and their private storage. Both GUI and Web can migrate it; Web uses an absolute path input.

Data can be migrated when changing the directory; once migration completes and delete-old-files is checked, it cannot be undone. When the Web migrates the data directory, the old directory is kept because it holds the headless path pointer.

## 7. Network Settings

### 7.1 User Web Online Mode

- GUI: the online mode switch controls the user Web.
- Web: the Admin Web always runs, and the user Web is controlled by the online mode switch.
- A fresh installation defaults to offline.

### 7.2 Ports

- User port range 1024–65535.
- It cannot be 1250.
- After a change, the user Web restarts automatically when online.
- On failure, the port configuration is rolled back.

### 7.3 HTTP / HTTPS

- HTTP is only recommended on a trusted LAN.
- HTTPS requires a certificate and private key.
- The GUI can import `.crt/.pem/.cer` and `.key/.pem`.
- The Web Admin uploads `.crt/.pem/.cer` and `.key/.pem` through the browser.
- CA client certificates are downloaded by the browser; the PKCS#12 password is `changeit`.
- With mTLS enabled, the browser must import the client certificate.

### 7.4 frp

Fields:

| Field | Description |
|---|---|
| frps address | Server domain name or IP |
| frps port | Default 7000 |
| token | frps authentication token, may be left blank |
| User | frp user, may be left blank |
| Proxy name | frpc proxy name |
| Tunnel type | TCP / HTTP / HTTPS |
| Remote port | Used in TCP mode |
| Custom domain | Used in HTTP/HTTPS mode |
| PROXY Protocol v2 | Can be enabled for TCP/HTTPS, preserves the real IP |
| tcpMux | Health checks and business traffic share TCP |

Fixed health check parameters:

```text
timeoutSeconds = 3
maxFailed = 3
intervalSeconds = 10
```

The timeout/interval can be changed through the low-level security controls, but maxFailed is fixed at 3.

### 7.5 Private CA and mTLS

- Create a private CA
- Install into the system trust store
- Issue a server certificate
- Export the client certificate (GUI)
- Uninstalling only removes the system trust; it does not delete the CA files
- Default client PKCS#12 password `changeit`

## 8. Users, Files and Plugins

### User Management

- Create, delete users
- Set quotas (0 or blank means unlimited)
- Reset password (forced change at next login)
- Disable/enable
- Unlock
- Clear rename restrictions
- View historical IPs
- An administrator cannot delete themselves like a normal user

### File Browsing (Admin, Read-Only)

- Browse all user directories
- Download files
- Paths are validated by safePath

### Plugins

- Import plugins (GUI supports folders/ZIP; Web currently only manages existing plugins)
- Enable/stop
- Allow Web takeover
- Uninstall
- Open the plugin management page
- Plugins run in a separate child process

## 8.1 Automatic Updates

- After checking for updates, the admin end downloads the installer matching the current form (GUI Setup / Server).
- The download shows percentage and byte progress; on completion it verifies the size and the GitHub digest.
- After verification passes, the installer runs automatically for a silent overwrite installation and restarts the GUI or the Windows service.
- For the portable version, manually replacing the files is recommended; the development version is only used for verification.
- On failure it ends in the error state and the installation is not performed.

## 8.2 Uninstall and Data Retention

- Uninstalling from the system "Apps and features" or from the installation directory asks whether to delete user data.
- Choosing "No" keeps `%APPDATA%\cloudbox` and `%PROGRAMDATA%\CloudBox`; reinstalling restores them.
- Choosing "Yes" deletes accounts, files and configuration; it cannot be undone.
- Silent updates do not show this prompt and always keep the data.

## 9. Theme, Import/Export and Restore

- Light / dark theme
- Language switch (Chinese / English)
- Import/export configuration
- Restore default settings
- Restoring defaults clears security policies and runtime bans; please be careful

## 10. Common Blank-Field Questions

### What does leaving a time field blank mean?

- Fixed ban time left blank: **count only, do not ban**.
- Enter `0`: **permanent ban**.
- Variable ban: **cannot be left blank or set to 0**, starts at 1.

### What does leaving the quota blank mean?

A user quota that is left blank or set to 0 means **unlimited quota**.

### What happens if the token is left blank?

Leaving the frp token blank means token authentication is not enabled; this is only recommended with a trusted frps.

### Can the port be left blank?

No. The port must be an integer from 1024–65535 and cannot be 1250.

### Can the admin Web be mapped through frp?

Not recommended. The admin Web has no built-in HTTPS, and a local frp connection bypasses `intranetOnly`. Map only the user Web.
