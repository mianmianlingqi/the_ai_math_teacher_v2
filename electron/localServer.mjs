import fs from 'fs';
import http from 'http';
import path from 'path';
import { createLocalApiContext, handleLocalApiRequest } from './localApi.mjs';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function resolveMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function normalizeRequestPath(pathname) {
  const decoded = decodeURIComponent(pathname || '/');
  const cleaned = decoded === '/' ? '/index.html' : decoded;
  const stripped = cleaned.replace(/^\/+/, '');
  if (stripped.includes('..')) {
    return null;
  }
  return stripped;
}

function sendFile(res, filePath) {
  res.statusCode = 200;
  res.setHeader('Content-Type', resolveMimeType(filePath));
  res.end(fs.readFileSync(filePath));
}

export async function startLocalServer({ appRoot, userDataDir, logger = console }) {
  const distDir = path.join(appRoot, 'dist');
  const apiContext = createLocalApiContext({
    rootDir: appRoot,
    backupDir: path.join(userDataDir, 'backup'),
    autoSaveDir: path.join(userDataDir, 'AutoSave'),
    backupLabel: '桌面应用数据目录/backup',
    autoSaveLabel: '桌面应用数据目录/AutoSave',
    logger,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const handled = await handleLocalApiRequest(req, res, apiContext);
      if (handled) {
        return;
      }

      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const normalizedPath = normalizeRequestPath(requestUrl.pathname);
      if (!normalizedPath) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      const targetPath = path.join(distDir, normalizedPath);
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        sendFile(res, targetPath);
        return;
      }

      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        sendFile(res, indexPath);
        return;
      }

      res.statusCode = 404;
      res.end('dist/index.html not found');
    } catch (error) {
      logger.error?.('[electron] 本地桌面服务异常', error);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
