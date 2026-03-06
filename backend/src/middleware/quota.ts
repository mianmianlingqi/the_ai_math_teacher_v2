import { Response, NextFunction } from 'express';
import { db } from '../db/client';
import { AuthRequest } from '../types';

const FREE_DAILY_QUOTA = parseInt(process.env.FREE_DAILY_QUOTA || '10');
const PAID_DAILY_QUOTA = parseInt(process.env.PAID_DAILY_QUOTA || '500');

export async function checkQuota(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, error: '未登录' });
    return;
  }

  const { userId, role } = req.user;
  const limit = role === 'paid' || role === 'admin' ? PAID_DAILY_QUOTA : FREE_DAILY_QUOTA;

  try {
    // 获取今日用量，没有则初始化为 0
    const result = await db.query(
      `INSERT INTO usage_records (user_id, date, request_count)
       VALUES ($1, CURRENT_DATE, 0)
       ON CONFLICT (user_id, date) DO UPDATE SET user_id = usage_records.user_id
       RETURNING request_count`,
      [userId]
    );

    const currentCount: number = result.rows[0]?.request_count ?? 0;

    if (currentCount >= limit) {
      res.status(429).json({
        success: false,
        error: `今日 AI 请求次数已达上限（${limit} 次）。${role === 'free' ? '升级为付费用户可获得更多次数。' : ''}`,
        data: { used: currentCount, limit },
      });
      return;
    }

    // 挂载配额信息供后续路由使用
    (req as any).quota = { used: currentCount, limit };
    next();
  } catch (err: any) {
    console.error('[Quota] Error:', err.message);
    // 配额检查失败时放行（避免数据库问题影响正常使用）
    next();
  }
}

/** 记录一次成功的 AI 请求用量 */
export async function recordUsage(
  userId: string,
  promptTokens = 0,
  completionTokens = 0
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO usage_records (user_id, date, request_count, prompt_tokens, completion_tokens)
       VALUES ($1, CURRENT_DATE, 1, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET
         request_count      = usage_records.request_count + 1,
         prompt_tokens      = usage_records.prompt_tokens + $2,
         completion_tokens  = usage_records.completion_tokens + $3`,
      [userId, promptTokens, completionTokens]
    );
  } catch (err: any) {
    console.error('[Quota] recordUsage error:', err.message);
  }
}
