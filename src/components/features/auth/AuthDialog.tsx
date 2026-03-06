import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type AuthMode = 'login' | 'register';

interface AuthDialogProps {
  isOpen: boolean;
  mode: AuthMode;
  loading: boolean;
  error: string;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
  onLogin: (input: { email: string; password: string }) => Promise<boolean>;
  onRegister: (input: { email: string; password: string; nickname?: string }) => Promise<boolean>;
  onClearError: () => void;
}

/**
 * 认证弹窗（登录/注册）。
 * Why: 将认证交互独立成组件，避免把表单逻辑散落在多个页面里，后续扩展 OAuth 更简单。
 */
export const AuthDialog: React.FC<AuthDialogProps> = ({
  isOpen,
  mode,
  loading,
  error,
  onClose,
  onModeChange,
  onLogin,
  onRegister,
  onClearError,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    onClearError();
    setPassword('');
  }, [isOpen, mode, onClearError]);

  /**
   * 验证提交前表单。
   * Why: 本地先拦截明显无效输入，减少无意义请求。
   *
   * @returns 校验失败时返回错误消息，成功返回空字符串。
   */
  const validate = (): string => {
    if (!email.trim()) return '步骤[校验表单]失败，邮箱[空]，原因[缺少必填字段]。Hint: 请输入邮箱地址。';
    if (!password) return '步骤[校验表单]失败，密码[空]，原因[缺少必填字段]。Hint: 请输入密码。';
    if (password.length < 8) return `步骤[校验表单]失败，密码长度[${password.length}]，原因[长度不足]。Hint: 请使用至少 8 位密码。`;
    return '';
  };

  /**
   * 提交认证表单。
   * Why: 统一提交逻辑，保证登录和注册流程行为一致。
   *
   * @returns void
   */
  const handleSubmit = async (): Promise<void> => {
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    // 1) 根据模式调用对应接口。
    // 2) 成功后关闭弹窗。
    // 3) 失败由上层错误状态统一展示。
    const success = mode === 'login'
      ? await onLogin({ email: email.trim(), password })
      : await onRegister({ email: email.trim(), password, nickname: nickname.trim() || undefined });

    if (success) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md mx-4 rounded-[2rem] bg-white border border-slate-200 shadow-2xl p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-black text-slate-900">{mode === 'login' ? '账号登录' : '创建账号'}</h3>
            <p className="text-xs text-slate-400 font-semibold mt-1">
              {mode === 'login' ? '登录后可使用后台模型与云端配额' : '注册后自动登录，可直接开始使用'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600"
            aria-label="关闭认证弹窗"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-2">邮箱</label>
            <input
              type="email"
              className="w-full rounded-xl border-2 border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-[11px] font-black text-slate-500 mb-2">昵称（可选）</label>
              <input
                type="text"
                className="w-full rounded-xl border-2 border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400"
                placeholder="例如：小明"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-2">密码</label>
            <input
              type="password"
              className="w-full rounded-xl border-2 border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400"
              placeholder="至少 8 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        {!!error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className={`mt-6 w-full rounded-xl py-3 text-sm font-black transition-all ${loading
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-sky-600 hover:bg-sky-700 text-white'
            }`}
        >
          {loading ? '提交中...' : mode === 'login' ? '登录' : '注册并登录'}
        </button>

        <button
          onClick={() => onModeChange(mode === 'login' ? 'register' : 'login')}
          disabled={loading}
          className="mt-3 w-full text-xs font-bold text-slate-500 hover:text-sky-600"
        >
          {mode === 'login' ? '还没有账号？去注册' : '已有账号？去登录'}
        </button>
      </div>
    </div>
  );
};
