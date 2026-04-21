import React from 'react';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 本地模式提示面板。
 * Why: 项目已切换本地 AI 模式，不再提供云端管理员能力。
 */
export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-black text-slate-800">本地模式说明</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors"
            aria-label="关闭本地模式说明"
          >
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-700 leading-relaxed font-semibold">
          当前版本为本地 AI 应用，不提供云端管理员控制台、账号管理和配额管理功能。
          <br />
          如需使用模型，请在设置中配置本地直连或本地网关。
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full py-3 rounded-xl bg-sky-600 text-white text-sm font-black hover:bg-sky-700 transition-colors"
        >
          我知道了
        </button>
      </div>
    </div>
  );
};
