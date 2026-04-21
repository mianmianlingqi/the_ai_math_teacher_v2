import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, shell } from 'electron';
import { startLocalServer } from './localServer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:3000';

let desktopServer = null;
let mainWindow = null;

async function resolveRendererUrl() {
  if (!app.isPackaged) {
    return DEV_SERVER_URL;
  }

  if (!desktopServer) {
    desktopServer = await startLocalServer({
      appRoot: app.getAppPath(),
      userDataDir: app.getPath('userData'),
      logger: console,
    });
    console.log(`[electron] 本地桌面服务已启动: ${desktopServer.url}`);
  }

  return desktopServer.url;
}

async function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.mjs');

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'AI 数学老师',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    console.log('[electron] 主窗口已就绪');
  });

  const rendererUrl = await resolveRendererUrl();
  await mainWindow.loadURL(rendererUrl);
}

app.whenReady().then(async () => {
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}).catch((error) => {
  console.error('[electron] 启动失败', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (desktopServer) {
    desktopServer.close().catch((error) => {
      console.error('[electron] 关闭本地桌面服务失败', error);
    });
    desktopServer = null;
  }
});