import { Router, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { db } from '../db/client';
import { AuthRequest, DataType } from '../types';

const router = Router();

const VALID_TYPES: DataType[] = ['wrong_problems', 'notes', 'qbank', 'settings'];

// ===== GET /api/sync/:type（下载云端数据）=====
router.get('/:type', requireAuth, async (req: AuthRequest, res: Response) => {
  const dataType = req.params.type as DataType;
  if (!VALID_TYPES.includes(dataType)) {
    res.status(400).json({ success: false, error: '无效的数据类型' });
    return;
  }

  try {
    const result = await db.query(
      'SELECT payload, updated_at FROM user_data WHERE user_id = $1 AND data_type = $2',
      [req.user!.userId, dataType]
    );

    res.json({
      success: true,
      data: {
        payload: result.rows[0]?.payload ?? [],
        updatedAt: result.rows[0]?.updated_at ?? null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '获取数据失败' });
  }
});

// ===== PUT /api/sync/:type（上传/覆盖云端数据）=====
router.put('/:type', requireAuth, async (req: AuthRequest, res: Response) => {
  const dataType = req.params.type as DataType;
  if (!VALID_TYPES.includes(dataType)) {
    res.status(400).json({ success: false, error: '无效的数据类型' });
    return;
  }

  const { payload } = req.body;
  if (payload === undefined) {
    res.status(400).json({ success: false, error: '缺少 payload' });
    return;
  }

  // 简单限制单次同步大小（防止滥用）
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 5 * 1024 * 1024) { // 5MB
    res.status(413).json({ success: false, error: '数据超出限制（最大 5MB）' });
    return;
  }

  try {
    await db.query(
      `INSERT INTO user_data (user_id, data_type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, data_type) DO UPDATE SET
         payload    = EXCLUDED.payload,
         updated_at = NOW()`,
      [req.user!.userId, dataType, payload]
    );

    res.json({ success: true, message: '数据已同步', data: { updatedAt: new Date().toISOString() } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '同步失败' });
  }
});

// ===== GET /api/sync（获取所有数据类型的最后同步时间，用于检查是否需要同步）=====
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.query(
      'SELECT data_type, updated_at FROM user_data WHERE user_id = $1',
      [req.user!.userId]
    );

    const summary: Record<string, string | null> = {};
    VALID_TYPES.forEach(t => { summary[t] = null; });
    result.rows.forEach((r: any) => { summary[r.data_type] = r.updated_at; });

    res.json({ success: true, data: summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '获取同步状态失败' });
  }
});

export default router;
