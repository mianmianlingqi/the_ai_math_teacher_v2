import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/client';
import { requireAuth, generateTokens } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);

// ===== POST /api/auth/register =====
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, nickname } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, error: '邮箱和密码不能为空' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, error: '邮箱格式不正确' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ success: false, error: '密码至少需要 8 位' });
    return;
  }

  try {
    const exists = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length > 0) {
      res.status(409).json({ success: false, error: '该邮箱已注册' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const role = ADMIN_EMAILS.has(email.toLowerCase()) ? 'admin' : 'free';

    const result = await db.query(
      `INSERT INTO users (email, password_hash, nickname, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, nickname, role, created_at`,
      [email.toLowerCase(), passwordHash, nickname || null, role]
    );

    const user = result.rows[0];
    const tokens = generateTokens({ userId: user.id, email: user.email, role: user.role });

    // 保存 refresh token hash
    const tokenHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, tokenHash]
    );

    res.status(201).json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (err: any) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ success: false, error: '注册失败，请稍后重试' });
  }
});

// ===== POST /api/auth/login =====
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, error: '邮箱和密码不能为空' });
    return;
  }

  try {
    const result = await db.query(
      'SELECT id, email, password_hash, nickname, role, is_active FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ success: false, error: '邮箱或密码错误' });
      return;
    }
    if (!user.is_active) {
      res.status(403).json({ success: false, error: '账号已被禁用，请联系管理员' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ success: false, error: '邮箱或密码错误' });
      return;
    }

    const tokens = generateTokens({ userId: user.id, email: user.email, role: user.role });
    const tokenHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, tokenHash]
    );

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (err: any) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ success: false, error: '登录失败，请稍后重试' });
  }
});

// ===== POST /api/auth/refresh =====
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ success: false, error: '缺少 refreshToken' });
    return;
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const result = await db.query(
      `SELECT rt.user_id, u.email, u.role
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.expires_at > NOW() AND u.is_active = TRUE`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: '无效或已过期的 refreshToken' });
      return;
    }

    const { user_id, email, role } = result.rows[0];
    const tokens = generateTokens({ userId: user_id, email, role });

    // 旧 token 失效，写入新 token
    await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    const newHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user_id, newHash]
    );

    res.json({ success: true, data: tokens });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '刷新失败' });
  }
});

// ===== POST /api/auth/logout =====
router.post('/logout', requireAuth, async (req: AuthRequest, res: Response) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]).catch(() => {});
  }
  res.json({ success: true, message: '已退出登录' });
});

// ===== GET /api/auth/me（获取当前用户信息）=====
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.query(
      'SELECT id, email, nickname, role, created_at FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (!result.rows[0]) {
      res.status(404).json({ success: false, error: '用户不存在' });
      return;
    }

    // 获取今日用量
    const usage = await db.query(
      'SELECT request_count FROM usage_records WHERE user_id = $1 AND date = CURRENT_DATE',
      [req.user!.userId]
    );
    const usedToday = usage.rows[0]?.request_count ?? 0;
    const limit = result.rows[0].role === 'free'
      ? parseInt(process.env.FREE_DAILY_QUOTA || '10')
      : parseInt(process.env.PAID_DAILY_QUOTA || '500');

    res.json({
      success: true,
      data: { ...result.rows[0], usedToday, dailyLimit: limit },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '获取用户信息失败' });
  }
});

// ===== PATCH /api/auth/profile（修改昵称/密码）=====
router.patch('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  const { nickname, oldPassword, newPassword } = req.body;

  try {
    if (newPassword) {
      if (newPassword.length < 8) {
        res.status(400).json({ success: false, error: '新密码至少需要 8 位' });
        return;
      }
      const userResult = await db.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user!.userId]
      );
      const valid = await bcrypt.compare(oldPassword || '', userResult.rows[0]?.password_hash || '');
      if (!valid) {
        res.status(400).json({ success: false, error: '原密码错误' });
        return;
      }
      const newHash = await bcrypt.hash(newPassword, 12);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user!.userId]);
    }

    if (nickname !== undefined) {
      await db.query('UPDATE users SET nickname = $1 WHERE id = $2', [nickname || null, req.user!.userId]);
    }

    res.json({ success: true, message: '资料已更新' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

// ===== DELETE /api/auth/deactivate（注销账号）=====
// 软删除：将 is_active 置为 false 并撤销所有 refresh token
// 已登录用户必须再次提供密码确认，防止误操作
router.delete('/deactivate', requireAuth, async (req: AuthRequest, res: Response) => {
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ success: false, error: '请提供密码以确认注销' });
    return;
  }

  try {
    // 1. 验证密码
    const userResult = await db.query(
      'SELECT password_hash, role FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (!userResult.rows[0]) {
      res.status(404).json({ success: false, error: `用户 [ID: ${req.user!.userId}] 不存在。Hint: 请重新登录后再试。` });
      return;
    }
    const valid = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!valid) {
      res.status(400).json({ success: false, error: '密码错误，注销失败。Hint: 请确认你输入了当前账号的正确密码。' });
      return;
    }

    // 2. 软删除：置为不活跃（保留数据供审计，管理员可恢复）
    await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [req.user!.userId]);

    // 3. 撤销所有 refresh token，让设备全部下线
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user!.userId]);

    res.json({ success: true, message: '账号已注销' });
  } catch (err: any) {
    console.error('[Auth] Deactivate error:', err.message);
    res.status(500).json({ success: false, error: `注销失败，原因[${err.message}]。Hint: 请稍后重试或联系管理员。` });
  }
});

export default router;
