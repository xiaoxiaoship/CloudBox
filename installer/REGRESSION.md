# Windows Server clean-machine regression

Run this on a fresh Windows Server 2019/2022 x64 VM with no prior CloudBox data.

## Install

1. Verify SHA-256 against `SHA256SUMS-v1.0.2.txt` (or the matching release checksum).
2. Run `CloudBox-Server-1.0.2-x64.exe` as Administrator.
3. Confirm install path, then wait for service installation/start.
4. Confirm the `CloudBox` service is `Running`.
5. Open the service log and find `http://<LAN-IP>:1250/setup?token=...`.

## First run

1. Open the setup URL from another machine on the same LAN.
2. Create the administrator with a strong password.
3. Confirm the token file is consumed.
4. Sign in at `http://<LAN-IP>:1250`.
5. Confirm data directory is `%PROGRAMDATA%\CloudBox`.

## Functional checks

- [ ] User Web can be started from the dashboard.
- [ ] User login and file upload/download work.
- [ ] Database backup downloads to the browser.
- [ ] Admin password change works and forces re-login.
- [ ] Admin username change works.
- [ ] Administrator session list shows the current session and revoke-all works.
- [ ] Certificate import using browser file upload works.
- [ ] CA client certificate downloads as PKCS#12 (`changeit`).
- [ ] Plugin ZIP upload works; folder import remains GUI-only.
- [ ] Directory migration with an absolute path works and survives service restart.
- [ ] Scheduled user Web start/stop survives service restart.
- [ ] frp configuration rejects local port 1250.
- [ ] Login without `admin_csrf` is rejected.
- [ ] `/api/admin/app/info` is rejected without an admin session.

## Restart/uninstall

1. Restart the service; confirm settings and paths persist.
2. Confirm `%PROGRAMDATA%\CloudBox` is preserved after uninstall.
3. Uninstall; confirm the service, shortcuts and uninstall entry are removed.
4. Reinstall; confirm existing data is detected and setup is not requested again.

## Notes

- Unsigned installers may trigger SmartScreen.
- Do not expose admin Web 1250 through frp or public port forwarding.
- Record OS build, install result, service log and screenshots in the release checklist.
