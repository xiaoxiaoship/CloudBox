# CloudBox Windows Server installer

This directory contains the service and installer scaffolding for the headless
Web admin build. It is not used by the Electron release.

## Signing and SmartScreen

Installers are unsigned by default. Windows SmartScreen may display
"Windows protected your PC" / unknown publisher. Configure a code-signing
certificate before public distribution if this is not acceptable.

## Build prerequisites

1. `npm run build:web`
2. `npm run build:admin`
3. `npm run build:headless`
4. Copy `node.exe` to the repository root for packaging.
5. WinSW x64 is included at `installer\winsw\CloudBoxService.exe`; its matching
   XML is `CloudBoxService.xml`. If updating WinSW, keep the executable and XML
   file names identical.

6. Install Inno Setup 6 and run `installer\build-server.ps1` (or `ISCC.exe installer\inno\CloudBox.iss`).
   The build prepares `release\server-stage`, runs `npm prune --omit=dev`, then compiles.

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
