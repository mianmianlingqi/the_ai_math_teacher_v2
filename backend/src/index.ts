import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import aiRoutes from './routes/ai';

const app = express();
const PORT = parseInt(process.env.PORT || '4000');

// ===== 基础安全中间件 =====
app.use(helmet());

// CORS：只允许配置的前端域名
// Why: 默认值包含生产 Vercel 域名，避免未配置 CORS_ORIGINS 时 Railway 直接拦截所有请求。
//      生产部署时应在 Railway 环境变量中显式设置 CORS_ORIGINS 以覆盖此默认值。
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://the-ai-math-teacher.vercel.app,http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    // 允许无 origin（如 postman、服务器间调用）
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 请求体解析
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 全局速率限制（防暴力破解）
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 300,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// ===== 健康检查 =====
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ===== API 路由 =====
app.use('/api/ai', aiRoutes);

// ===== 404 处理 =====
app.use((_req, res) => {
  res.status(404).json({ success: false, error: '接口不存在' });
});

// ===== 全局错误处理 =====
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

// ===== 启动 =====
async function start() {
  try {
    console.log('[Server] Running in local mode (AI routes only).');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 AI Math Teacher Backend`);
      console.log(`   Port    : ${PORT}`);
      console.log(`   Env     : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Mode    : local-ai`);
      console.log(`   Health  : http://localhost:${PORT}/health\n`);
    });
  } catch (err: any) {
    console.error('[Server] Failed to start:', err.message);
    process.exit(1);
  }
}

start();
