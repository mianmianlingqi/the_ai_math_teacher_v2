/**
 * ConfirmDialog.tsx
 *
 * 单一职责：监听 confirm:show CustomEvent，渲染原生 confirm() 的替代 UI，
 * 并通过 resolveConfirm() 将用户选择回传给调用方 Promise。
 *
 * 挂载方式：在 App.tsx 顶层渲染 <ConfirmDialog /> 一次即可全局生效。
 *
 * Why: 使用 React Portal（createPortal）挂载到 document.body，
 *      确保 z-index 不受父组件 stacking context 影响。
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveConfirm } from '@/services/api/confirmService';

export function ConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const handler = (e: Event) => {
      setMessage((e as CustomEvent<{ message: string }>).detail.message);
      setOpen(true);
    };
    window.addEventListener('confirm:show', handler);
    return () => window.removeEventListener('confirm:show', handler);
  }, []);

  const handleConfirm = () => {
    setOpen(false);
    resolveConfirm(true);
  };

  const handleCancel = () => {
    setOpen(false);
    resolveConfirm(false);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fadeIn"
      onClick={handleCancel}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4 animate-popIn"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-slate-800 text-base font-medium whitespace-pre-line leading-relaxed mb-8">
          {message}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all active:scale-95"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-5 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 transition-all active:scale-95"
          >
            确认
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
