import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const portablePythonWin = path.resolve(__dirname, 'app', 'python', 'python.exe');
    const portablePythonWinVenv = path.resolve(__dirname, 'app', 'python', 'Scripts', 'python.exe');
    const portablePythonNix = path.resolve(__dirname, 'app', 'python', 'bin', 'python');
    const venvPythonWin = path.resolve(__dirname, '.venv', 'Scripts', 'python.exe');
    const venvPythonNix = path.resolve(__dirname, '.venv', 'bin', 'python');

    const pythonCmdCandidates = [
      env.MARKITDOWN_PYTHON,
      portablePythonWin,
      portablePythonWinVenv,
      portablePythonNix,
      venvPythonWin,
      venvPythonNix,
      'python',
    ].filter(Boolean) as string[];

    const pythonCmd = pythonCmdCandidates.find(cmd => cmd === 'python' || fs.existsSync(cmd)) || 'python';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'port-writer-plugin',
          configureServer(server) {
            const portFile = path.join(os.tmpdir(), 'ai-math-teacher-port.txt');
            server.httpServer?.once('listening', () => {
              const addr = server.httpServer?.address();
              const port = addr && typeof addr === 'object' ? addr.port : null;
              if (port) {
                try { fs.writeFileSync(portFile, String(port), 'utf-8'); } catch {}
              }
            });
            server.httpServer?.once('close', () => {
              try { if (fs.existsSync(portFile)) fs.unlinkSync(portFile); } catch {}
            });
          },
        },
        {
          name: 'backup-plugin',
          configureServer(server) {
            let devUsageState: any = null;

            server.middlewares.use('/api/dev-usage-state', (req, res, next) => {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

              if (req.method === 'OPTIONS') {
                res.statusCode = 204;
                res.end();
                return;
              }

              if (req.method === 'GET') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(devUsageState || { updatedAt: 0 }));
                return;
              }

              if (req.method === 'DELETE') {
                devUsageState = { sessionStartedAt: Date.now(), updatedAt: Date.now(), totals: { requests: 0, success: 0, failed: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }, activeRequests: [], perModel: {}, recentEvents: [] };
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
                return;
              }

              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk.toString();
                });
                req.on('end', () => {
                  try {
                    devUsageState = JSON.parse(body || '{}');
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true }));
                  } catch (err: any) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: false, error: err.message }));
                  }
                });
                return;
              }

              next();
            });

            server.middlewares.use('/api/save-backup', (req, res, next) => {
              if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                  body += chunk.toString();
                });
                req.on('end', () => {
                  try {
                    const data = JSON.parse(body);
                    const backupDir = path.resolve(__dirname, 'backup');
                    if (!fs.existsSync(backupDir)) {
                      fs.mkdirSync(backupDir);
                    }
                    
                    // Format filename: backup_YYYYMMDD_HHmmss.json
                    const now = new Date();
                    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                    const customName = data._backupName ? `_${data._backupName}` : '';
                    delete data._backupName; // Remove the temp property
                    
                    const filename = `backup${customName}_${timestamp}.json`;
                    const filePath = path.join(backupDir, filename);
                    
                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                    
                    console.log(`[Backup Plugin] Saved to ${filePath}`);
                    
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true, filename: filename }));
                  } catch (err: any) {
                    console.error('[Backup Plugin] Error:', err);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: false, error: err.message }));
                  }
                });
              } else {
                next();
              }
            });
            
            // List backups endpoint
            server.middlewares.use('/api/list-backups', (req, res, next) => {
               if (req.method === 'GET') {
                  try {
                    const backupDir = path.resolve(__dirname, 'backup');
                    if (!fs.existsSync(backupDir)) {
                       res.setHeader('Content-Type', 'application/json');
                       res.end(JSON.stringify([]));
                       return;
                    }
                    
                    const files = fs.readdirSync(backupDir)
                        .filter(f => f.endsWith('.json'))
                        .map(f => {
                            const stat = fs.statSync(path.join(backupDir, f));
                    return { name: f, time: stat.mtime, size: stat.size };
                        })
                        .sort((a, b) => b.time.getTime() - a.time.getTime());
                        
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(files));
                  } catch (err: any) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: err.message }));
                  }
               } else {
                  next();
               }
            });

            server.middlewares.use('/api/delete-backup', (req, res, next) => {
              if (req.method === 'DELETE') {
                const url = new URL(req.url!, `http://${req.headers.host}`);
                const filename = url.searchParams.get('filename');

                if (!filename) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: false, error: 'Missing filename' }));
                  return;
                }

                if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                  res.statusCode = 403;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: false, error: 'Invalid filename' }));
                  return;
                }

                try {
                  const filePath = path.resolve(__dirname, 'backup', filename);
                  if (!fs.existsSync(filePath)) {
                    res.statusCode = 404;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: false, error: 'File not found' }));
                    return;
                  }

                  fs.unlinkSync(filePath);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: true }));
                } catch (err: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: false, error: err.message }));
                }
              } else {
                next();
              }
            });

            // Load backup endpoint
            server.middlewares.use('/api/load-backup', (req, res, next) => {
               if (req.method === 'GET') {
                  const url = new URL(req.url!, `http://${req.headers.host}`);
                  const filename = url.searchParams.get('filename');
                  
                  if (!filename) {
                     res.statusCode = 400;
                     res.end('Missing filename');
                     return;
                  }
                  
                  // Security check: prevent directory traversal
                  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                     res.statusCode = 403;
                     res.end('Invalid filename');
                     return;
                  }

                  try {
                    const filePath = path.resolve(__dirname, 'backup', filename);
                    if (!fs.existsSync(filePath)) {
                       res.statusCode = 404;
                       res.end('File not found');
                       return;
                    }
                    
                    const content = fs.readFileSync(filePath, 'utf-8');
                    res.setHeader('Content-Type', 'application/json');
                    res.end(content);
                  } catch (err: any) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: err.message }));
                  }
               } else {
                  next();
               }
            });

            // Convert PDF to Markdown using MarkItDown (server-side)
            server.middlewares.use('/api/convert-pdf', (req, res, next) => {
              if (req.method !== 'POST') {
                next();
                return;
              }

              let body = '';
              req.on('data', chunk => {
                body += chunk.toString();
              });

              req.on('end', async () => {
                try {
                  const parsed = JSON.parse(body || '{}');
                  const base64Data = parsed?.dataBase64;
                  const filename = parsed?.filename || 'upload.pdf';

                  if (!base64Data) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: false, error: 'Missing dataBase64' }));
                    return;
                  }

                  const tempDir = path.join(os.tmpdir(), 'markitdown');
                  if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                  }

                  const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
                  const inputPath = path.join(tempDir, `${Date.now()}_${safeName}`);
                  const outputPath = inputPath.replace(/\.pdf$/i, '') + '.md';

                  const buffer = Buffer.from(base64Data, 'base64');
                  fs.writeFileSync(inputPath, buffer);

                  const markitdownArgs = ['-m', 'markitdown', inputPath, '-o', outputPath];
                  const markitdown = spawn(pythonCmd, markitdownArgs, {
                    stdio: 'ignore',
                    shell: false,
                  });

                  markitdown.on('error', (err) => {
                    const fallback = spawn('markitdown', [inputPath, '-o', outputPath], {
                      stdio: 'ignore',
                      shell: true,
                    });

                    fallback.on('close', (code) => {
                      if (code !== 0 || !fs.existsSync(outputPath)) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                          success: false,
                          error: `MarkItDown 不可用。请优先在 app/python 内置便携版 Python，或在项目 .venv 执行: .\\.venv\\Scripts\\pip install "markitdown[pdf]"`,
                        }));
                        return;
                      }

                      const markdown = fs.readFileSync(outputPath, 'utf-8');
                      fs.rmSync(inputPath, { force: true });
                      fs.rmSync(outputPath, { force: true });
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ success: true, markdown }));
                    });
                  });

                  markitdown.on('close', (code) => {
                    try {
                      if (code !== 0 || !fs.existsSync(outputPath)) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: false, error: 'markitdown 转换失败，请确认已安装 markitdown' }));
                        return;
                      }

                      const markdown = fs.readFileSync(outputPath, 'utf-8');

                      fs.rmSync(inputPath, { force: true });
                      fs.rmSync(outputPath, { force: true });

                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ success: true, markdown }));
                    } catch (err: any) {
                      res.statusCode = 500;
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ success: false, error: err?.message || '转换失败' }));
                    }
                  });
                } catch (err: any) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: false, error: err?.message || '解析请求失败' }));
                }
              });
            });
          }
        } 
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          // 将 @/ 指向 src/ 目录，与 tsconfig.json 保持一致
          '@': path.resolve(__dirname, 'src'),
        }
      }
    };
});
