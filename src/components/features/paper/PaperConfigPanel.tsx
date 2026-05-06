import React from 'react';
import { ExamPaper } from '@/types';

export interface PaperConfigPanelProps {
  paper: ExamPaper;
  onChange: (paper: ExamPaper) => void;
}

export const PaperConfigPanel: React.FC<PaperConfigPanelProps> = ({ paper, onChange }) => {
  const updatePaper = (patch: Partial<ExamPaper>) => {
    const next = { ...paper, ...patch, updatedAt: Date.now() };
    const score = Number((next.totalScore / next.totalQuestions).toFixed(2));
    next.questions = next.questions.map(item => ({ ...item, score }));
    onChange(next);
  };

  return (
    <div className="bg-white rounded-[2rem] border border-orange-100 p-6 shadow-sm">
      <h3 className="text-sm font-black text-slate-800 mb-5 flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">卷</span>
        试卷配置
      </h3>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">试卷标题</span>
          <input
            value={paper.title}
            onChange={event => updatePaper({ title: event.target.value })}
            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-orange-300"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">标准题量</span>
            <input
              type="number"
              min={1}
              max={100}
              value={paper.totalQuestions}
              onChange={event => updatePaper({ totalQuestions: Math.max(1, Math.min(100, Number(event.target.value) || 25)) })}
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-orange-300"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">总分</span>
            <input
              type="number"
              min={1}
              max={300}
              value={paper.totalScore}
              onChange={event => updatePaper({ totalScore: Math.max(1, Number(event.target.value) || 100) })}
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-orange-300"
            />
          </label>
        </div>
        <div className="rounded-2xl bg-orange-50/70 border border-orange-100 px-4 py-3 text-xs font-bold text-orange-700">
          默认每题 {Number((paper.totalScore / paper.totalQuestions).toFixed(2))} 分，导出 Word 时会写入题目卷。
        </div>
      </div>
    </div>
  );
};
