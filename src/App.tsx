/**
 * App.tsx
 *
 * 顶层路由容器，负责：
 * 1. 组合所有自定义 Hook 并维护全局 UI 状态（弹窗开关、当前视图）
 * 2. 渲染 AppHeader、左侧配置侧边栏、右侧内容区和所有浮层面板
 *
 * Why: 原文件 1125 行，承担了供应商配置管理、出题生成逻辑、备份 API 调用、Header JSX 等
 *      6+ 个职责。重构后各职责由以下模块承担：
 *      - hooks/useProviderConfig.ts  AI 供应商配置状态
 *      - hooks/useGenerateProblems.ts  出题生成逻辑
 *      - services/backupService.ts  备份/恢复 API 调用
 *      - components/layout/AppHeader.tsx  顶部导航 JSX
 *      本文件只做「胶水层」：组合以上模块，处理剩余的纯 UI 协调逻辑。
 */

import React, { useState, useEffect, useRef } from 'react';
import { AutoSaveSettings, Syllabus, Difficulty, QuestionType, MathProblem, GenerateConfig } from '@/types';
import { DEFAULT_AUTO_SAVE_SETTINGS, SYLLABUS_OPTIONS, DIFFICULTY_OPTIONS, QUESTION_TYPE_OPTIONS, SYLLABUS_CHAPTERS, CHAPTER_TOPICS, DEFAULT_CONFIG, MAX_GENERATE_COUNT, normalizeAutoSaveSettings } from '@/constants';
import { storageService } from '@/services/storage';
import { autoBackupData, exportData, importFromServer, restoreByFilename } from '@/services/api/backupApi';
import { autoSaveApi, startAutoSaveTimer } from '@/services/api/autoSaveApi';
import { ProblemCard } from '@/components/features/problem/ProblemCard';
import { WrongProblemBook } from '@/components/features/storage/WrongProblemBook';
import { SettingsPanel } from '@/components/features/settings/SettingsPanel';
import { ChatPanel } from '@/components/features/chat/ChatPanel';
import { Notebook } from '@/components/features/storage/Notebook';
import { QuestionBank } from '@/components/features/storage/QuestionBank';
import { PaperWorkspace } from '@/components/features/paper/PaperWorkspace';
import { ReferenceSelector, SelectedReferences, EMPTY_REFERENCES } from '@/components/features/problem/ReferenceSelector';
import { GeneratingCard } from '@/components/common/GeneratingCard';
import { SuitDecorations } from '@/components/common/SuitDecorations';
import { BackupManager } from '@/components/features/storage/BackupManager';
import { HoverHelpOverlay } from '@/components/features/dev/HoverHelpOverlay';
import { AdminConsole } from '@/components/features/dev/AdminConsole';
import { AppHeader, AppView } from '@/components/layout/AppHeader';
import { useProviderConfig } from '@/hooks/useProviderConfig';
import { useGenerateProblems, CUSTOM_CHAPTER_KEY } from '@/hooks/useGenerateProblems';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { STORAGE_DATA_CHANGED_EVENT } from '@/services/storage/core';
import toast, { Toaster } from 'react-hot-toast';

// ===== 工具函数 =====

/**
 * 将当前题目列表导出为 Markdown 文件并触发浏览器下载。
 * @param problems - 需要导出的题目列表
 */
function exportProblemsToMarkdown(problems: MathProblem[]): void {
  const now = new Date();
  const timeStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

  const lines: string[] = [
    `# AI 数学老师  题目导出`,
    ``,
    `> 导出时间：${now.toLocaleString('zh-CN')}  `,
    `> 共 ${problems.length} 题`,
    ``,
  ];

  problems.forEach((p, idx) => {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 第 ${idx + 1} 题（${p.questionType}  ${p.difficulty}）`);
    lines.push(``);
    lines.push(p.question);
    lines.push(``);

    if (p.options && p.options.length > 0) {
      const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
      p.options.forEach((opt, i) => {
        lines.push(`${labels[i] ?? String(i + 1)}. ${opt}`);
      });
      lines.push(``);
    }

    lines.push(`<details>`);
    lines.push(`<summary> 查看答案与解析</summary>`);
    lines.push(``);
    lines.push(`**答案：** ${p.answer}`);
    lines.push(``);
    lines.push(`**解析：**`);
    lines.push(``);
    lines.push(p.explanation);
    lines.push(``);
    lines.push(`</details>`);
    lines.push(``);
  });

  lines.push(`---`);
  lines.push(``);
  lines.push(`*由 [AI 数学老师](https://github.com) 生成*`);

  const markdown = lines.join('\n');
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `math_problems_${timeStr}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

const App: React.FC = () => {
  const savedUiSettings = storageService.getAppUiSettings();

  //  视图路由 
  const [view, setView] = useState<AppView>('GENERATOR');

  //  出题配置 
  const [config, setConfig] = useState<GenerateConfig>(() => ({ ...DEFAULT_CONFIG, ...(savedUiSettings.generatorConfig || {}) }));
  const [customChapter, setCustomChapter] = useState(() => savedUiSettings.customChapter || '');
  const [selectedKnowledgePoint, setSelectedKnowledgePoint] = useState(() => savedUiSettings.selectedKnowledgePoint || '');
  const [selectedRefs, setSelectedRefs] = useState<SelectedReferences>(() => savedUiSettings.selectedRefs || EMPTY_REFERENCES);
  const [parallelMode, setParallelMode] = useState(() => savedUiSettings.parallelMode ?? false);
  const [autoSaveSettings, setAutoSaveSettings] = useState<AutoSaveSettings>(() => normalizeAutoSaveSettings(savedUiSettings.autoSaveSettings || DEFAULT_AUTO_SAVE_SETTINGS));

  // 浮层开关：同时只能激活一个面板，null 表示所有面板关闭
  type ModalType = 'settings' | 'backup' | 'chat' | 'dataMenu' | null;
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  /**
   * 每次数据导入后递增，驱动子组件重挂载而非强制刷新页面。
   * Why: WrongProblemBook/Notebook/QuestionBank 均在 mount useEffect 中读取 storage，
   *      给它们传入新的 key 可让 React 重新初始化而不刷新页面。
   */
  const [resetKey, setResetKey] = useState(0);

  //  DOM 引用 
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  //  自定义 Hooks 
  const {
    providerConfig, dualModelConfig, chatConfig, visionConfig,
    backendProviders, quickModelValue,
    handleQuickModelChange, handleProviderSave, aiServiceRef,
  } = useProviderConfig();

  const { problems, setProblems, loading, progress, handleGenerate } = useGenerateProblems({
    config, customChapter, selectedKnowledgePoint, selectedRefs, aiServiceRef, parallelMode,
    resetKey,
  });

  const generationProgressPercent = progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0;

  //  副作用 

  useEffect(() => {
    storageService.saveAppUiSettings({
      generatorConfig: config,
      customChapter,
      selectedKnowledgePoint,
      selectedRefs,
      parallelMode,
      autoSaveSettings,
    });
  }, [config, customChapter, selectedKnowledgePoint, selectedRefs, parallelMode, autoSaveSettings]);

  // 监听 data:imported 事件，递增 resetKey 让子组件重挂载
  useEffect(() => {
    const handleDataImported = () => {
      const importedUiSettings = storageService.getAppUiSettings();
      if (importedUiSettings.generatorConfig) {
        setConfig({ ...DEFAULT_CONFIG, ...importedUiSettings.generatorConfig });
      }
      setCustomChapter(importedUiSettings.customChapter || '');
      setSelectedKnowledgePoint(importedUiSettings.selectedKnowledgePoint || '');
      setSelectedRefs(importedUiSettings.selectedRefs || EMPTY_REFERENCES);
      setParallelMode(importedUiSettings.parallelMode ?? false);
      setAutoSaveSettings(normalizeAutoSaveSettings(importedUiSettings.autoSaveSettings || DEFAULT_AUTO_SAVE_SETTINGS));
      setResetKey(k => k + 1);
    };
    window.addEventListener('data:imported', handleDataImported);
    return () => window.removeEventListener('data:imported', handleDataImported);
  }, []);

  useEffect(() => {
    let backupTimer: number | null = null;

    const scheduleAutoBackup = () => {
      if (backupTimer !== null) {
        window.clearTimeout(backupTimer);
      }
      // 防抖合并连续写入，避免同一次操作生成过多自动备份请求。
      backupTimer = window.setTimeout(() => {
        void autoBackupData({ reason: '内容变更' });
      }, 1200);
    };

    void autoBackupData({ reason: '应用启动' });
    window.addEventListener(STORAGE_DATA_CHANGED_EVENT, scheduleAutoBackup);

    return () => {
      if (backupTimer !== null) {
        window.clearTimeout(backupTimer);
      }
      window.removeEventListener(STORAGE_DATA_CHANGED_EVENT, scheduleAutoBackup);
    };
  }, []);

  useEffect(() => {
    const timer = startAutoSaveTimer({
      getSettings: () => autoSaveSettings,
      onError: (error) => {
        console.error('[App] 自动保存失败', error);
      },
      onSuccess: (entry) => {
        console.info(`[App] 自动保存成功：${entry.name}`);
      },
      notifyOnError: false,
    });

    timer.refresh();
    return () => timer.stop();
  }, [autoSaveSettings]);

  // 大纲切换时：重置为第一个合法章节，清空知识点选择
  useEffect(() => {
    const chapters = SYLLABUS_CHAPTERS[config.syllabus];
    if (chapters && !chapters.includes(config.chapter) && config.chapter !== CUSTOM_CHAPTER_KEY) {
      setConfig(prev => ({ ...prev, chapter: chapters[0] }));
      setCustomChapter('');
    }
    setSelectedKnowledgePoint('');
  }, [config.syllabus]);

  // 点击数据菜单外部时自动关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dataMenuRef.current && !dataMenuRef.current.contains(e.target as Node)) {
        setActiveModal(null);
      }
    };
    if (activeModal === 'dataMenu') document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeModal]);

  //  事件处理 
  /** 从本地文件导入数据（文件选择框回调） */
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = storageService.importData(text);
      if (result.success) {
        window.dispatchEvent(new CustomEvent('data:imported'));
        setActiveModal(null);
        toast.success('数据导入成功！');
      } else {
        toast.error(`导入失败：${result.message}\n请确认所选文件是合法的 AI 数学老师备份 JSON。`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
    setActiveModal(null);
  };

  const handleCreatePaperFromGeneratedProblems = () => {
    if (problems.length === 0) {
      toast.error('当前还没有生成题目，无法创建试卷。');
      return;
    }

    const syllabusLabel = config.syllabus || problems[0]?.syllabus || Syllabus.UNDERGRADUATE_TRANSITION;
    const paperTitle = `${syllabusLabel}练习试卷`;
    storageService.replaceActiveExamPaperWithProblems(problems, {
      title: paperTitle,
      syllabus: problems[0]?.syllabus || config.syllabus,
    });
    toast.success(`已将当前 ${problems.length} 道题创建为试卷，并同步到试卷工作台。`);
    setView('PAPER');
  };

  const isGeneratorView = view === 'GENERATOR';

  const handleAutoSaveSettingsChange = (settings: AutoSaveSettings) => {
    const normalized = autoSaveApi.saveSettings(settings);
    setAutoSaveSettings(normalized);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f0f9ff] text-slate-900 selection:bg-sky-100 selection:text-sky-900">

      {/* ===== 顶部导航 ===== */}
      <AppHeader
        view={view}
        onViewChange={setView}
        providerConfig={providerConfig}
        onOpenSettings={() => setActiveModal('settings')}
        onOpenChat={() => setActiveModal('chat')}
        showDataMenu={activeModal === 'dataMenu'}
        onToggleDataMenu={() => setActiveModal(v => v === 'dataMenu' ? null : 'dataMenu')}
        dataMenuRef={dataMenuRef}
        fileInputRef={fileInputRef}
        onExportData={() => exportData(() => setActiveModal(null))}
        onImportFromServer={() => importFromServer(
          () => setActiveModal(null),
          () => fileInputRef.current?.click()
        )}
        onOpenBackupList={() => setActiveModal('backup')}
        onImportFile={handleImportFile}
      />

      {/* ===== 主内容区 ===== */}
      <main className="flex-1 max-w-7xl mx-auto px-6 py-12 w-full grid grid-cols-1 lg:grid-cols-12 gap-12">

        {/*  左侧配置侧边栏（仅出题视图可见）  */}
        {isGeneratorView && (
          <aside className="lg:col-span-3 relative animate-slideInLeft">
            <div className="lg:sticky lg:top-28 flex flex-col gap-8">

              <div className="bg-white rounded-[3rem] border border-slate-200 p-8 shadow-2xl shadow-slate-200/50 hover-float-3d relative overflow-hidden" data-help="在这里设置出题参数：考纲、难度、题型、章节和数量。">
                <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
                  <span className="absolute top-4 left-4 text-2xl suit-float-2" style={{color:'#6366f1', opacity:0.18}}></span>
                  <span className="absolute top-[12%] left-8 text-lg suit-float-4" style={{color:'#10b981', opacity:0.16}}>π</span>
                  <span className="absolute top-[22%] left-3 text-xl suit-float-1" style={{color:'#ef4444', opacity:0.18}}></span>
                  <span className="absolute top-[32%] left-10 text-sm suit-float-3" style={{color:'#f97316', opacity:0.16}}></span>
                  <span className="absolute top-[42%] left-5 text-2xl suit-float-2" style={{color:'#6366f1', opacity:0.15}}></span>
                  <span className="absolute top-[52%] left-8 text-lg suit-float-4" style={{color:'#ef4444', opacity:0.16}}></span>
                  <span className="absolute top-[62%] left-3 text-xl suit-float-1" style={{color:'#10b981', opacity:0.17}}>π</span>
                  <span className="absolute top-[72%] left-10 text-sm suit-float-3" style={{color:'#f97316', opacity:0.15}}></span>
                  <span className="absolute top-[82%] left-5 text-lg suit-float-2" style={{color:'#6366f1', opacity:0.14}}></span>
                  <span className="absolute top-[92%] left-8 text-xl suit-float-4" style={{color:'#ef4444', opacity:0.13}}></span>
                  <span className="absolute top-6 right-6 text-3xl suit-float-1" style={{color:'#ef4444', opacity:0.2}}></span>
                  <span className="absolute top-[14%] right-10 text-lg suit-float-3" style={{color:'#f97316', opacity:0.18}}></span>
                  <span className="absolute top-[24%] right-5 text-xl suit-float-2" style={{color:'#10b981', opacity:0.17}}>π</span>
                  <span className="absolute top-[34%] right-12 text-2xl suit-float-4" style={{color:'#6366f1', opacity:0.18}}></span>
                  <span className="absolute top-[44%] right-6 text-sm suit-float-1" style={{color:'#ef4444', opacity:0.16}}></span>
                  <span className="absolute top-[54%] right-10 text-xl suit-float-3" style={{color:'#f97316', opacity:0.15}}></span>
                  <span className="absolute top-[64%] right-4 text-lg suit-float-2" style={{color:'#10b981', opacity:0.16}}>π</span>
                  <span className="absolute top-[74%] right-14 text-2xl suit-float-4" style={{color:'#6366f1', opacity:0.15}}></span>
                  <span className="absolute top-[84%] right-6 text-xl suit-float-1" style={{color:'#f97316', opacity:0.14}}></span>
                  <span className="absolute top-[94%] right-10 text-sm suit-float-3" style={{color:'#ef4444', opacity:0.13}}></span>
                  <span className="absolute top-[8%] left-1/3 text-sm suit-float-3" style={{color:'#10b981', opacity:0.13}}>π</span>
                  <span className="absolute top-[28%] right-1/3 text-lg suit-float-1" style={{color:'#f97316', opacity:0.15}}></span>
                  <span className="absolute top-[48%] left-1/2 text-xl suit-float-4" style={{color:'#6366f1', opacity:0.13}}></span>
                  <span className="absolute top-[68%] right-1/4 text-sm suit-float-2" style={{color:'#ef4444', opacity:0.14}}></span>
                  <span className="absolute top-[88%] left-1/4 text-lg suit-float-1" style={{color:'#10b981', opacity:0.13}}>π</span>
                </div>

                <h2 className="text-lg font-black text-slate-800 mb-8 flex items-center gap-4 relative z-[1]">
                  <div className="w-10 h-10 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center transition-transform duration-300 hover:rotate-12 hover:scale-110">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  </div>
                  出题参数配置
                </h2>

                <div className="space-y-6 relative z-[1]">
                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">考纲类型</label>
                    <select className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-[1.25rem] px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-500 focus:bg-white transition-all duration-300 appearance-none cursor-pointer hover:border-slate-200 focus-ring-smooth" value={config.syllabus} onChange={(e) => setConfig({ ...config, syllabus: e.target.value as Syllabus })}>
                      {SYLLABUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">难度</label>
                      <select className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-[1.25rem] px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-500 focus:bg-white transition-all appearance-none cursor-pointer" value={config.difficulty} onChange={(e) => setConfig({ ...config, difficulty: e.target.value as Difficulty })}>
                        {DIFFICULTY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-3">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">题型</label>
                      <select className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-[1.25rem] px-5 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-500 focus:bg-white transition-all appearance-none cursor-pointer" value={config.questionType} onChange={(e) => setConfig({ ...config, questionType: e.target.value as QuestionType })}>
                        {QUESTION_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">章节范围</label>
                    <select className={`w-full bg-slate-50/50 border-2 border-slate-100 rounded-[1.25rem] px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-500 focus:bg-white transition-all appearance-none cursor-pointer ${config.chapter === CUSTOM_CHAPTER_KEY ? 'mb-2' : ''}`} value={config.chapter} onChange={(e) => { setConfig({ ...config, chapter: e.target.value }); setSelectedKnowledgePoint(''); }}>
                      {SYLLABUS_CHAPTERS[config.syllabus].map(chapter => <option key={chapter} value={chapter}>{chapter}</option>)}
                      <option value={CUSTOM_CHAPTER_KEY}>自定义具体考点</option>
                    </select>
                    {config.chapter === CUSTOM_CHAPTER_KEY && (
                      <input type="text" className="w-full bg-white border-2 border-sky-200 rounded-[1.25rem] px-6 py-4 text-sm font-bold text-slate-700 focus:ring-4 focus:ring-sky-50 outline-none placeholder:text-slate-300 animate-fadeIn" placeholder="输入具体的章节或知识点..." value={customChapter} onChange={(e) => setCustomChapter(e.target.value)} autoFocus />
                    )}
                  </div>

                  {config.chapter !== CUSTOM_CHAPTER_KEY && CHAPTER_TOPICS[config.chapter] && (
                    <div className="space-y-3 animate-fadeIn">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">知识点细分 <span className="text-slate-300">（可选）</span></label>
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => setSelectedKnowledgePoint('')} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border ${!selectedKnowledgePoint ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-slate-50/50 border-slate-100 text-slate-500 hover:border-slate-200 hover:bg-white'}`}>全部</button>
                        {CHAPTER_TOPICS[config.chapter].map(topic => (
                          <button key={topic} onClick={() => setSelectedKnowledgePoint(prev => prev === topic ? '' : topic)} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border ${selectedKnowledgePoint === topic ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-slate-50/50 border-slate-100 text-slate-500 hover:border-slate-200 hover:bg-white'}`}>{topic}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">单次生成数量 (1-{MAX_GENERATE_COUNT})</label>
                    <div className="relative">
                      <input type="number" min="1" max={MAX_GENERATE_COUNT} className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-[1.25rem] px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-500 focus:bg-white transition-all" value={config.count} onChange={(e) => setConfig({ ...config, count: Math.min(MAX_GENERATE_COUNT, Math.max(1, parseInt(e.target.value) || 1)) })} />
                      <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none">
                        <span className="text-[10px] font-black text-slate-300 uppercase">题 / 次</span>
                      </div>
                    </div>
                    {config.count > 1 && (
                      <div className="flex items-center justify-between bg-slate-50/50 rounded-2xl px-4 py-3 border border-slate-100 animate-fadeIn">
                        <div className="flex items-center gap-2">
                          <svg className={`w-3.5 h-3.5 ${parallelMode ? 'text-sky-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          <span className="text-[11px] font-bold text-slate-600">并行生成</span>
                          <span className="text-[10px] text-slate-400">{parallelMode ? '更快速' : '更多样'}</span>
                        </div>
                        <button onClick={() => setParallelMode(!parallelMode)} className={`relative rounded-full transition-colors duration-300 ${parallelMode ? 'bg-sky-500' : 'bg-slate-300'}`} style={{ width: '40px', height: '22px' }}>
                          <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform duration-300 ${parallelMode ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">详细描述 / 备注</label>
                    <textarea className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-[1.25rem] px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-500 focus:bg-white transition-all h-24 resize-none placeholder:text-slate-300" placeholder="例如：侧重参数方程求导、或二阶微分中值定理相关..." value={config.topic} onChange={(e) => setConfig({ ...config, topic: e.target.value })} />
                  </div>

                  <ReferenceSelector selected={selectedRefs} onChange={setSelectedRefs} />

                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">AI 模型</label>
                    <select value={quickModelValue} onChange={e => handleQuickModelChange(e.target.value, () => setActiveModal('settings'))} className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-[1.25rem] px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-500 focus:bg-white transition-all duration-300 appearance-none cursor-pointer hover:border-slate-200">
                      {backendProviders.length > 0 && (
                        <optgroup label=" 本地网关配置（可选）">
                          {backendProviders.flatMap(p => p.models.map(m => (
                            <option key={`${p.id}:${m}`} value={`${p.id}:${m}`}>{p.name}  {m}</option>
                          )))}
                        </optgroup>
                      )}
                      <optgroup label=" 自定义 API Key ">
                        <option value="__custom__">
                          {providerConfig.backendProvider ? '切换为本地直连 Key  打开设置' : `当前：${providerConfig.name}  ${providerConfig.model}`}
                        </option>
                      </optgroup>
                    </select>
                    <p className="text-[10px] text-slate-400 ml-2">
                      {providerConfig.backendProvider ? ' 使用本地网关转发  可不填写 API Key' : providerConfig.apiKey ? ` 使用本地直连 Key  ${providerConfig.name}` : ' 未配置 API Key，请先选择模型或打开设置'}
                    </p>
                  </div>

                  <button onClick={handleGenerate} disabled={loading} data-help="开始生成题目。生成期间请勿重复点击。" className={`w-full h-16 rounded-[1.5rem] font-black text-base flex items-center justify-center gap-3 transition-all btn-ripple ${loading ? 'bg-slate-100 text-slate-400 animate-borderGlow' : 'bg-sky-600 text-white hover:bg-sky-700 shadow-2xl shadow-sky-100 hover:-translate-y-1 hover:shadow-sky-200/60 active:translate-y-0 active:scale-95'}`}>
                    {loading ? (
                      <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>AI 正在构思...</>
                    ) : (
                      <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>立即生成题目</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/*  右侧主内容区  */}
        <div className={`${isGeneratorView ? 'lg:col-span-9' : 'lg:col-span-12'} animate-slideInRight`}>
          {view === 'WRONG_BOOK' ? (
            <div className="animate-viewSwitch" key={`wrong-${resetKey}`}><WrongProblemBook /></div>
          ) : view === 'NOTEBOOK' ? (
            <div className="animate-viewSwitch" key={`notebook-${resetKey}`}><Notebook /></div>
          ) : view === 'QUESTION_BANK' ? (
            <div className="animate-viewSwitch" key={`qbank-${resetKey}`}><QuestionBank /></div>
          ) : view === 'PAPER' ? (
            <PaperWorkspace currentProblems={problems} onGenerateProblems={() => setView('GENERATOR')} />
          ) : (problems.length > 0 || loading) ? (
            <div className="min-h-[650px] space-y-10 animate-fadeIn">
              <div className="flex items-center justify-between bg-white px-10 py-8 rounded-[3rem] border border-slate-200 shadow-sm animate-slideUp hover-float-3d relative overflow-hidden" style={{ animationDelay: '0.05s' }}>
                <SuitDecorations variant="corner" />
                <div className="flex items-center gap-5 relative z-[1]">
                  <div className="w-2.5 h-10 bg-sky-600 rounded-full animate-breathe"></div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">为您定制的练习</h3>
                  {loading && <span className="text-xs font-bold text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full animate-pulse flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-statusPulse"></span>生成中...</span>}
                </div>
                <div className="flex items-center gap-2">
                  {!loading && problems.length > 0 && (
                    <button onClick={handleCreatePaperFromGeneratedProblems} className="text-xs font-black text-orange-500 hover:text-orange-700 px-6 py-3 rounded-2xl hover:bg-orange-50 transition-all flex items-center gap-2 border border-transparent hover:border-orange-100 hover:scale-105 active:scale-95" title="将当前生成的题目全部放入试卷工作台">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" /></svg>
                      创建试卷
                    </button>
                  )}
                  {!loading && problems.length > 0 && (
                    <button onClick={() => exportProblemsToMarkdown(problems)} className="text-xs font-black text-sky-500 hover:text-sky-700 px-6 py-3 rounded-2xl hover:bg-sky-50 transition-all flex items-center gap-2 border border-transparent hover:border-sky-100 hover:scale-105 active:scale-95" title="导出为 Markdown 文件">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      导出 MD
                    </button>
                  )}
                  <button onClick={() => { setProblems([]); storageService.clearLastProblems(); }} className="text-xs font-black text-slate-400 hover:text-rose-600 px-6 py-3 rounded-2xl hover:bg-rose-50 transition-all flex items-center gap-2 border border-transparent hover:border-rose-100 hover:scale-105 active:scale-95">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    清空当前页
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-10">
                {loading && progress.total > 0 && (
                  <div className="bg-white rounded-[2.5rem] border border-sky-100 px-8 py-6 shadow-sm animate-slideUp">
                    <div className="flex items-center justify-between gap-4 mb-4">
                      <div>
                        <p className="text-xs font-black text-sky-500 uppercase tracking-[0.2em] mb-1">出题进度</p>
                        <h4 className="text-lg font-black text-slate-800">
                          已完成 {progress.completed} / {progress.total} 道
                        </h4>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-sky-600">{generationProgressPercent}%</p>
                        <p className="text-[11px] font-bold text-slate-400">成功 {progress.success} 道</p>
                      </div>
                    </div>
                    <div className="h-4 rounded-full bg-slate-100 overflow-hidden border border-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-indigo-500 transition-all duration-500"
                        style={{ width: `${generationProgressPercent}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-400">
                      <span>{parallelMode ? '当前模式：并行生成' : '当前模式：串行生成'}</span>
                      <span>{progress.total - progress.completed > 0 ? `剩余 ${progress.total - progress.completed} 道` : '正在收尾...'}</span>
                    </div>
                  </div>
                )}
                {problems.map((p, idx) => (
                  <div key={p.id || idx} className="animate-slideUp" style={{ animationDelay: `${idx * 0.08}s` }}>
                    <ProblemCard problem={p} index={idx} />
                  </div>
                ))}
                {loading && <div className="animate-popIn"><GeneratingCard /></div>}
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[650px] flex flex-col items-center justify-center bg-white rounded-[4rem] border-2 border-dashed border-slate-200 p-20 text-center group hover:border-sky-200 transition-all duration-700 relative overflow-hidden" data-help="这是出题结果展示区。生成后题目会显示在这里。">
              <SuitDecorations variant="full" />
              <div className="relative z-[1] flex flex-col items-center w-full">
                <div className="w-32 h-32 bg-sky-50 rounded-[3rem] flex items-center justify-center mb-10 text-sky-300 transition-all duration-700 group-hover:scale-110 group-hover:rotate-12 animate-float">
                  <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </div>
                <h3 className="text-4xl font-black text-slate-900 mb-6 tracking-tight animate-slideUp" style={{ animationDelay: '0.2s' }}>定制您的专属练习题库</h3>
                <p className="text-slate-400 text-lg max-w-md mx-auto leading-relaxed font-medium mb-12 animate-slideUp" style={{ animationDelay: '0.35s' }}>选择对应的大纲与章节，AI 将基于最新的考试趋势为您即时产出高质量数学练习。</p>
                <div className="grid grid-cols-2 gap-8 w-full max-w-xl">
                  <div className="p-8 bg-slate-50/50 rounded-[2.5rem] border border-slate-100 text-left hover-float-3d animate-slideUp cursor-default relative overflow-hidden" style={{ animationDelay: '0.45s' }}>
                    <SuitDecorations variant="corner" />
                    <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 text-sky-600 font-black transition-transform duration-300 hover:scale-110 hover:rotate-6 relative z-[1]">1</div>
                    <p className="font-black text-slate-700 mb-2 relative z-[1]">章节定点爆破</p>
                    <p className="text-xs text-slate-400 font-bold leading-relaxed uppercase relative z-[1]">Targeted Chapter Mastery</p>
                  </div>
                  <div className="p-8 bg-slate-50/50 rounded-[2.5rem] border border-slate-100 text-left hover-float-3d animate-slideUp cursor-default relative overflow-hidden" style={{ animationDelay: '0.55s' }}>
                    <SuitDecorations variant="corner" />
                    <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4 text-rose-600 font-black transition-transform duration-300 hover:scale-110 hover:-rotate-6 relative z-[1]">2</div>
                    <p className="font-black text-slate-700 mb-2 relative z-[1]">错题智能归因</p>
                    <p className="text-xs text-slate-400 font-bold leading-relaxed uppercase relative z-[1]">Intelligent Error Analysis</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== 页脚 ===== */}
      <footer className="bg-white border-t border-slate-100 py-16 mt-auto">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.3em]">AI 数学老师 Pro  高效率学习辅助系统  2025-2026</p>
          <div className="mt-6 flex justify-center gap-8 text-[10px] font-black text-slate-300 uppercase tracking-widest">
            <span className="hover:text-sky-400 transition-all cursor-pointer hover:-translate-y-0.5 nav-item-underline">服务协议</span>
            <span className="hover:text-sky-400 transition-all cursor-pointer hover:-translate-y-0.5 nav-item-underline">隐私政策</span>
            <span className="hover:text-sky-400 transition-all cursor-pointer hover:-translate-y-0.5 nav-item-underline">反馈建议</span>
          </div>
        </div>
      </footer>

      {/* ===== 浮层面板 ===== */}
      <SettingsPanel
        isOpen={activeModal === 'settings'}
        onClose={() => setActiveModal(null)}
        onSave={handleProviderSave}
        currentConfig={providerConfig}
        autoSaveSettings={autoSaveSettings}
        onSaveAutoSaveSettings={handleAutoSaveSettingsChange}
      />
      <ChatPanel isOpen={activeModal === 'chat'} onClose={() => setActiveModal(null)} currentProblems={problems} chatProvider={chatConfig.provider} visionProvider={visionConfig.provider} onOpenSettings={() => setActiveModal('settings')} />
      <BackupManager isOpen={activeModal === 'backup'} onClose={() => setActiveModal(null)} onRestore={(filename) => restoreByFilename(filename, () => setActiveModal(null))} />
      <AdminConsole providerConfig={providerConfig} />
      <HoverHelpOverlay disabled={problems.length >= config.count && config.count > 0} />
      <ConfirmDialog />
      <Toaster position="top-center" toastOptions={{ duration: 3500, style: { borderRadius: '1rem', fontWeight: 600, maxWidth: '420px' } }} />

      <style dangerouslySetInnerHTML={{
        __html: `
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        `
      }} />
    </div>
  );
};

export default App;
