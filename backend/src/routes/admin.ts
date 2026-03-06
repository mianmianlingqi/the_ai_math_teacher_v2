import { Router, Response } from 'express';
import { requireAdmin } from '../middleware/auth';
import { db } from '../db/client';
import { AuthRequest } from '../types';

const router = Router();

type PurgeScope = 'all' | 'inactive' | 'single';

interface PurgeUsersBody {
  scope?: PurgeScope;
  userId?: string;
  dryRun?: boolean;
  confirmText?: string;
}

interface PurgeStats {
  users: number;
  refreshTokens: number;
  usageRecords: number;
  aiRequestLogs: number;
  userData: number;
}

const PURGE_CONFIRM_TEXT = 'PURGE_USERS';

/**
 * 构造后台管理操作错误消息。
 * Why: 管理操作属于高风险操作，必须返回可定位、可执行的错误信息。
 */
function buildAdminError(step: string, context: string, reason: string, hint: string): string {
  return `步骤[${step}]失败，${context}，原因[${reason}]。Hint: ${hint}`;
}

/**
 * 统计某个用户的数据行数。
 * Why: 单用户清理需要先给出可审计的预计删除数量。
 */
async function getSingleUserStats(userId: string): Promise<PurgeStats> {
  const [users, refreshTokens, usageRecords, aiRequestLogs, userData] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS count FROM users WHERE id = $1', [userId]),
    db.query('SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE user_id = $1', [userId]),
    db.query('SELECT COUNT(*)::int AS count FROM usage_records WHERE user_id = $1', [userId]),
    db.query('SELECT COUNT(*)::int AS count FROM ai_request_logs WHERE user_id = $1', [userId]),
    db.query('SELECT COUNT(*)::int AS count FROM user_data WHERE user_id = $1', [userId]),
  ]);

  return {
    users: users.rows[0].count,
    refreshTokens: refreshTokens.rows[0].count,
    usageRecords: usageRecords.rows[0].count,
    aiRequestLogs: aiRequestLogs.rows[0].count,
    userData: userData.rows[0].count,
  };
}

/**
 * 统计全部用户数据行数。
 * Why: 全量和按状态清理都需要清晰展示删除影响范围。
 */
async function getGlobalStats(whereSql: string = '', params: any[] = []): Promise<PurgeStats> {
  const [users, refreshTokens, usageRecords, aiRequestLogs, userData] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS count FROM users ${whereSql}`, params),
    db.query(
      `SELECT COUNT(*)::int AS count FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       ${whereSql ? whereSql.replace(/\bu\./g, 'u.') : ''}`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS count FROM usage_records ur
       JOIN users u ON u.id = ur.user_id
       ${whereSql ? whereSql.replace(/\bu\./g, 'u.') : ''}`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS count FROM ai_request_logs l
       JOIN users u ON u.id = l.user_id
       ${whereSql ? whereSql.replace(/\bu\./g, 'u.') : ''}`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS count FROM user_data ud
       JOIN users u ON u.id = ud.user_id
       ${whereSql ? whereSql.replace(/\bu\./g, 'u.') : ''}`,
      params
    ),
  ]);

  return {
    users: users.rows[0].count,
    refreshTokens: refreshTokens.rows[0].count,
    usageRecords: usageRecords.rows[0].count,
    aiRequestLogs: aiRequestLogs.rows[0].count,
    userData: userData.rows[0].count,
  };
}

/**
 * POST /api/admin/bootstrap-admin
 * 一次性管理员初始化接口（Bootstrap）
 *
 * Why: 首个管理员存在「鸡生蛋」问题——无法通过需要 admin 权限的接口来晋升第一个 admin。
 *      此接口用 BOOTSTRAP_SECRET 环境变量作为凭证，绕过 JWT 校验。
 *      使用后可通过删除该环境变量来禁用此功能。
 *
 * @param body.secret  - 必须与 Railway 环境变量 BOOTSTRAP_SECRET 完全一致
 * @param body.email   - 要提升为 admin 的邮箱
 * @returns 更新成功的用户信息
 */
router.post('/bootstrap-admin', async (req, res) => {
  const { secret, email } = req.body as { secret?: string; email?: string };

  // 1. 校验 Bootstrap 密钥：若未配置环境变量，则此接口永远不可用
  const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_SECRET;
  if (!BOOTSTRAP_SECRET) {
    res.status(403).json({
      success: false,
      error: 'Bootstrap 功能未启用。Hint: 在 Railway 后端 Variables 中添加 BOOTSTRAP_SECRET=<随机字符串> 后重新部署。',
    });
    return;
  }

  // 2. 验证密钥是否匹配
  if (!secret || secret !== BOOTSTRAP_SECRET) {
    res.status(403).json({
      success: false,
      error: `Bootstrap 密钥错误。Hint: 请检查 BOOTSTRAP_SECRET 环境变量与请求 body 中的 secret 是否一致。`,
    });
    return;
  }

  // 3. 验证目标邮箱
  if (!email) {
    res.status(400).json({
      success: false,
      error: '缺少 email 参数。Hint: 请在请求 body 中传入要提升为 admin 的邮箱地址。',
    });
    return;
  }

  try {
    // 4. 执行提升操作
    const result = await db.query(
      `UPDATE users SET role = 'admin', updated_at = NOW()
       WHERE email = $1
       RETURNING id, email, nickname, role, updated_at`,
      [email]
    );

    if (result.rowCount === 0) {
      res.status(404).json({
        success: false,
        error: `邮箱 [${email}] 在数据库中不存在。Hint: 请先注册账号，或确认邮箱拼写是否正确。`,
      });
      return;
    }

    const user = result.rows[0];
    res.json({
      success: true,
      message: `✅ 账号 [${user.email}] 已成功提升为 admin 角色。请在前端退出重新登录以刷新 JWT Token。`,
      data: user,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `提升失败：${err?.message || '未知数据库错误'}。Hint: 请检查 DATABASE_URL 环境变量是否正确。`,
    });
  }
});

// 所有管理员路由都需要 admin 权限
router.use(requireAdmin);

// ===== GET /api/admin/users（用户列表）=====
router.get('/users', async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
  const offset = (page - 1) * pageSize;
  const search = req.query.search as string;

  try {
    const where = search ? `WHERE u.email ILIKE $3 OR u.nickname ILIKE $3` : '';
    const params: any[] = [pageSize, offset];
    if (search) params.push(`%${search}%`);

    const result = await db.query(
      `SELECT u.id, u.email, u.nickname, u.role, u.is_active, u.created_at,
              COALESCE(ur.request_count, 0) AS today_requests
       FROM users u
       LEFT JOIN usage_records ur ON ur.user_id = u.id AND ur.date = CURRENT_DATE
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM users u ${where}`,
      search ? [`%${search}%`] : []
    );

    res.json({
      success: true,
      data: {
        users: result.rows,
        total: parseInt(countResult.rows[0].count),
        page,
        pageSize,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

// ===== PATCH /api/admin/users/:id（修改用户角色/状态）=====
router.patch('/users/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { role, is_active } = req.body;

  try {
    const updates: string[] = [];
    const params: any[] = [];

    if (role !== undefined) {
      if (!['free', 'paid', 'admin'].includes(role)) {
        res.status(400).json({ success: false, error: '无效的 role 值' });
        return;
      }
      params.push(role);
      updates.push(`role = $${params.length}`);
    }
    if (is_active !== undefined) {
      params.push(Boolean(is_active));
      updates.push(`is_active = $${params.length}`);
    }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: '没有可更新的字段' });
      return;
    }

    params.push(id);
    await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params
    );

    res.json({ success: true, message: '用户已更新' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

// ===== GET /api/admin/stats（总体统计）=====
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const [userStats, usageStats, recentLogs] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE role = 'free')   AS free_users,
          COUNT(*) FILTER (WHERE role = 'paid')   AS paid_users,
          COUNT(*) FILTER (WHERE role = 'admin')  AS admin_users,
          COUNT(*) FILTER (WHERE is_active = FALSE) AS banned_users,
          COUNT(*) AS total_users
        FROM users
      `),
      db.query(`
        SELECT
          SUM(request_count)       AS total_requests_today,
          SUM(prompt_tokens)       AS total_prompt_tokens_today,
          SUM(completion_tokens)   AS total_completion_tokens_today
        FROM usage_records
        WHERE date = CURRENT_DATE
      `),
      db.query(`
        SELECT l.created_at, u.email, l.provider, l.model, l.prompt_tokens, l.completion_tokens, l.success
        FROM ai_request_logs l
        JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC
        LIMIT 20
      `),
    ]);

    res.json({
      success: true,
      data: {
        users: userStats.rows[0],
        todayUsage: usageStats.rows[0],
        recentRequests: recentLogs.rows,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '获取统计失败' });
  }
});

// ===== GET /api/admin/usage（用量排行）=====
router.get('/usage', async (req: AuthRequest, res: Response) => {
  const days = Math.min(parseInt(req.query.days as string) || 7, 30);

  try {
    const result = await db.query(
      `SELECT u.email, u.nickname, u.role,
              SUM(ur.request_count) AS total_requests,
              SUM(ur.prompt_tokens) AS total_prompt,
              SUM(ur.completion_tokens) AS total_completion
       FROM usage_records ur
       JOIN users u ON u.id = ur.user_id
       WHERE ur.date >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY u.id, u.email, u.nickname, u.role
       ORDER BY total_requests DESC
       LIMIT 50`
    );

    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

// ===== POST /api/admin/purge-users（清理用户数据，支持 dryRun） =====
router.post('/purge-users', async (req: AuthRequest, res: Response) => {
  const { scope = 'all', userId, dryRun = false, confirmText = '' } = (req.body || {}) as PurgeUsersBody;

  if (!['all', 'inactive', 'single'].includes(scope)) {
    res.status(400).json({
      success: false,
      error: buildAdminError('参数校验', `scope[${scope}]`, 'scope 非法', '请使用 all / inactive / single 之一。'),
    });
    return;
  }

  if (confirmText !== PURGE_CONFIRM_TEXT) {
    res.status(400).json({
      success: false,
      error: buildAdminError('安全确认', `confirmText[${confirmText || '空'}]`, '确认文本不匹配', `请传入确认词 ${PURGE_CONFIRM_TEXT}。`),
    });
    return;
  }

  if (scope === 'single' && !userId) {
    res.status(400).json({
      success: false,
      error: buildAdminError('参数校验', 'scope[single]，userId[空]', '缺少 userId', '请补充目标用户 ID。'),
    });
    return;
  }

  try {
    if (scope === 'single') {
      const target = await db.query('SELECT id, email, role FROM users WHERE id = $1', [userId]);
      if (target.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: buildAdminError('定位用户', `userId[${userId}]`, '用户不存在', '请确认用户 ID 后重试。'),
        });
        return;
      }

      const before = await getSingleUserStats(userId!);
      if (dryRun) {
        res.json({
          success: true,
          data: {
            dryRun: true,
            scope,
            target: { id: target.rows[0].id, email: target.rows[0].email, role: target.rows[0].role },
            willDelete: before,
          },
        });
        return;
      }

      await db.query('DELETE FROM users WHERE id = $1', [userId]);

      res.json({
        success: true,
        message: `已清理用户 ${target.rows[0].email} 的全部数据`,
        data: {
          scope,
          deleted: before,
        },
      });
      return;
    }

    const whereSql = scope === 'inactive' ? 'WHERE u.is_active = FALSE' : '';
    const before = await getGlobalStats(whereSql);

    if (dryRun) {
      res.json({
        success: true,
        data: {
          dryRun: true,
          scope,
          willDelete: before,
        },
      });
      return;
    }

    if (scope === 'inactive') {
      await db.query('DELETE FROM users WHERE is_active = FALSE');
    } else {
      await db.query('DELETE FROM users');
    }

    res.json({
      success: true,
      message: scope === 'all' ? '已清理全部用户数据' : '已清理所有停用用户数据',
      data: {
        scope,
        deleted: before,
      },
    });
  } catch (err: any) {
    const reason = err?.message || '未知错误';
    res.status(500).json({
      success: false,
      error: buildAdminError('执行清理', `scope[${scope}]，dryRun[${dryRun}]`, reason, '请先 dryRun 校验范围，再检查数据库连接后重试。'),
    });
  }
});

export default router;
