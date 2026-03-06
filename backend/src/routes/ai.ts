import { Router, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { checkQuota, recordUsage } from '../middleware/quota';
import { db } from '../db/client';
import { AuthRequest } from '../types';
// @ts-ignore
import fetch from 'node-fetch';

const router = Router();

// 支持的供应商配置（从环境变量读取，前端无法得知 Key）
function getProviders() {
  return {
    aliyun: {
      name: '通义千问',
      baseUrl: process.env.ALIYUN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.ALIYUN_API_KEY || '',
    },
    zhipu: {
      name: '智谱 GLM',
      baseUrl: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: process.env.ZHIPU_API_KEY || '',
    },
    deepseek: {
      name: 'DeepSeek',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
    },
    openai: {
      name: 'OpenAI',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY || '',
    },
    // 自定义端点（如用户自己配置了中转站）
    custom: {
      name: '自定义',
      baseUrl: '',
      apiKey: '',
    },
  };
}

// ===== GET /api/ai/providers（获取可用供应商列表，不暴露 Key）=====
router.get('/providers', requireAuth, (_req: AuthRequest, res: Response) => {
  const providers = getProviders();
  const available = Object.entries(providers)
    .filter(([, p]) => p.apiKey)
    .map(([id, p]) => ({ id, name: p.name }));
  res.json({ success: true, data: available });
});

// ===== POST /api/ai/chat（普通非流式请求）=====
router.post('/chat', requireAuth, checkQuota, async (req: AuthRequest, res: Response) => {
  const { provider: providerId = 'aliyun', model, messages, temperature, max_tokens, response_format } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ success: false, error: '缺少 messages 参数' });
    return;
  }

  const providers = getProviders();
  const provider = providers[providerId as keyof typeof providers];
  if (!provider || !provider.apiKey) {
    res.status(400).json({ success: false, error: `供应商 ${providerId} 不可用，请联系管理员` });
    return;
  }

  try {
    const body: Record<string, any> = { model, messages, temperature, max_tokens };
    if (response_format) body.response_format = response_format;

    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json() as any;

    if (!upstream.ok) {
      res.status(upstream.status).json({ success: false, error: data?.error?.message || '上游 AI 请求失败' });
      return;
    }

    // 记录用量
    const usage = data.usage || {};
    await recordUsage(req.user!.userId, usage.prompt_tokens || 0, usage.completion_tokens || 0);
    await logRequest(req.user!.userId, providerId, model, usage, true);

    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[AI] chat error:', err.message);
    await logRequest(req.user!.userId, providerId, model, {}, false, err.message);
    res.status(500).json({ success: false, error: 'AI 请求失败，请稍后重试' });
  }
});

// ===== POST /api/ai/stream（流式 SSE 请求）=====
router.post('/stream', requireAuth, checkQuota, async (req: AuthRequest, res: Response) => {
  const { provider: providerId = 'aliyun', model, messages, temperature, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ success: false, error: '缺少 messages 参数' });
    return;
  }

  const providers = getProviders();
  const provider = providers[providerId as keyof typeof providers];
  if (!provider || !provider.apiKey) {
    res.status(400).json({ success: false, error: `供应商 ${providerId} 不可用` });
    return;
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 关闭 nginx 缓冲

  try {
    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens, stream: true }),
    });

    if (!upstream.ok) {
      const errData = await upstream.json() as any;
      res.write(`data: ${JSON.stringify({ error: errData?.error?.message || '上游请求失败' })}\n\n`);
      res.end();
      return;
    }

    // 透传 SSE 流
    let completionTokens = 0;
    const body = upstream.body as any;
    body.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      res.write(text);
      // 粗略统计 completion tokens
      const matches = text.match(/"content":"([^"]*)"/g);
      if (matches) {
        completionTokens += matches.join('').length / 4;
      }
    });

    body.on('end', async () => {
      res.end();
      await recordUsage(req.user!.userId, 0, Math.round(completionTokens));
      await logRequest(req.user!.userId, providerId, model, { completion_tokens: Math.round(completionTokens) }, true);
    });

    body.on('error', (err: Error) => {
      console.error('[AI] Stream error:', err.message);
      res.end();
    });

    req.on('close', () => {
      (body as any).destroy?.();
    });

  } catch (err: any) {
    console.error('[AI] stream error:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'AI 请求失败' })}\n\n`);
    res.end();
  }
});

async function logRequest(
  userId: string,
  provider: string,
  model: string,
  usage: Record<string, number>,
  success: boolean,
  errorMsg?: string
) {
  try {
    await db.query(
      `INSERT INTO ai_request_logs (user_id, provider, model, prompt_tokens, completion_tokens, success, error_msg)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, provider, model, usage.prompt_tokens || 0, usage.completion_tokens || 0, success, errorMsg || null]
    );
  } catch {}
}

export default router;
