import { Menu, Tray, nativeImage } from 'electron';

export interface TrayOptions {
  iconPath: string;
  onOpen: () => void;
  onQuit: () => void;
}

export function createAppTray(options: TrayOptions): Tray {
  const image = nativeImage.createFromPath(options.iconPath);
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);

  tray.setToolTip('CloudBox 管理控制台');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 CloudBox 管理控制台', click: options.onOpen },
      { type: 'separator' },
      { label: '退出 CloudBox', click: options.onQuit },
    ]),
  );

  tray.on('double-click', options.onOpen);
  return tray;
}
