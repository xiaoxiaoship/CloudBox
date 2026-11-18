import { app } from 'electron';

const LOGIN_ITEM_NAME = 'CloudBox';
const LEGACY_LOGIN_ITEM_NAMES = ['com.cloudbox.app', 'CloudBox.exe'];

/** 只有安装版才允许注册 Windows 登录启动项。 */
export function isInstalledBuild(): boolean {
  return (
    app.isPackaged &&
    !process.env.PORTABLE_EXECUTABLE_DIR &&
    !process.env.PORTABLE_EXECUTABLE_FILE
  );
}

/**
 * 写入/移除登录启动项。
 * 关闭时总是尝试清理当前值和历史值，避免升级前遗留。
 */
export function applyLoginItem(autoStart: boolean, startInTray: boolean): boolean {
  if (!autoStart) {
    for (const name of [LOGIN_ITEM_NAME, ...LEGACY_LOGIN_ITEM_NAMES]) {
      app.setLoginItemSettings({
        openAtLogin: false,
        name,
        path: process.execPath,
        args: [],
      });
    }
    return true;
  }

  if (!isInstalledBuild()) return false;

  app.setLoginItemSettings({
    openAtLogin: true,
    name: LOGIN_ITEM_NAME,
    path: process.execPath,
    args: startInTray ? ['--hidden'] : [],
  });
  // 升级前可能使用了 AppUserModelId 作为默认值名。
  for (const name of LEGACY_LOGIN_ITEM_NAMES) {
    app.setLoginItemSettings({ openAtLogin: false, name, path: process.execPath, args: [] });
  }
  return true;
}
