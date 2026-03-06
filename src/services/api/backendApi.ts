/**
 * 后端 API 客户端
 * 统一管理 Token 存储、自动刷新和请求封装
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
const ACCESS_TOKEN_KEY = 'ai_math_access_token';
const REFRESH_TOKEN_KEY = 'ai_math_refresh_token';
const USER_KEY = 'ai_math_user';

export interface BackendUser {
  id: string;
  email: string;
  nickname: string | null;
  role: 'free' | 'paid' | 'admin';
  usedToday?: number;
  dailyLimit?: number;
}

// ===== Token 管理 =====
export const tokenStore = {
  getAccess: () => localStorage.getItem(ACCESS_TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_TOKEN_KEY),
  setTokens: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const userStore = {
  get: (): BackendUser | null => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as BackendUser;
    } catch {
      // 数据损坏，自动清除并返回 null
      localStorage.removeItem(USER_KEY);
      return null;
    }
  },
  set: (user: BackendUser) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  clear: () => localStorage.removeItem(USER_KEY),
};

// ===== 核心请求函数（含 Token 自动刷新）=====
// 并发刷新队列（同时发起多个请求时，只执行一次 refresh，其余排队等待）
let isRefreshing = false;
let refreshCallbacks: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

async function withRefresh(failedRequest: () => Promise<Response>): Promise<Response> {
  if (!isRefreshing) {
    isRefreshing = true;
    try {
      const refreshToken = tokenStore.getRefresh();
      if (!refreshToken) throw new Error('No refresh token');

      const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) throw new Error('Refresh failed');
      const data = await res.json();
      tokenStore.setTokens(data.data.accessToken, data.data.refreshToken);
      // 通知所有等待的并发请求：刷新成功，继续执行
      const pending = refreshCallbacks;
      refreshCallbacks = [];
      pending.forEach(cb => cb.resolve());
    } catch (err: any) {
      // 刷新失败：通知所有等待的请求一起失败，避免永久挂起
      const pending = refreshCallbacks;
      refreshCallbacks = [];
      pending.forEach(cb => cb.reject(new Error('会话已过期，请重新登录')));
      tokenStore.clear();
      window.dispatchEvent(new CustomEvent('auth:logout'));
      throw new Error('会话已过期，请重新登录');
    } finally {
      isRefreshing = false;
    }
  } else {
    // 已有 refresh 在进行中，排队等待
    await new Promise<void>((resolve, reject) => {
      refreshCallbacks.push({ resolve, reject });
    });
  }
  return failedRequest();
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  if (!BACKEND_URL) return null; // 未配置后端时静默失败

  const doRequest = () => fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(tokenStore.getAccess() ? { Authorization: `Bearer ${tokenStore.getAccess()}` } : {}),
      ...(options.headers || {}),
    },
  });

  let res = await doRequest();

  if (res.status === 401 && tokenStore.getRefresh()) {
    res = await withRefresh(doRequest);
  }

  const data = await res.json().catch(() => ({ success: false, error: '解析响应失败' }));
  if (!res.ok && !data.success) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

// ===== 认证 API =====
export const authApi = {
  /** 注册 */
  async register(email: string, password: string, nickname?: string) {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, nickname }),
    });
    if (res?.data) {
      tokenStore.setTokens(res.data.accessToken, res.data.refreshToken);
      userStore.set(res.data.user);
    }
    return res;
  },

  /** 登录 */
  async login(email: string, password: string) {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res?.data) {
      tokenStore.setTokens(res.data.accessToken, res.data.refreshToken);
      userStore.set(res.data.user);
    }
    return res;
  },

  /** 退出登录 */
  async logout() {
    await apiFetch('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: tokenStore.getRefresh() }),
    }).catch(() => {});
    tokenStore.clear();
  },

  /** 获取当前用户信息 */
  async getMe(): Promise<BackendUser | null> {
    if (!tokenStore.getAccess()) return null;
    const res = await apiFetch('/api/auth/me').catch(() => null);
    if (res?.data) {
      userStore.set(res.data);
      return res.data;
    }
    return null;
  },

  isLoggedIn: () => !!tokenStore.getAccess(),
  getCurrentUser: () => userStore.get(),

  /**
   * 注销账号（软删除）
   * @param password 当前账号密码，用于二次确认
   * @returns void，失败时抛出 Error
   */
  async deactivate(password: string): Promise<void> {
    await apiFetch('/api/auth/deactivate', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
    // 清除本地 token 并广播登出事件，让 useAuth 同步状态
    tokenStore.clear();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  },
};

// ===== 数据同步 API =====
export type SyncDataType = 'wrong_problems' | 'notes' | 'qbank' | 'settings';

export const syncApi = {
  async upload(type: SyncDataType, payload: any[]): Promise<boolean> {
    if (!authApi.isLoggedIn()) return false;
    try {
      await apiFetch(`/api/sync/${type}`, {
        method: 'PUT',
        body: JSON.stringify({ payload }),
      });
      return true;
    } catch {
      return false;
    }
  },

  async download(type: SyncDataType): Promise<{ payload: any[]; updatedAt: string | null }> {
    const res = await apiFetch(`/api/sync/${type}`);
    return res?.data ?? { payload: [], updatedAt: null };
  },

  async getSyncStatus(): Promise<Record<SyncDataType, string | null>> {
    const res = await apiFetch('/api/sync');
    return res?.data ?? {};
  },
};

/** 判断当前是否启用了后端（环境变量已配置）*/
export const isBackendEnabled = () => !!BACKEND_URL;

/**
 * 唤醒 Railway 后端（免费计划在空闲 5 分钟后进入休眠状态）。
 *
 * Why: Railway 休眠恢复需要 10-30 秒，期间所有请求均报 "Failed to fetch"。
 *      在首次 AI 请求前调用此函数，轮询 /health 直到后端就绪，避免直接失败。
 *
 * @param maxAttempts - 最大轮询次数（默认 6，每次间隔 5s，最多等约 30s）
 * @param onProgress  - 可选：每次等待时的进度回调（传入当前尝试次数）
 * @returns Promise<boolean> — true 表示后端已在线，false 表示超时或未配置
 */
export async function wakeUpBackend(
  maxAttempts = 6,
  onProgress?: (attempt: number) => void,
): Promise<boolean> {
  if (!BACKEND_URL) return false;

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      onProgress?.(i);
      await new Promise(r => setTimeout(r, 5000));
    }
    try {
      const res = await fetch(`${BACKEND_URL}/health`, {
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return true;
    } catch {
      // 后端未就绪，继续等待
    }
  }
  return false;
}

// ===== 管理员 API =====

/** 用户列表条目（来自 GET /api/admin/users） */
export interface AdminUser {
  id: string;
  email: string;
  nickname: string | null;
  role: 'free' | 'paid' | 'admin';
  is_active: boolean;
  created_at: string;
  today_requests: number;
}

/** 用户列表分页响应 */
export interface AdminUsersResult {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Purge 操作统计 */
export interface PurgeStats {
  users: number;
  refreshTokens: number;
  usageRecords: number;
  aiRequestLogs: number;
  userData: number;
}

export const adminApi = {
  /**
   * 获取用户分页列表
   * @param page     - 页码（从1开始）
   * @param pageSize - 每页数量（最大100）
   * @param search   - 按邮箱/昵称搜索（可选）
   */
  async getUsers(page = 1, pageSize = 20, search?: string): Promise<AdminUsersResult> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set('search', search);
    const res = await apiFetch(`/api/admin/users?${params}`);
    return res?.data ?? { users: [], total: 0, page: 1, pageSize, totalPages: 0 };
  },

  /**
   * 清理用户（支持 dryRun 预览）
   * @param scope       - 'all' | 'inactive' | 'single'
   * @param dryRun      - true=仅预览，false=真实删除
   * @param confirmText - 必须传 "PURGE_USERS" 才会执行
   * @param userId      - scope='single' 时必填
   */
  async purgeUsers(
    scope: 'all' | 'inactive' | 'single',
    dryRun: boolean,
    confirmText?: string,
    userId?: string,
  ): Promise<{ willDelete?: PurgeStats; deleted?: PurgeStats; scope: string }> {
    const res = await apiFetch('/api/admin/purge-users', {
      method: 'POST',
      body: JSON.stringify({ scope, dryRun, confirmText, userId }),
    });
    return res?.data ?? {};
  },
};

export const BACKEND_BASE_URL = BACKEND_URL;

// ===== AI 代理 API =====

/** 后台各供应商对应的推荐模型列表 */
const BACKEND_PROVIDER_MODELS: Record<string, { label: string; models: string[] }> = {
  aliyun:   { label: '通义千问', models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long', 'qwen3-235b-a22b', 'qwen3-30b-a3b'] },
  deepseek: { label: 'DeepSeek',  models: ['deepseek-chat', 'deepseek-reasoner'] },
  zhipu:    { label: '智谱 GLM',  models: ['glm-4-flash', 'glm-4', 'glm-4-plus', 'glm-z1-flash'] },
  openai:   { label: 'OpenAI',    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'o3-mini'] },
};

export const aiApi = {
  /** 获取后台已配置 Key 的供应商列表 */
  async getProviders(): Promise<Array<{ id: string; name: string; models: string[] }>> {
    const res = await apiFetch('/api/ai/providers').catch(() => null);
    if (!res?.data) return [];
    return (res.data as Array<{ id: string; name: string }>).map(p => ({
      id: p.id,
      name: p.name,
      models: BACKEND_PROVIDER_MODELS[p.id]?.models ?? [],
    }));
  },

  /** 通过后台代理发起非流式 AI 请求（返回 OpenAI 格式的 data） */
  async chat(providerId: string, model: string, messages: any[], options?: { temperature?: number; max_tokens?: number }): Promise<any> {
    const res = await apiFetch('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ provider: providerId, model, messages, ...options }),
    });
    if (!res?.success) throw new Error(res?.error || 'AI 请求失败');
    return res.data;
  },
};
