import React, { useMemo, useState } from 'react';
import { ExamPaperItem, MathProblem, QBankItem } from '@/types';
import { storageService } from '@/services/storage';

export interface PaperQuestionPickerProps {
  currentProblems: MathProblem[];
  isFull: boolean;
  onGenerateProblems: () => void;
  onAddQBankItem: (item: QBankItem) => void;
  onAddCurrentProblem: (problem: MathProblem) => void;
}

export const PaperQuestionPicker: React.FC<PaperQuestionPickerProps> = ({ currentProblems, isFull, onGenerateProblems, onAddQBankItem, onAddCurrentProblem }) => {
  const [query, setQuery] = useState('');
  const qbankItems = useMemo(() => storageService.getQBankItems(), []);
  const filteredQBank = qbankItems
    .filter(item => !query.trim() || `${item.question} ${item.answer} ${item.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 30);

  const renderAddButton = (onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={isFull}
      className={`px-3 py-2 rounded-xl text-[11px] font-black transition-all ${isFull ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-orange-500 text-white hover:bg-orange-600 active:scale-95'}`}
    >
      加入
    </button>
  );

  const renderProblemSnippet = (question: string) => (
    <p className="text-xs font-bold text-slate-500 leading-5 line-clamp-2">{question}</p>
  );

  return (
    <div className="bg-white rounded-[2rem] border border-orange-100 p-6 shadow-sm">
      <h3 className="text-sm font-black text-slate-800 mb-5 flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">题</span>
        添加题目
      </h3>

      {isFull && <div className="mb-4 rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-xs font-bold text-emerald-700">标准 25 题已满，如需继续添加请先调整标准题量或删除部分题目。</div>}

      <label className="block mb-5">
        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">题库搜索</span>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索题干、答案或标签..."
          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-orange-300"
        />
      </label>

      <div className="space-y-6">
        <section>
          <h4 className="text-xs font-black text-slate-500 mb-3">当前生成题目</h4>
          <div className="space-y-2 max-h-44 overflow-auto custom-scrollbar pr-1">
            {currentProblems.length === 0 ? (
              <div className="text-xs font-bold text-slate-400 bg-slate-50 rounded-2xl px-4 py-3">
                <p>当前出题页还没有生成题目。</p>
                <button onClick={onGenerateProblems} className="mt-3 px-4 py-2 rounded-xl bg-sky-50 text-sky-600 font-black hover:bg-sky-100 transition-all">去出题</button>
              </div>
            ) : currentProblems.map(problem => (
              <div key={problem.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex-1 min-w-0">{renderProblemSnippet(problem.question)}</div>
                {renderAddButton(() => onAddCurrentProblem(problem))}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-black text-slate-500 mb-3">题库题目</h4>
          <div className="space-y-2 max-h-72 overflow-auto custom-scrollbar pr-1">
            {filteredQBank.length === 0 ? (
              <p className="text-xs font-bold text-slate-400 bg-slate-50 rounded-2xl px-4 py-3">题库暂无匹配题目。</p>
            ) : filteredQBank.map(item => (
              <div key={item.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex-1 min-w-0">{renderProblemSnippet(item.question)}</div>
                {renderAddButton(() => onAddQBankItem(item))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export interface PaperQuestionListProps {
  items: ExamPaperItem[];
  onMove: (id: string, direction: 'up' | 'down') => void;
  onRemove: (id: string) => void;
}

export const PaperQuestionList: React.FC<PaperQuestionListProps> = ({ items, onMove, onRemove }) => (
  <div className="bg-white rounded-[2rem] border border-orange-100 p-6 shadow-sm">
    <h3 className="text-sm font-black text-slate-800 mb-5">当前试卷题目</h3>
    <div className="space-y-2 max-h-80 overflow-auto custom-scrollbar pr-1">
      {items.length === 0 ? (
        <p className="text-xs font-bold text-slate-400 bg-slate-50 rounded-2xl px-4 py-3">还没有加入题目。</p>
      ) : items.map(item => (
        <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-xs font-black text-orange-500">第 {item.order} 题 · {item.score} 分</span>
            <div className="flex items-center gap-1">
              <button onClick={() => onMove(item.id, 'up')} className="px-2 py-1 rounded-lg bg-white text-xs font-black text-slate-500 hover:text-orange-500">↑</button>
              <button onClick={() => onMove(item.id, 'down')} className="px-2 py-1 rounded-lg bg-white text-xs font-black text-slate-500 hover:text-orange-500">↓</button>
              <button onClick={() => onRemove(item.id)} className="px-2 py-1 rounded-lg bg-white text-xs font-black text-rose-400 hover:text-rose-600">删</button>
            </div>
          </div>
          <p className="text-xs font-bold text-slate-500 leading-5 line-clamp-2">{item.question}</p>
        </div>
      ))}
    </div>
  </div>
);
