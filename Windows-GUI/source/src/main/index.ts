import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  nativeImage,
  net,
  protocol,
  type Tray,
} from 'electron';
import { disposeMainContext, createMainContext, type MainContext } from './context.ts';
import { registerIpc } from './ipc.ts';
import { createAppTray } from './tray.ts';
import { applyLoginItem } from './loginItem.ts';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let context: MainContext | null = null;
let isQuitting = false;
let quitReady = false;
let trayHintShown = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'plugin-admin',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.setName('CloudBox');
  app.disableHardwareAcceleration();
  app.setAppUserModelId('com.cloudbox.app');

  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    try {
      bootstrap();
    } catch (error) {
      console.error('[main] 启动失败', error);
      dialog.showErrorBox(
        'CloudBox 启动失败',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    }
  });
}

function bootstrap(): void {
  Menu.setApplicationMenu(null);

  context = createMainContext();
  applyLoginItemSettings(context);

  const adminIndex = path.join(context.adminDist, 'index.html');
  if (!existsSync(adminIndex)) {
    throw new Error(`未找到管理员界面构建产物：${adminIndex}\n请先运行 npm run build:desktop`);
  }

  registerIpc({
    ...context,
    getWindow: () => mainWindow,
  });

  registerPluginProtocol();

  void context.services.plugins.startAll();

  mainWindow = createMainWindow(context, adminIndex);
  tray = createAppTray({
    iconPath: path.join(app.getAppPath(), 'resources', 'tray.png'),
    onOpen: showMainWindow,
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;

    event.preventDefault();
    mainWindow?.hide();

    if (!trayHintShown && process.platform === 'win32') {
      trayHintShown = true;
      tray?.displayBalloon({
        title: 'CloudBox 仍在运行',
        content: '窗口已最小化到系统托盘，右键托盘图标可退出程序。',
        iconType: 'info',
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('window-all-closed', () => {
    // 常驻托盘，不随窗口关闭退出
  });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', (event) => {
    isQuitting = true;
    if (quitReady) return;

    event.preventDefault();
    void shutdown();
  });
}

async function shutdown(): Promise<void> {
  try {
    await context?.services.plugins.stopAll();
    await context?.server.stop();
    await context?.frp.stop().catch(() => {});
    context?.session.logout();
  } catch (error) {
    console.error('[main] 关闭 HTTP 服务失败', error);
  } finally {
    if (context !== null) {
      disposeMainContext(context);
      context = null;
    }
    tray?.destroy();
    tray = null;
    quitReady = true;
    app.quit();
  }
}

function registerPluginProtocol(): void {
  protocol.handle('plugin-admin', async (request) => {
    const url = new URL(request.url);
    const name = url.hostname;
    const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
    const target = context?.services.plugins.getAdminUiPath(name, relative) ?? null;
    if (target === null) {
      return new Response('Plugin admin UI not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function showMainWindow(): void {  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow?.show();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow(mainContext: MainContext, adminIndex: string): BrowserWindow {
  const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png');
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 980,
    minHeight: 660,
    show: false,
    title: 'CloudBox 管理控制台',
    backgroundColor: '#020617',
    icon: icon && !icon.isEmpty() ? icon : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  window.removeMenu();
  window.setMenuBarVisibility(false);

  window.once('ready-to-show', () => {
    const startHidden =
      process.argv.includes('--hidden') &&
      mainContext.services.settings.get('startup.startInTray');
    if (startHidden) window.hide();
    else window.show();
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  window.webContents.session.setPermissionCheckHandler(() => false);

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] 渲染进程异常退出', details.reason);
  });

  void window.loadFile(adminIndex).catch((error: unknown) => {
    console.error('[main] 加载管理员界面失败', error);
  });

  return window;
}

function applyLoginItemSettings(mainContext: MainContext): void {
  applyLoginItem(
    mainContext.services.settings.get('startup.autoStart'),
    mainContext.services.settings.get('startup.startInTray'),
  );
}
