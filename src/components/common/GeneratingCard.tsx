import React from 'react';
import { SuitDecorations } from '@/components/common/SuitDecorations';

/**
 * 生成中动画卡片 - 骨架屏设计
 * 在 AI 逐题生成过程中，展示"正在思考"的视觉反馈
 */
export const GeneratingCard: React.FC = () => {
  return (
    <div className="relative overflow-hidden bg-white rounded-[2.5rem] border border-indigo-100 p-10 shadow-lg shadow-indigo-50/50 animate-fadeIn hover-float-3d">
      <SuitDecorations variant="full" />
      {/* 顶部流光动画条 */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-400 via-sky-400 to-violet-400 bg-[length:200%_100%] animate-shimmer rounded-t-[2.5rem]" />

      {/* 背景装饰粒子 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-10 right-10 w-24 h-24 bg-indigo-100/30 rounded-full animate-float" style={{animationDelay: '0s', animationDuration: '4s'}} />
        <div className="absolute bottom-8 left-8 w-16 h-16 bg-sky-100/30 rounded-full animate-float" style={{animationDelay: '1s', animationDuration: '3.5s'}} />
        <div className="absolute top-1/2 right-1/4 w-8 h-8 bg-violet-100/30 rounded-full animate-float" style={{animationDelay: '2s', animationDuration: '5s'}} />
      </div>

      <div className="flex items-start gap-6 relative z-10">
        {/* AI 核心图标（旋转 + 呼吸效果） */}
        <div className="flex-shrink-0 w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center animate-breathe">
          <svg
            className="w-8 h-8 text-indigo-500 animate-iconSpin"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>

        <div className="flex-1 space-y-5">
          {/* 标题行 */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-black text-indigo-600 animate-fadeIn">AI 正在构思下一道题目</span>
            {/* 反弹跳动点 */}
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>

          {/* 骨架屏行 - 模拟题目内容（闪光效果） */}
          <div className="space-y-3">
            <div className="h-4 skeleton-shine rounded-full w-full" />
            <div className="h-4 skeleton-shine rounded-full w-5/6" style={{ animationDelay: '0.2s' }} />
            <div className="h-4 skeleton-shine rounded-full w-4/6" style={{ animationDelay: '0.4s' }} />
          </div>

          {/* 骨架屏 - 模拟选项/答案区域 */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="h-10 bg-indigo-50/60 rounded-2xl skeleton-shine" style={{ animationDelay: '0.1s' }} />
            <div className="h-10 bg-indigo-50/60 rounded-2xl skeleton-shine" style={{ animationDelay: '0.2s' }} />
            <div className="h-10 bg-indigo-50/60 rounded-2xl skeleton-shine" style={{ animationDelay: '0.3s' }} />
            <div className="h-10 bg-indigo-50/60 rounded-2xl skeleton-shine" style={{ animationDelay: '0.4s' }} />
          </div>

          {/* 底部提示 + 进度指示 */}
          <div className="flex items-center gap-3 pt-1">
            <div className="flex-1">
              <p className="text-[11px] text-slate-400 font-bold">
                正在推导题目并验证答案的正确性，请稍候...
              </p>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-indigo-300 animate-statusPulse" style={{animationDelay:'0s'}} />
              <span className="w-1 h-1 rounded-full bg-indigo-300 animate-statusPulse" style={{animationDelay:'0.3s'}} />
              <span className="w-1 h-1 rounded-full bg-indigo-300 animate-statusPulse" style={{animationDelay:'0.6s'}} />
            </div>
          </div>
        </div>
      </div>

      {/* 底部流光 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-200 to-transparent animate-shimmer bg-[length:200%_100%]" />
    </div>
  );
};
