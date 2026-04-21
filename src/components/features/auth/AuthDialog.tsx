import React from 'react';

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
  error,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-md mx-4 rounded-[2rem] bg-white border border-slate-200 shadow-2xl p-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-black text-slate-900">本地模式提示</h3>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600"
            aria-label="关闭提示弹窗"
          >
            ✕
          </button>
        </div>

        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 font-semibold leading-relaxed">
          当前版本默认使用本地 AI 模式：
          <br />
          1. 无需登录或注册账号。
          <br />
          2. 不使用云端配额体系。
          <br />
          3. 模型请在“设置”中配置本地直连或本地网关。
        </div>

        {!!error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
            {error}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl py-3 text-sm font-black bg-sky-600 hover:bg-sky-700 text-white"
        >
          我知道了
        </button>
      </div>
    </div>
  );
};
