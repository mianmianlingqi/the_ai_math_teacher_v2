import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { DEFAULT_QBANK_FOLDER_ID, Difficulty, ExamPaper, ExamPaperItem, MathProblem, QBankFolder, QBankItem, QuestionType, Syllabus } from '@/types';
import { storageService } from '@/services/storage';
import { showConfirm } from '@/services/api/confirmService';
import { qbankCollectionApi } from '@/services/api/qbankApi';
import { folderManagerApi } from '@/services/api/folderApi';
import { exportPaperToWordPair } from '@/services/export/paperWordExport';
import { SuitDecorations } from '@/components/common/SuitDecorations';
import { PaperConfigPanel } from './PaperConfigPanel';
import { PaperExportBar } from './PaperExportBar';
import { PaperPreview } from './PaperPreview';
import { PaperQuestionList, PaperQuestionPicker } from './PaperQuestionPicker';

export interface PaperWorkspaceProps {
  currentProblems: MathProblem[];
  onGenerateProblems: () => void;
}

function createItemId(): string {
  return `epi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultScore(paper: ExamPaper): number {
  return Number((paper.totalScore / paper.totalQuestions).toFixed(2));
}

function reorderItems(items: ExamPaperItem[]): ExamPaperItem[] {
  return items.map((item, index) => ({ ...item, order: index + 1 }));
}

function normalizeQuestionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createExamPaperItemFromMathProblem(problem: MathProblem, order: number, score: number): ExamPaperItem {
  return {
    id: createItemId(),
    order,
    score,
    source: 'current_problem',
    sourceId: problem.id,
    question: problem.question,
    options: problem.options || [],
    answer: problem.answer,
    explanation: problem.explanation,
    difficulty: problem.difficulty,
    syllabus: problem.syllabus,
    questionType: problem.questionType,
    images: [],
  };
}

function createExamPaperItemFromQBankItem(item: QBankItem, order: number, score: number): ExamPaperItem {
  return {
    id: createItemId(),
    order,
    score,
    source: 'qbank',
    sourceId: item.id,
    question: item.question,
    options: item.options || [],
    answer: item.answer,
    explanation: item.explanation,
    difficulty: item.difficulty as Difficulty | undefined,
    syllabus: item.syllabus as Syllabus | undefined,
    questionType: item.questionType as QuestionType | undefined,
    images: item.images || [],
  };
}

export const PaperWorkspace: React.FC<PaperWorkspaceProps> = ({ currentProblems, onGenerateProblems }) => {
  const [paper, setPaper] = useState<ExamPaper>(() => storageService.getActiveExamPaper());
  const [previewMode, setPreviewMode] = useState<'questions' | 'answers'>('questions');
  const [exporting, setExporting] = useState(false);
  const [savingToQBank, setSavingToQBank] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [qbankFolders, setQBankFolders] = useState<QBankFolder[]>(() => qbankCollectionApi.getFolders());
  const [targetQBankFolderId, setTargetQBankFolderId] = useState(DEFAULT_QBANK_FOLDER_ID);
  const [newQBankFolderName, setNewQBankFolderName] = useState('');

  useEffect(() => {
    storageService.saveExamPaper(paper);
  }, [paper]);

  const isFull = paper.questions.length >= paper.totalQuestions;
  const progressLabel = useMemo(() => `${paper.questions.length}/${paper.totalQuestions}`, [paper.questions.length, paper.totalQuestions]);
  const flattenedQBankFolders = useMemo(() => folderManagerApi.flattenFolderTree(qbankFolders), [qbankFolders]);
  const targetQBankFolderName = useMemo(
    () => qbankFolders.find(folder => folder.id === targetQBankFolderId)?.name || '根目录',
    [qbankFolders, targetQBankFolderId],
  );

  const refreshQBankFolders = () => {
    const folders = qbankCollectionApi.getFolders();
    setQBankFolders(folders);
    if (!folders.some(folder => folder.id === targetQBankFolderId)) {
      setTargetQBankFolderId(DEFAULT_QBANK_FOLDER_ID);
    }
  };

  const updatePaper = (next: ExamPaper) => {
    setPaper({ ...next, questions: reorderItems(next.questions), updatedAt: Date.now() });
  };

  const addItem = (item: ExamPaperItem) => {
    if (paper.questions.length >= paper.totalQuestions) {
      toast.error(`标准试卷已满 ${paper.totalQuestions} 题，请先删除题目或调整标准题量。`);
      return;
    }
    updatePaper({ ...paper, questions: [...paper.questions, item] });
    toast.success('已加入试卷。');
  };

  const handleAddCurrentProblem = (problem: MathProblem) => {
    addItem(createExamPaperItemFromMathProblem(problem, paper.questions.length + 1, getDefaultScore(paper)));
  };

  const handleAddQBankItem = (item: QBankItem) => {
    addItem(createExamPaperItemFromQBankItem(item, paper.questions.length + 1, getDefaultScore(paper)));
  };

  const handleMove = (id: string, direction: 'up' | 'down') => {
    const idx = paper.questions.findIndex(item => item.id === id);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= paper.questions.length) return;
    const next = [...paper.questions];
    const [item] = next.splice(idx, 1);
    next.splice(targetIdx, 0, item);
    updatePaper({ ...paper, questions: next });
  };

  const handleRemove = (id: string) => {
    updatePaper({ ...paper, questions: paper.questions.filter(item => item.id !== id) });
  };

  const handleAutoFill = () => {
    const remaining = paper.totalQuestions - paper.questions.length;
    if (remaining <= 0) {
      toast.success('标准试卷已满，无需补齐。');
      return;
    }

    const existingQuestions = new Set(paper.questions.map(item => normalizeQuestionText(item.question)));
    const score = getDefaultScore(paper);
    const additions: ExamPaperItem[] = [];

    const tryAdd = (questionText: string, createItem: (order: number) => ExamPaperItem) => {
      if (additions.length >= remaining) return;
      const normalized = normalizeQuestionText(questionText);
      if (!normalized || existingQuestions.has(normalized)) return;
      existingQuestions.add(normalized);
      additions.push(createItem(paper.questions.length + additions.length + 1));
    };

    currentProblems.forEach(problem => {
      tryAdd(problem.question, order => createExamPaperItemFromMathProblem(problem, order, score));
    });

    if (additions.length < remaining) {
      storageService.getQBankItems().forEach(item => {
        tryAdd(item.question, order => createExamPaperItemFromQBankItem(item, order, score));
      });
    }

    if (additions.length === 0) {
      toast.error('没有可用于补齐的新题目。请先在出题页生成题目，或在题库中添加更多题目。');
      return;
    }

    updatePaper({ ...paper, questions: [...paper.questions, ...additions] });
    if (additions.length >= remaining) {
      toast.success(`已自动补齐 ${additions.length} 道题，标准试卷已满 ${paper.totalQuestions} 题。`);
    } else {
      toast.success(`已自动加入 ${additions.length} 道题，当前题源不足，还差 ${remaining - additions.length} 题。`);
    }
  };

  const handleExportWord = async () => {
    if (!paper.questions.length) {
      toast.error('请先添加题目再导出 Word。');
      return;
    }

    if (paper.questions.length < paper.totalQuestions) {
      const confirmed = await showConfirm(`当前试卷只有 ${paper.questions.length}/${paper.totalQuestions} 题，未满标准题量。是否继续导出 Word？`);
      if (!confirmed) return;
    }

    setExporting(true);
    try {
      await exportPaperToWordPair(paper);
      toast.success('已导出题目卷和答案解析卷 Word 文档。若浏览器提示，请允许多文件下载。');
    } catch (error: any) {
      toast.error(error?.message || '导出 Word 失败，请稍后重试。');
    } finally {
      setExporting(false);
    }
  };

  const handleNewPaper = async () => {
    if (paper.questions.length > 0) {
      const confirmed = await showConfirm('确定要新建一张空白标准试卷吗？当前试卷会保存在本地，可继续从存储中恢复。');
      if (!confirmed) return;
    }
    const next = storageService.createDefaultExamPaper();
    setPaper(next);
    toast.success('已新建标准试卷。');
  };

  const handleOpenSaveDialog = () => {
    if (!paper.questions.length) {
      toast.error('请先向试卷中加入题目，再保存到题库。');
      return;
    }

    refreshQBankFolders();
    setTargetQBankFolderId(DEFAULT_QBANK_FOLDER_ID);
    setNewQBankFolderName('');
    setShowSaveDialog(true);
  };

  const handleCreateQBankFolder = () => {
    const folderName = newQBankFolderName.trim();
    if (!folderName) {
      toast.error('请输入新的题库文件夹名称。');
      return;
    }

    const created = folderManagerApi.addFolder('qbank', folderName, targetQBankFolderId) as QBankFolder;
    refreshQBankFolders();
    setTargetQBankFolderId(created.id);
    setNewQBankFolderName('');
    toast.success(`已在“${targetQBankFolderName}”下创建子文件夹“${created.name}”。`);
  };

  const handleSavePaperToQBank = async () => {
    if (!paper.questions.length) {
      toast.error('当前试卷没有可保存的题目。');
      return;
    }

    setSavingToQBank(true);
    try {
      const result = qbankCollectionApi.savePaperToQBank(paper, targetQBankFolderId);
      const summaryParts: string[] = [];

      if (result.savedCount > 0) summaryParts.push(`新增 ${result.savedCount} 道`);
      if (result.duplicatedCount > 0) summaryParts.push(`重复跳过 ${result.duplicatedCount} 道`);
      if (result.skippedCount > 0) summaryParts.push(`空题跳过 ${result.skippedCount} 道`);

      if (result.savedCount > 0) {
        toast.success(`试卷已保存到题库“${targetQBankFolderName}”：${summaryParts.join('，')}。`);
        setShowSaveDialog(false);
        return;
      }

      toast.error(summaryParts.length > 0 ? `未写入新题目：${summaryParts.join('，')}。` : '未写入新题目，请检查试卷内容后重试。');
    } catch (error: any) {
      toast.error(error?.message || '保存到题库失败，请稍后重试。');
    } finally {
      setSavingToQBank(false);
    }
  };

  return (
    <section className="relative min-h-[650px] animate-viewSwitch">
      <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
        <SuitDecorations variant="full" />
      </div>

      <div className="relative z-[1] space-y-8">
        <PaperExportBar
          paper={paper}
          exporting={exporting}
          savingToQBank={savingToQBank}
          onGenerateProblems={onGenerateProblems}
          onExportWord={handleExportWord}
          onAutoFill={handleAutoFill}
          onSaveToQBank={handleOpenSaveDialog}
        />

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
          <aside className="xl:col-span-4 space-y-6">
            <PaperConfigPanel paper={paper} onChange={updatePaper} />
            <div className="bg-white rounded-[2rem] border border-orange-100 p-5 shadow-sm flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">标准进度</p>
                <p className="text-2xl font-black text-orange-500">{progressLabel}</p>
              </div>
              <button onClick={handleNewPaper} className="px-4 py-3 rounded-2xl bg-slate-50 text-xs font-black text-slate-500 hover:text-orange-500 hover:bg-orange-50 transition-all">新建试卷</button>
            </div>
            <PaperQuestionPicker
              currentProblems={currentProblems}
              isFull={isFull}
              onGenerateProblems={onGenerateProblems}
              onAddQBankItem={handleAddQBankItem}
              onAddCurrentProblem={handleAddCurrentProblem}
            />
            <PaperQuestionList items={paper.questions} onMove={handleMove} onRemove={handleRemove} />
          </aside>

          <main className="xl:col-span-8 space-y-5">
            <div className="bg-white rounded-[2rem] border border-orange-100 p-3 shadow-sm inline-flex gap-2">
              <button onClick={() => setPreviewMode('questions')} className={`px-5 py-3 rounded-2xl text-xs font-black transition-all ${previewMode === 'questions' ? 'bg-orange-500 text-white shadow-lg shadow-orange-100' : 'text-slate-400 hover:text-orange-500 hover:bg-orange-50'}`}>题目卷预览</button>
              <button onClick={() => setPreviewMode('answers')} className={`px-5 py-3 rounded-2xl text-xs font-black transition-all ${previewMode === 'answers' ? 'bg-orange-500 text-white shadow-lg shadow-orange-100' : 'text-slate-400 hover:text-orange-500 hover:bg-orange-50'}`}>答案解析卷预览</button>
            </div>
            <PaperPreview paper={paper} mode={previewMode} onGenerateProblems={onGenerateProblems} />
          </main>
        </div>
      </div>

      {showSaveDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => !savingToQBank && setShowSaveDialog(false)}>
          <div className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white shadow-2xl overflow-hidden animate-scaleIn" onClick={event => event.stopPropagation()}>
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50">
              <h3 className="text-lg font-black text-slate-800">保存试卷到题库</h3>
              <p className="mt-2 text-xs font-bold text-slate-400 leading-6">
                将当前试卷中的 {paper.questions.length} 道题批量写入题库。已存在的同题题目会自动跳过，避免重复保存。
              </p>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-[0.18em] mb-2">目标题库文件夹</label>
                <select
                  value={targetQBankFolderId}
                  onChange={(event) => setTargetQBankFolderId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  {flattenedQBankFolders.map(({ folder, depth }) => (
                    <option key={folder.id} value={folder.id}>
                      {'　'.repeat(depth)}{depth > 0 ? '└ ' : ''}{folder.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs font-medium text-slate-400">当前保存目标：{targetQBankFolderName}</p>
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3">
                <p className="text-[11px] font-black text-indigo-600 uppercase tracking-[0.18em] mb-2">快速新建子文件夹</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={newQBankFolderName}
                    onChange={(event) => setNewQBankFolderName(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && handleCreateQBankFolder()}
                    placeholder={`在“${targetQBankFolderName}”下新建子文件夹...`}
                    className="flex-1 rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    onClick={handleCreateQBankFolder}
                    className="px-5 py-3 rounded-2xl bg-indigo-100 text-sm font-black text-indigo-700 hover:bg-indigo-200 transition-all"
                  >
                    新建文件夹
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm font-black text-slate-700">
                  <span>本次保存范围</span>
                  <span>{paper.questions.length} 道题</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>试卷标题</span>
                  <span className="text-right max-w-[65%] truncate">{paper.title || '未命名试卷'}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                  <span>保存规则</span>
                  <span>按题干去重，重复题自动跳过</span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-white flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                onClick={() => setShowSaveDialog(false)}
                disabled={savingToQBank}
                className={`px-5 py-3 rounded-2xl text-sm font-black transition-all ${savingToQBank ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                取消
              </button>
              <button
                onClick={handleSavePaperToQBank}
                disabled={savingToQBank}
                className={`px-5 py-3 rounded-2xl text-sm font-black transition-all ${savingToQBank ? 'bg-indigo-200 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
              >
                {savingToQBank ? '正在保存到题库...' : '确认保存到题库'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
