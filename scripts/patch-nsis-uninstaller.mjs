import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * electron-builder 26 does not include `nsis.include` (customUnInstall) in the
 * generated uninstaller script on this toolchain. Inject the data prompt into
 * the uninstaller template during packaging; the patch is idempotent.
 */
const template = path.join(
  process.cwd(),
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'uninstaller.nsh',
);
const marker = 'CloudBoxKeepDataDirect';
let source = readFileSync(template, 'utf8');
if (source.includes(marker)) {
  console.log('NSIS uninstaller prompt already present');
  process.exit(0);
}

const anchor = '  !insertmacro setLinkVars\n';
if (!source.includes(anchor)) throw new Error('NSIS uninstaller anchor not found');
const prompt = `  !insertmacro setLinkVars

  ; CloudBox data-preservation prompt. A /S update skips it and keeps data.
  ClearErrors
  \${GetParameters} $R9
  \${GetOptions} $R9 "/S" $R8
  \${If} \${Errors}
    SetSilent normal
    MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除所有用户数据（账号、文件、配置）？$\\r$\\nDelete all user data (accounts, files, configuration)?" IDNO CloudBoxKeepDataDirect
    ReadEnvStr $0 "PROGRAMDATA"
    ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\\resources\\uninstall-cleanup.ps1" -GuiPaths "$APPDATA\\cloudbox\\cloudbox-paths.json" -DefaultAppData "$APPDATA\\cloudbox" -DefaultProgramData "$0\\CloudBox" -AppRoot "$INSTDIR" -DeleteDefaults'
    RMDir /r "$APPDATA\\cloudbox"
    RMDir /r "$0\\CloudBox"
  \${EndIf}
  CloudBoxKeepDataDirect:
`;
source = source.replace(anchor, prompt);
writeFileSync(template, source, 'utf8');
console.log('patched NSIS uninstaller prompt');
