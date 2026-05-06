import React from 'react';
import { ExamPaper } from '@/types';

export interface PaperExportBarProps {
  paper: ExamPaper;
  exporting: boolean;
  savingToQBank: boolean;
  onGenerateProblems: () => void;
  onExportWord: () => void;
  onAutoFill: () => void;
  onSaveToQBank: () => void;
}

export const PaperExportBar: React.FC<PaperExportBarProps> = ({ paper, exporting, savingToQBank, onGenerateProblems, onExportWord, onAutoFill, onSaveToQBank }) => {
  const remaining = Math.max(0, paper.totalQuestions - paper.questions.length);
  const full = remaining === 0;

  return (
    <div className="bg-white rounded-[2rem] border border-orange-100 p-6 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-5">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-2xl font-black text-slate-900">试卷工作台</h2>
          <span className={`text-[10px] font-black px-3 py-1 rounded-full ${full ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
            {paper.questions.length} / {paper.totalQuestions} 题
          </span>
        </div>
        <p className="text-sm font-bold text-slate-400">
          {full ? '标准试卷已完成，可导出题目卷和答案解析卷。' : `当前还差 ${remaining} 题；未满 25 题也可以导出 Word。`}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onGenerateProblems}
          className="px-6 py-4 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 bg-sky-50 text-sky-600 border border-sky-100 hover:bg-sky-100 hover:-translate-y-0.5 active:translate-y-0"
          title="切换到出题页，生成新题后可回到试卷页自动补齐"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" /></svg>
          去出题
        </button>
        <button
          onClick={onAutoFill}
          disabled={full}
          className={`px-6 py-4 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 ${full ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-orange-50 text-orange-600 border border-orange-100 hover:bg-orange-100 hover:-translate-y-0.5 active:translate-y-0'}`}
          title="优先使用当前生成题目，再从题库补齐到标准题量"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          自动补齐到 {paper.totalQuestions} 题
        </button>
        <button
          onClick={onSaveToQBank}
          disabled={savingToQBank || paper.questions.length === 0}
          className={`px-6 py-4 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 ${savingToQBank || paper.questions.length === 0 ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 hover:-translate-y-0.5 active:translate-y-0'}`}
          title="将整张试卷中的题目批量保存到题库"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7V5a2 2 0 012-2h6a2 2 0 012 2v2m-9 4h8m-8 4h5M5 7h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" /></svg>
          {savingToQBank ? '正在保存...' : '保存到题库'}
        </button>
        <button
          onClick={onExportWord}
          disabled={exporting || paper.questions.length === 0}
          className={`px-8 py-4 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 ${exporting || paper.questions.length === 0 ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-orange-500 text-white shadow-xl shadow-orange-100 hover:bg-orange-600 hover:-translate-y-0.5 active:translate-y-0'}`}
          title="默认同时导出题目卷和答案解析卷"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" /></svg>
          {exporting ? '正在导出...' : '导出 Word 双文档'}
        </button>
      </div>
    </div>
  );
};
