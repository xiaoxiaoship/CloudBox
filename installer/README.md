# CloudBox Windows Server installer

This directory contains the service and installer scaffolding for the headless
Web admin build. It is not used by the Electron release.

## Build prerequisites

1. `npm run build:web`
2. `npm run build:admin`
3. `npm run build:headless`
4. Copy `node.exe` to the repository root for packaging.
5. Put WinSW x64 as:

   ```text
   installer\winsw\CloudBoxService.exe
   ```

   WinSW is distributed separately by the WinSW project. The executable must
   be renamed to `CloudBoxService.exe`; its matching XML is `CloudBox.xml`.

6. Install Inno Setup 6 and run `ISCC.exe installer\inno\CloudBox.iss`.

## Service behavior

- Service name: `CloudBox`
- Working directory: the install directory
- Entry point: `dist\headless\index.mjs`
- Data directory: `%PROGRAMDATA%\CloudBox`
- Admin Web: `http://<server>:1250`
- User Web port: configured inside the admin Web settings
- First startup: the service log prints the one-time `/setup?token=...` URL
  (the token is valid for 24 hours and stored only as a hash)

## Uninstall

The installer stops and removes the service, shortcuts and uninstall entry.
User data under `%PROGRAMDATA%\CloudBox` is intentionally preserved.
