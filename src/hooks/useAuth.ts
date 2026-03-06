import { useCallback, useEffect, useState } from 'react';
import { authApi, BackendUser } from '@/services/api/backendApi';

/**
 * 统一构造认证错误消息。
 * Why: 业务要求错误必须包含步骤、上下文和修复提示，避免“操作失败”这类模糊提示。
 *
 * @param step 失败步骤名称。
 * @param context 与错误相关的关键上下文。
 * @param reason 原始错误原因。
 * @param hint 修复方向提示。
 * @returns 标准化后的错误消息。
 */
function buildAuthError(step: string, context: string, reason: string, hint: string): string {
  return `步骤[${step}]失败，${context}，原因[${reason}]。Hint: ${hint}`;
}

interface RegisterInput {
  email: string;
  password: string;
  nickname?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface UseAuthResult {
  user: BackendUser | null;
  isLoggedIn: boolean;
  loading: boolean;
  error: string;
  login: (input: LoginInput) => Promise<boolean>;
  register: (input: RegisterInput) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<BackendUser | null>;
  clearError: () => void;
}

/**
 * 管理前端认证会话状态。
 * Why: 统一登录/注册/登出与用户状态，避免多个组件直接读写 localStorage 导致状态漂移。
 *
 * @returns 认证状态与操作方法。
 */
export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<BackendUser | null>(() => authApi.getCurrentUser());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /**
   * 清理当前错误信息。
   * Why: 弹窗切换登录/注册模式时需要清空历史错误，避免误导用户。
   *
   * @returns void
   */
  const clearError = useCallback((): void => {
    setError('');
  }, []);

  /**
   * 刷新当前登录用户信息。
   * Why: 页面刷新后仅有 token，需要再次拉取用户信息（含配额）以恢复完整会话。
   *
   * @returns 当前用户；未登录或拉取失败时返回 null。
   */
  const refreshMe = useCallback(async (): Promise<BackendUser | null> => {
    if (!authApi.isLoggedIn()) {
      setUser(null);
      return null;
    }

    try {
      const me = await authApi.getMe();
      if (!me) {
        throw new Error('接口返回空用户');
      }
      setUser(me);
      return me;
    } catch (err: any) {
      const reason = String(err?.message || '未知错误');
      setError(buildAuthError('刷新登录态', `Token状态[存在]`, reason, '请重新登录后重试。'));
      setUser(null);
      return null;
    }
  }, []);

  /**
   * 执行邮箱密码登录。
   * Why: 登录成功后需要同步用户状态到 React，保证 UI 立即切换为“已登录”。
   *
   * @param input 登录表单。
   * @returns 是否登录成功。
   */
  const login = useCallback(async (input: LoginInput): Promise<boolean> => {
    setLoading(true);
    setError('');

    try {
      const res = await authApi.login(input.email, input.password);
      const nextUser = (res?.data?.user || null) as BackendUser | null;
      if (!nextUser) {
        throw new Error('响应缺少 user 字段');
      }
      setUser(nextUser);
      return true;
    } catch (err: any) {
      const reason = String(err?.message || '未知错误');
      setError(buildAuthError('登录提交', `邮箱[${input.email}]`, reason, '请检查邮箱密码是否正确，或先完成注册。'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 执行邮箱密码注册。
   * Why: 注册后直接建立会话，减少一次额外登录步骤，降低流失。
   *
   * @param input 注册表单。
   * @returns 是否注册成功。
   */
  const register = useCallback(async (input: RegisterInput): Promise<boolean> => {
    setLoading(true);
    setError('');

    try {
      const res = await authApi.register(input.email, input.password, input.nickname);
      const nextUser = (res?.data?.user || null) as BackendUser | null;
      if (!nextUser) {
        throw new Error('响应缺少 user 字段');
      }
      setUser(nextUser);
      return true;
    } catch (err: any) {
      const reason = String(err?.message || '未知错误');
      setError(buildAuthError('注册提交', `邮箱[${input.email}]，昵称[${input.nickname || '未填写'}]`, reason, '请确认邮箱未被占用且密码长度满足要求。'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 执行登出。
   * Why: 无论后端接口是否成功，都必须清理本地会话，避免“伪登录”状态。
   *
   * @returns void
   */
  const logout = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      await authApi.logout();
    } catch {
      // 这里不抛出，确保前端始终回到已登出状态。
    } finally {
      setUser(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    /**
     * 处理 token 刷新失败后的全局登出事件。
     * Why: 请求拦截器触发了 auth:logout 时，页面应立即同步到已登出状态。
     *
     * @returns void
     */
    const handleLogout = (): void => {
      setUser(null);
      setError('会话已过期，请重新登录。');
    };

    window.addEventListener('auth:logout', handleLogout as EventListener);
    return () => window.removeEventListener('auth:logout', handleLogout as EventListener);
  }, []);

  return {
    user,
    isLoggedIn: !!user,
    loading,
    error,
    login,
    register,
    logout,
    refreshMe,
    clearError,
  };
}
