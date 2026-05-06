import { ExamPaper, ExamPaperItem, MathProblem, QBankFolder, QBankItem, QBankSource } from '@/types';
import { storageService } from '@/services/storage';

function createQBankItemFromProblem(problem: MathProblem, folderId: string): QBankItem {
  const now = Date.now();
  return {
    id: `qb_${now}_${Math.random().toString(36).slice(2, 8)}`,
    question: problem.question,
    options: problem.options || [],
    answer: problem.answer,
    explanation: problem.explanation,
    difficulty: problem.difficulty,
    syllabus: problem.syllabus,
    questionType: problem.questionType,
    tags: [],
    folderId,
    source: 'ai',
    sourceNote: '来自 AI 自动生成',
    images: [],
    createdAt: now,
    updatedAt: now,
  };
}

function mapPaperItemSourceToQBankSource(source: ExamPaperItem['source']): QBankSource {
  if (source === 'wrong_book') return 'wrong_book';
  if (source === 'manual') return 'manual';
  return 'ai';
}

function createQBankItemFromPaperItem(item: ExamPaperItem, folderId: string, paperTitle: string): QBankItem {
  const now = Date.now();
  return {
    id: `qb_${now}_${Math.random().toString(36).slice(2, 8)}`,
    question: item.question,
    options: item.options || [],
    answer: item.answer,
    explanation: item.explanation,
    difficulty: item.difficulty,
    syllabus: item.syllabus,
    questionType: item.questionType,
    tags: [],
    folderId,
    source: mapPaperItemSourceToQBankSource(item.source),
    sourceNote: `来自试卷《${paperTitle || '未命名试卷'}》第 ${item.order} 题`,
    images: item.images || [],
    createdAt: now,
    updatedAt: now,
  };
}

export const qbankCollectionApi = {
  getFolders(): QBankFolder[] {
    return storageService.getQBankFolders();
  },

  getItemByQuestion(question: string): QBankItem | undefined {
    return storageService.getQBankItems().find(item => item.question === question);
  },

  hasSameQuestion(question: string): boolean {
    return storageService.getQBankItems().some(item => item.question === question);
  },

  saveProblemToQBank(problem: MathProblem, folderId: string): { saved: boolean; duplicated: boolean } {
    if (this.hasSameQuestion(problem.question)) {
      return { saved: false, duplicated: true };
    }

    const qbankItem = createQBankItemFromProblem(problem, folderId);
    storageService.saveQBankItem(qbankItem);
    return { saved: true, duplicated: false };
  },

  removeProblemFromQBank(question: string): boolean {
    const target = this.getItemByQuestion(question);
    if (!target) return false;
    storageService.removeQBankItem(target.id);
    return true;
  },

  savePaperToQBank(paper: ExamPaper, folderId: string): { savedCount: number; duplicatedCount: number; skippedCount: number } {
    let savedCount = 0;
    let duplicatedCount = 0;
    let skippedCount = 0;

    paper.questions.forEach((item) => {
      const question = item.question.trim();
      if (!question) {
        skippedCount++;
        return;
      }

      if (this.hasSameQuestion(question)) {
        duplicatedCount++;
        return;
      }

      const qbankItem = createQBankItemFromPaperItem({ ...item, question }, folderId, paper.title);
      storageService.saveQBankItem(qbankItem);
      savedCount++;
    });

    return { savedCount, duplicatedCount, skippedCount };
  },
};
