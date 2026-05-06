import React from 'react';
import { ExamPaper } from '@/types';

export interface PaperPreviewProps {
  paper: ExamPaper;
  mode: 'questions' | 'answers';
  onGenerateProblems?: () => void;
}

const labels = ['A', 'B', 'C', 'D', 'E', 'F'];

export const PaperPreview: React.FC<PaperPreviewProps> = ({ paper, mode, onGenerateProblems }) => {
  if (!paper.questions.length) {
    return (
      <div className="h-full min-h-[420px] flex flex-col items-center justify-center text-center bg-white rounded-[2.5rem] border border-dashed border-orange-200 p-10">
        <div className="w-20 h-20 rounded-[2rem] bg-orange-50 text-orange-300 flex items-center justify-center mb-5">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" /></svg>
        </div>
        <h3 className="text-xl font-black text-slate-800 mb-2">试卷尚无题目</h3>
        <p className="text-sm font-bold text-slate-400">请从题库或当前生成题目中添加内容。</p>
        {onGenerateProblems && (
          <button
            onClick={onGenerateProblems}
            className="mt-6 px-6 py-3 rounded-2xl bg-sky-600 text-white text-sm font-black shadow-xl shadow-sky-100 hover:bg-sky-700 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" /></svg>
            去出题页生成题目
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
      <div className="text-center border-b border-dashed border-slate-200 pb-6 mb-8">
        <h2 className="text-2xl font-black text-slate-900">{mode === 'answers' ? `${paper.title} - 答案解析` : paper.title}</h2>
        {mode === 'questions' && <p className="mt-4 text-sm font-bold text-slate-500">姓名：__________　班级：__________　得分：__________</p>}
      </div>

      {mode === 'answers' && (
        <div className="mb-10">
          <h3 className="text-lg font-black text-slate-800 mb-4">一、答案速查</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {paper.questions.map(item => (
              <div key={`lookup-${item.id}`} className="text-sm font-bold text-slate-600 bg-slate-50 rounded-xl px-4 py-2">
                {item.order}. {item.answer || '（暂无答案）'}
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-lg font-black text-slate-800 mb-6">{mode === 'answers' ? '二、详细解析' : '一、试题部分'}</h3>
      <div className="space-y-8">
        {paper.questions.map(item => (
          <div key={item.id} className="break-inside-avoid rounded-2xl border border-slate-100 bg-slate-50/40 p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-black text-slate-800">{mode === 'answers' ? `第 ${item.order} 题` : `${item.order}.（${item.score} 分）`}</h4>
              <span className="text-[10px] font-black text-orange-400">{item.questionType || '题目'}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7 font-bold text-slate-700">{mode === 'answers' ? `题目：${item.question}` : item.question}</p>
            {item.options.length > 0 && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                {item.options.map((option, index) => (
                  <p key={`${item.id}-${index}`} className="text-sm font-bold text-slate-600 bg-white rounded-xl px-4 py-2">{labels[index] ?? index + 1}. {option}</p>
                ))}
              </div>
            )}
            {mode === 'answers' && (
              <div className="mt-5 space-y-3">
                <p className="text-sm font-black text-slate-800">答案：{item.answer || '（暂无答案）'}</p>
                <p className="whitespace-pre-wrap text-sm leading-7 font-bold text-slate-600">解析：{item.explanation || '暂无解析。'}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
