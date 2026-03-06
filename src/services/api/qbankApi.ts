import { MathProblem, QBankFolder, QBankItem } from '@/types';
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
};
