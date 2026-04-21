/**
 * AppHeader.tsx
 *
 * 单一职责：渲染顶部导航栏，包含 Logo、页面切换 Nav、工具按钮和数据管理下拉菜单。
 *
 * Why: 原 App.tsx 中 <header> 区域有约 220 行 JSX，与业务状态强耦合。
 *      提取为独立组件后，视觉调整无需触碰业务逻辑，且 Storybook/单元测试可独立挂载。
 */

import React from 'react';
import { AIProviderConfig } from '@/types';

// ===== 类型定义 =====

export type AppView = 'GENERATOR' | 'WRONG_BOOK' | 'NOTEBOOK' | 'QUESTION_BANK';

export interface AppHeaderProps {
  // 当前视图
  view: AppView;
  onViewChange: (view: AppView) => void;

  // 供应商（用于工具提示）
  providerConfig: AIProviderConfig;

  // 功能开关
  onOpenSettings: () => void;
  onOpenChat: () => void;

  // 数据菜单
  showDataMenu: boolean;
  onToggleDataMenu: () => void;
  dataMenuRef: React.RefObject<HTMLDivElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onExportData: () => void;
  onImportFromServer: () => void;
  onOpenBackupList: () => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// ===== 组件实现 =====

export const AppHeader: React.FC<AppHeaderProps> = ({
  view,
  onViewChange,
  providerConfig,
  onOpenSettings,
  onOpenChat,
  showDataMenu,
  onToggleDataMenu,
  dataMenuRef,
  fileInputRef,
  onExportData,
  onImportFromServer,
  onOpenBackupList,
  onImportFile,
}) => {
  return (
    <header className="bg-white/90 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-50 animate-fadeInDown">
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">

        {/* ===== Logo ===== */}
        <div
          className="flex items-center gap-4 group cursor-pointer"
          onClick={() => onViewChange('GENERATOR')}
          data-help="点击返回出题主页。"
        >
          <div className="w-12 h-12 bg-sky-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-sky-100 transition-all duration-500 group-hover:rotate-[360deg] group-hover:scale-110 animate-breathGlow">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900">AI 数学老师</h1>
            <p className="text-[10px] text-sky-500 font-black uppercase tracking-widest">Advanced Mathematics Tutor</p>
          </div>
        </div>

        {/* ===== 导航 + 工具按钮 ===== */}
        <nav className="flex items-center gap-2 bg-slate-100/50 p-1.5 rounded-[1.25rem] border border-slate-200/50 animate-slideUp" style={{ animationDelay: '0.1s' }}>

          {/* 出题 */}
          <button
            onClick={() => onViewChange('GENERATOR')}
            data-help="切换到出题页面，配置参数并生成新题目。"
            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all duration-300 flex items-center gap-2 btn-ripple ${view === 'GENERATOR' ? 'bg-white text-sky-600 shadow-xl ring-1 ring-slate-100 animate-selectBounce' : 'text-slate-500 hover:text-slate-800 hover:scale-105'}`}
          >
            <svg className={`w-3.5 h-3.5 ${view === 'GENERATOR' ? 'text-sky-500' : 'text-sky-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
            </svg>
            出题
          </button>

          {/* 题库 */}
          <button
            onClick={() => onViewChange('QUESTION_BANK')}
            data-help="打开题库，查看和管理已保存题目。"
            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all duration-300 flex items-center gap-2 btn-ripple ${view === 'QUESTION_BANK' ? 'bg-white text-indigo-600 shadow-xl ring-1 ring-slate-100 animate-selectBounce' : 'text-slate-500 hover:text-slate-800 hover:scale-105'}`}
          >
            <svg className={`w-3.5 h-3.5 ${view === 'QUESTION_BANK' ? 'text-indigo-500' : 'text-indigo-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            题库
          </button>

          {/* 错题 */}
          <button
            onClick={() => onViewChange('WRONG_BOOK')}
            data-help="打开错题本，复盘历史错题与解析。"
            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all duration-300 flex items-center gap-2 btn-ripple ${view === 'WRONG_BOOK' ? 'bg-white text-rose-600 shadow-xl ring-1 ring-slate-100 animate-selectBounce' : 'text-slate-500 hover:text-slate-800 hover:scale-105'}`}
          >
            <svg className={`w-3.5 h-3.5 ${view === 'WRONG_BOOK' ? 'text-rose-500' : 'text-rose-300'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
            </svg>
            错题
          </button>

          {/* 笔记 */}
          <button
            onClick={() => onViewChange('NOTEBOOK')}
            data-help="打开笔记页，整理学习记录与要点。"
            className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all duration-300 flex items-center gap-2 btn-ripple ${view === 'NOTEBOOK' ? 'bg-white text-emerald-600 shadow-xl ring-1 ring-slate-100 animate-selectBounce' : 'text-slate-500 hover:text-slate-800 hover:scale-105'}`}
          >
            <svg className={`w-4 h-4 ${view === 'NOTEBOOK' ? 'text-emerald-500' : 'text-emerald-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            笔记
          </button>

          {/* 对话 */}
          <button
            onClick={onOpenChat}
            data-help="打开 ai对话助手，可进行答疑、识图和总结笔记。"
            className="px-4 py-2.5 rounded-xl text-xs font-black transition-all duration-300 text-slate-500 hover:text-cyan-600 hover:bg-white flex items-center gap-1.5 hover:scale-105 active:scale-95"
            title="ai对话助手"
          >
            <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            对话
          </button>

          {/* 设置 */}
          <button
            onClick={onOpenSettings}
            data-help="打开模型与接口设置。注意：首次使用需先配置 API Key。"
            className="px-4 py-2.5 rounded-xl text-xs font-black transition-all duration-300 text-slate-500 hover:text-violet-600 hover:bg-white flex items-center gap-1.5 hover:scale-105 hover:[&_svg]:animate-[iconSpin_0.8s_ease-in-out] active:scale-95"
            title={`当前: ${providerConfig.name} / ${providerConfig.model}`}
          >
            <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </button>

          {/* 数据管理下拉菜单 */}
          <div className="relative" ref={dataMenuRef}>
            <button
              onClick={onToggleDataMenu}
              data-help="打开数据管理菜单，可导出或导入备份。"
              className="px-4 py-2.5 rounded-xl text-xs font-black transition-all duration-300 text-slate-500 hover:text-amber-600 hover:bg-white flex items-center gap-1.5 hover:scale-105 active:scale-95"
              title="数据管理：导出 / 导入"
            >
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              数据
            </button>

            {showDataMenu && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 p-2 z-50 animate-popIn">
                {/* 导出 */}
                <button
                  onClick={onExportData}
                  data-help="导出全部数据。优先保存到 backup 文件夹，失败时自动下载。"
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold text-slate-700 hover:bg-sky-50 hover:text-sky-600 transition-all text-left"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <div>
                    <div>导出全部数据</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">优先保存到专用文件夹（含错题/笔记/配置）</div>
                  </div>
                </button>

                {/* 从服务器恢复最新 */}
                <button
                  onClick={onImportFromServer}
                  data-help="从 backup 文件夹恢复最新备份。恢复后会刷新页面。"
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold text-slate-700 hover:bg-violet-50 hover:text-violet-600 transition-all text-left"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h5l2-2h4l2 2h5v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm9 4v6m0 0l-3-3m3 3l3-3" />
                  </svg>
                  <div>
                    <div>从数据文件夹恢复</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">自动导入最新 JSON 备份</div>
                  </div>
                </button>

                {/* 打开备份列表 */}
                <button
                  onClick={onOpenBackupList}
                  data-help="打开备份列表，按文件名选择需要恢复的数据。"
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-600 transition-all text-left"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <div>
                    <div>导入数据</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">自动打开 backup 备份列表</div>
                  </div>
                </button>

                {/* 隐藏文件上传 input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={onImportFile}
                />
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
};
