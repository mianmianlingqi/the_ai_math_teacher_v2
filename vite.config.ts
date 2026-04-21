import path from 'path';
import fs from 'fs';
import os from 'os';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { attachViteLocalApi, createLocalApiContext } from './electron/localApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const localApiContext = createLocalApiContext({
      rootDir: __dirname,
      backupDir: path.resolve(__dirname, 'backup'),
      backupLabel: 'backup',
      env,
      logger: console,
    });
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        watch: {
          ignored: ['**/desktop-dist/**'],
        },
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
          name: 'local-api-plugin',
          configureServer(server) {
            attachViteLocalApi(server, localApiContext);
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
