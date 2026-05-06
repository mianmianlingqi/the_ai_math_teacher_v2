import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { buildPaperWordBuffers } from './wordExport.mjs';

const fsPromises = fs.promises;

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

async function ensureDirectoryAsync(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true });
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

function sendBinary(res, statusCode, content, contentType, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
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

function createReadableTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
}

function sanitizeFilename(name) {
  return String(name || 'AI数学老师标准试卷')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
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

async function writeUniqueAutoSaveFile(autoSaveDir, baseName, content) {
  let attempt = 0;
  while (attempt < 1000) {
    const suffix = attempt === 0 ? '' : `_${String(attempt).padStart(2, '0')}`;
    const filename = `${baseName}${suffix}.dat`;
    const filePath = path.join(autoSaveDir, filename);

    try {
      await fsPromises.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
      return { filename, filePath };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      attempt += 1;
    }
  }

  throw new Error('自动存档文件名生成失败：短时间内创建了过多同名存档。');
}

async function listAutoSaveFiles(autoSaveDir) {
  await ensureDirectoryAsync(autoSaveDir);
  const entries = await fsPromises.readdir(autoSaveDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.dat')) continue;
    const filePath = path.join(autoSaveDir, entry.name);
    const stat = await fsPromises.stat(filePath);
    results.push({
      name: entry.name,
      timestamp: stat.mtimeMs,
      size: stat.size,
    });
  }

  results.sort((a, b) => b.timestamp - a.timestamp || a.name.localeCompare(b.name));
  return results;
}

async function enforceAutoSaveRetention(autoSaveDir, maxCount) {
  const validMaxCount = Math.min(100, Math.max(1, Number.parseInt(String(maxCount || 10), 10) || 10));
  const files = await listAutoSaveFiles(autoSaveDir);
  if (files.length <= validMaxCount) {
    return files;
  }

  const removable = files.slice(validMaxCount);
  for (const file of removable) {
    await fsPromises.unlink(path.join(autoSaveDir, file.name));
  }

  return files.slice(0, validMaxCount);
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

export function createLocalApiContext({ rootDir, backupDir, autoSaveDir, env = process.env, logger = console, backupLabel, autoSaveLabel }) {
  ensureDirectory(backupDir);
  ensureDirectory(autoSaveDir);
  return {
    rootDir,
    backupDir,
    autoSaveDir,
    backupLabel: backupLabel || backupDir,
    autoSaveLabel: autoSaveLabel || autoSaveDir,
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

  if (pathname === '/api/autosave/save' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      if (!payload?.data || typeof payload.data !== 'object') {
        sendJson(res, 400, { success: false, error: '缺少自动存档数据 payload' });
        return true;
      }

      await ensureDirectoryAsync(context.autoSaveDir);
      const timestampText = createReadableTimestamp();
      const content = JSON.stringify(payload.data, null, 2);
      const { filename, filePath } = await writeUniqueAutoSaveFile(context.autoSaveDir, `save_${timestampText}`, content);
      await enforceAutoSaveRetention(context.autoSaveDir, payload.maxSaves);
      const stat = await fsPromises.stat(filePath);

      context.logger.info?.(`[localApi] 自动存档已保存到 ${filePath}`);
      sendJson(res, 200, {
        success: true,
        data: {
          name: filename,
          timestamp: stat.mtimeMs,
          size: stat.size,
          reason: payload.reason || '自动保存',
        },
      });
    } catch (error) {
      context.logger.error?.('[localApi] 自动存档失败', error);
      sendJson(res, 500, { success: false, error: error.message || '自动存档失败' });
    }
    return true;
  }

  if (pathname === '/api/autosave/list' && req.method === 'GET') {
    try {
      const files = await listAutoSaveFiles(context.autoSaveDir);
      sendJson(res, 200, { success: true, data: files });
    } catch (error) {
      context.logger.error?.('[localApi] 获取自动存档列表失败', error);
      sendJson(res, 500, { success: false, error: error.message || '获取自动存档列表失败' });
    }
    return true;
  }

  if (pathname === '/api/autosave/load' && req.method === 'GET') {
    const filename = searchParams.get('name');
    const validation = validateFilename(filename);
    if (!validation.valid) {
      sendJson(res, validation.reason === 'Invalid filename' ? 403 : 400, { success: false, error: validation.reason });
      return true;
    }

    try {
      const filePath = path.join(context.autoSaveDir, filename);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { success: false, error: '自动存档文件不存在' });
        return true;
      }
      const content = await fsPromises.readFile(filePath, 'utf-8');
      sendText(res, 200, content, 'application/json; charset=utf-8');
    } catch (error) {
      context.logger.error?.('[localApi] 读取自动存档失败', error);
      sendJson(res, 500, { success: false, error: error.message || '读取自动存档失败' });
    }
    return true;
  }

  if (pathname === '/api/autosave/delete' && req.method === 'DELETE') {
    const filename = searchParams.get('name');
    const validation = validateFilename(filename);
    if (!validation.valid) {
      sendJson(res, validation.reason === 'Invalid filename' ? 403 : 400, { success: false, error: validation.reason });
      return true;
    }

    try {
      const filePath = path.join(context.autoSaveDir, filename);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { success: false, error: '自动存档文件不存在' });
        return true;
      }
      await fsPromises.unlink(filePath);
      sendJson(res, 200, { success: true, data: true });
    } catch (error) {
      context.logger.error?.('[localApi] 删除自动存档失败', error);
      sendJson(res, 500, { success: false, error: error.message || '删除自动存档失败' });
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

  if (pathname === '/api/export-paper-word' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      if (!payload?.paper || !Array.isArray(payload.paper.questions)) {
        sendJson(res, 400, { success: false, error: 'Missing paper payload' });
        return true;
      }

      const variant = payload.variant === 'answer' ? 'answer' : 'question';
      const paper = payload.paper;
      const title = sanitizeFilename(paper.title || 'AI数学老师标准试卷');
      const timestamp = createTimestamp().slice(0, 8);
      const { questionBuffer, answerBuffer } = await buildPaperWordBuffers(paper, { logger: context.logger });
      const buffer = variant === 'answer' ? answerBuffer : questionBuffer;
      const filename = `${title}_${timestamp}_${variant === 'answer' ? '答案解析卷' : '题目卷'}.docx`;

      sendBinary(
        res,
        200,
        buffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      );
    } catch (error) {
      context.logger.error?.('[localApi] 导出 Word 失败', error);
      sendJson(res, 500, { success: false, error: error.message || '导出 Word 失败' });
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
