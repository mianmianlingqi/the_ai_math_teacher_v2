import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const EMPTY_USAGE_STATE = {
  sessionStartedAt: 0,
  updatedAt: 0,
  totals: {
    requests: 0,
    success: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  },
  activeRequests: [],
  perModel: {},
  recentEvents: [],
};

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.end(content);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const body = await readBody(req);
  return JSON.parse(body || '{}');
}

function createTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
}

function validateFilename(filename) {
  if (!filename) {
    return { valid: false, reason: 'Missing filename' };
  }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { valid: false, reason: 'Invalid filename' };
  }
  return { valid: true };
}

function resolvePythonCandidates(rootDir, env = process.env) {
  return [
    env.MARKITDOWN_PYTHON,
    path.resolve(rootDir, 'app', 'python', 'python.exe'),
    path.resolve(rootDir, 'app', 'python', 'Scripts', 'python.exe'),
    path.resolve(rootDir, 'app', 'python', 'bin', 'python'),
    path.resolve(rootDir, '.venv', 'Scripts', 'python.exe'),
    path.resolve(rootDir, '.venv', 'bin', 'python'),
    'python',
  ].filter(Boolean);
}

export function resolvePythonCommand({ rootDir, env = process.env }) {
  const candidates = resolvePythonCandidates(rootDir, env);
  return candidates.find((candidate) => candidate === 'python' || fs.existsSync(candidate)) || 'python';
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'ignore',
      ...options,
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });
}

async function convertPdfWithMarkItDown({ pythonCommand, inputPath, outputPath }) {
  const pythonCode = await runProcess(pythonCommand, ['-m', 'markitdown', inputPath, '-o', outputPath]);
  if (pythonCode === 0 && fs.existsSync(outputPath)) {
    return fs.readFileSync(outputPath, 'utf-8');
  }

  const fallbackCommand = process.platform === 'win32' ? 'markitdown.cmd' : 'markitdown';
  const cliCode = await runProcess(fallbackCommand, [inputPath, '-o', outputPath]);
  if (cliCode === 0 && fs.existsSync(outputPath)) {
    return fs.readFileSync(outputPath, 'utf-8');
  }

  throw new Error('MarkItDown 不可用，请确认已安装 Python 与 markitdown[pdf]。');
}

export function createLocalApiContext({ rootDir, backupDir, env = process.env, logger = console, backupLabel }) {
  ensureDirectory(backupDir);
  return {
    rootDir,
    backupDir,
    backupLabel: backupLabel || backupDir,
    logger,
    pythonCommand: resolvePythonCommand({ rootDir, env }),
    devUsageState: null,
  };
}

export async function handleLocalApiRequest(req, res, context) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const { pathname, searchParams } = requestUrl;

  if (!pathname.startsWith('/api/')) {
    return false;
  }

  if (pathname === '/api/dev-usage-state') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return true;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, context.devUsageState || { updatedAt: 0 });
      return true;
    }

    if (req.method === 'DELETE') {
      context.devUsageState = {
        ...EMPTY_USAGE_STATE,
        sessionStartedAt: Date.now(),
        updatedAt: Date.now(),
      };
      sendJson(res, 200, { success: true });
      return true;
    }

    if (req.method === 'POST') {
      try {
        context.devUsageState = await readJsonBody(req);
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendJson(res, 400, { success: false, error: error.message });
      }
      return true;
    }

    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return true;
  }

  if (pathname === '/api/save-backup' && req.method === 'POST') {
    try {
      const data = await readJsonBody(req);
      ensureDirectory(context.backupDir);

      const customName = data._backupName ? `_${data._backupName}` : '';
      const overwriteLatest = Boolean(data._overwriteLatest);
      const backupReason = data._backupReason || 'manual';
      delete data._backupName;
      delete data._overwriteLatest;
      delete data._backupReason;

      const filename = overwriteLatest
        ? `backup${customName}.json`
        : `backup${customName}_${createTimestamp()}.json`;
      const filePath = path.join(context.backupDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      context.logger.info?.(`[localApi] ${backupReason}备份已保存到 ${filePath}`);

      sendJson(res, 200, { success: true, filename, locationLabel: context.backupLabel });
    } catch (error) {
      context.logger.error?.('[localApi] 保存备份失败', error);
      sendJson(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  if (pathname === '/api/list-backups' && req.method === 'GET') {
    try {
      ensureDirectory(context.backupDir);
      const files = fs.readdirSync(context.backupDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          const stat = fs.statSync(path.join(context.backupDir, file));
          return {
            name: file,
            time: stat.mtimeMs,
            size: stat.size,
            isAuto: file.includes('_auto_latest.json'),
          };
        })
        .sort((a, b) => b.time - a.time);
      sendJson(res, 200, files);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  if (pathname === '/api/delete-backup' && req.method === 'DELETE') {
    const filename = searchParams.get('filename');
    const validation = validateFilename(filename);
    if (!validation.valid) {
      sendJson(res, validation.reason === 'Invalid filename' ? 403 : 400, { success: false, error: validation.reason });
      return true;
    }

    try {
      const filePath = path.join(context.backupDir, filename);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { success: false, error: 'File not found' });
        return true;
      }

      fs.unlinkSync(filePath);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  if (pathname === '/api/load-backup' && req.method === 'GET') {
    const filename = searchParams.get('filename');
    const validation = validateFilename(filename);
    if (!validation.valid) {
      sendText(res, validation.reason === 'Invalid filename' ? 403 : 400, validation.reason);
      return true;
    }

    try {
      const filePath = path.join(context.backupDir, filename);
      if (!fs.existsSync(filePath)) {
        sendText(res, 404, 'File not found');
        return true;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      sendText(res, 200, content, 'application/json; charset=utf-8');
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message });
    }
    return true;
  }

  if (pathname === '/api/convert-pdf' && req.method === 'POST') {
    let inputPath = '';
    let outputPath = '';

    try {
      const payload = await readJsonBody(req);
      if (!payload?.dataBase64) {
        sendJson(res, 400, { success: false, error: 'Missing dataBase64' });
        return true;
      }

      const tempDir = path.join(os.tmpdir(), 'ai-math-teacher-markitdown');
      ensureDirectory(tempDir);

      const safeName = String(payload.filename || 'upload.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_');
      inputPath = path.join(tempDir, `${Date.now()}_${safeName}`);
      outputPath = inputPath.replace(/\.pdf$/i, '') + '.md';

      fs.writeFileSync(inputPath, Buffer.from(payload.dataBase64, 'base64'));
      const markdown = await convertPdfWithMarkItDown({
        pythonCommand: context.pythonCommand,
        inputPath,
        outputPath,
      });

      sendJson(res, 200, { success: true, markdown });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message || 'markitdown 转换失败' });
    } finally {
      if (inputPath) {
        fs.rmSync(inputPath, { force: true });
      }
      if (outputPath) {
        fs.rmSync(outputPath, { force: true });
      }
    }
    return true;
  }

  return false;
}

export function attachViteLocalApi(server, context) {
  server.middlewares.use(async (req, res, next) => {
    try {
      const handled = await handleLocalApiRequest(req, res, context);
      if (!handled) {
        next();
      }
    } catch (error) {
      context.logger.error?.('[localApi] Vite 中间件处理失败', error);
      sendJson(res, 500, { success: false, error: error.message || '本地 API 处理失败' });
    }
  });
}