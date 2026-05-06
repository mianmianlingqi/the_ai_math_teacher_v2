/**
 * papersStorage.ts
 *
 * 单一职责：管理试卷草稿的本地存储。
 * Why: 试卷是独立业务域，单独存储可避免题库、错题本和出题缓存互相耦合。
 */

import { Difficulty, ExamPaper, ExamPaperItem, MathProblem, QBankItem, QuestionType, Syllabus } from '@/types';
import { ACTIVE_EXAM_PAPER_KEY, EXAM_PAPERS_KEY, safeReadStorage, safeRemoveStorage, safeWriteStorage } from './core';

const DEFAULT_TOTAL_QUESTIONS = 25;
const DEFAULT_TOTAL_SCORE = 100;

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function calculateDefaultScore(totalScore: number, totalQuestions: number): number {
  if (!Number.isFinite(totalScore) || !Number.isFinite(totalQuestions) || totalQuestions <= 0) {
    return 4;
  }
  return Number((totalScore / totalQuestions).toFixed(2));
}

function normalizePaperItem(item: Partial<ExamPaperItem>, index: number, fallbackScore: number): ExamPaperItem | null {
  const question = typeof item.question === 'string' ? item.question.trim() : '';
  if (!question) return null;

  return {
    id: typeof item.id === 'string' && item.id ? item.id : createId('epi'),
    order: index + 1,
    score: typeof item.score === 'number' && item.score > 0 ? item.score : fallbackScore,
    source: item.source || 'manual',
    sourceId: typeof item.sourceId === 'string' ? item.sourceId : undefined,
    question,
    options: Array.isArray(item.options) ? item.options.filter(Boolean).map(String) : [],
    answer: typeof item.answer === 'string' ? item.answer : '',
    explanation: typeof item.explanation === 'string' ? item.explanation : '',
    difficulty: item.difficulty,
    syllabus: item.syllabus,
    questionType: item.questionType,
    images: Array.isArray(item.images) ? item.images.filter(Boolean).map(String) : [],
  };
}

function normalizePaper(raw: Partial<ExamPaper>): ExamPaper | null {
  const now = Date.now();
  const totalQuestions = typeof raw.totalQuestions === 'number' && raw.totalQuestions > 0
    ? Math.min(100, Math.floor(raw.totalQuestions))
    : DEFAULT_TOTAL_QUESTIONS;
  const totalScore = typeof raw.totalScore === 'number' && raw.totalScore > 0
    ? raw.totalScore
    : DEFAULT_TOTAL_SCORE;
  const fallbackScore = calculateDefaultScore(totalScore, totalQuestions);
  const questions = Array.isArray(raw.questions)
    ? raw.questions
      .map((item, index) => normalizePaperItem(item, index, fallbackScore))
      .filter((item): item is ExamPaperItem => Boolean(item))
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('paper'),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'AI 数学老师标准试卷',
    syllabus: raw.syllabus || Syllabus.UNDERGRADUATE_TRANSITION,
    totalQuestions,
    totalScore,
    questions,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    source: raw.source || 'manual',
  };
}

function normalizePapers(rawPapers: Partial<ExamPaper>[]): ExamPaper[] {
  return rawPapers
    .map(normalizePaper)
    .filter((paper): paper is ExamPaper => Boolean(paper));
}

function createPaperItemId(): string {
  return createId('epi');
}

function buildExamPaperItemBase(order: number, score: number) {
  return {
    id: createPaperItemId(),
    order,
    score,
  };
}

export const paperStorageService = {
  createDefaultExamPaper(): ExamPaper {
    const now = Date.now();
    return {
      id: createId('paper'),
      title: 'AI 数学老师标准试卷',
      syllabus: Syllabus.UNDERGRADUATE_TRANSITION,
      totalQuestions: DEFAULT_TOTAL_QUESTIONS,
      totalScore: DEFAULT_TOTAL_SCORE,
      questions: [],
      createdAt: now,
      updatedAt: now,
      source: 'manual',
    };
  },

  normalizeExamPapers(rawPapers: Partial<ExamPaper>[]): ExamPaper[] {
    return normalizePapers(rawPapers);
  },

  createExamPaperItemFromMathProblem(problem: MathProblem, order: number, score: number): ExamPaperItem {
    return {
      ...buildExamPaperItemBase(order, score),
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
  },

  createExamPaperItemFromQBankItem(item: QBankItem, order: number, score: number): ExamPaperItem {
    return {
      ...buildExamPaperItemBase(order, score),
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
  },

  replaceActiveExamPaperWithProblems(problems: MathProblem[], options?: { title?: string; syllabus?: Syllabus; totalScore?: number }): ExamPaper {
    const nextPaper = this.createDefaultExamPaper();
    const totalQuestions = Math.max(1, problems.length || DEFAULT_TOTAL_QUESTIONS);
    const totalScore = options?.totalScore && options.totalScore > 0
      ? options.totalScore
      : DEFAULT_TOTAL_SCORE;
    const score = calculateDefaultScore(totalScore, totalQuestions);
    const questions = problems.map((problem, index) => this.createExamPaperItemFromMathProblem(problem, index + 1, score));

    const finalPaper: ExamPaper = {
      ...nextPaper,
      title: options?.title?.trim() || 'AI 数学老师标准试卷',
      syllabus: options?.syllabus || problems[0]?.syllabus || nextPaper.syllabus,
      totalQuestions,
      totalScore,
      questions,
      source: 'ai',
      updatedAt: Date.now(),
    };

    this.saveExamPaper(finalPaper);
    return finalPaper;
  },

  getExamPapers(): ExamPaper[] {
    const papers = safeReadStorage<Partial<ExamPaper>[]>(EXAM_PAPERS_KEY, []);
    return normalizePapers(Array.isArray(papers) ? papers : []);
  },

  getActiveExamPaper(): ExamPaper {
    const papers = this.getExamPapers();
    const activeId = safeReadStorage<string | null>(ACTIVE_EXAM_PAPER_KEY, null);
    const active = activeId ? papers.find(paper => paper.id === activeId) : papers[0];
    if (active) return active;

    const paper = this.createDefaultExamPaper();
    safeWriteStorage(EXAM_PAPERS_KEY, [paper]);
    safeWriteStorage(ACTIVE_EXAM_PAPER_KEY, paper.id);
    return paper;
  },

  saveExamPaper(paper: ExamPaper): void {
    const normalized = normalizePaper({ ...paper, updatedAt: Date.now() });
    if (!normalized) return;

    const papers = this.getExamPapers();
    const idx = papers.findIndex(item => item.id === normalized.id);
    if (idx >= 0) {
      papers[idx] = normalized;
    } else {
      papers.unshift(normalized);
    }
    safeWriteStorage(EXAM_PAPERS_KEY, papers);
    safeWriteStorage(ACTIVE_EXAM_PAPER_KEY, normalized.id);
  },

  setActiveExamPaperId(id: string): void {
    const exists = this.getExamPapers().some(paper => paper.id === id);
    if (exists) {
      safeWriteStorage(ACTIVE_EXAM_PAPER_KEY, id);
    }
  },

  removeExamPaper(id: string): void {
    const papers = this.getExamPapers().filter(paper => paper.id !== id);
    safeWriteStorage(EXAM_PAPERS_KEY, papers);
    const activeId = safeReadStorage<string | null>(ACTIVE_EXAM_PAPER_KEY, null);
    if (activeId === id) {
      if (papers[0]) {
        safeWriteStorage(ACTIVE_EXAM_PAPER_KEY, papers[0].id);
      } else {
        safeRemoveStorage(ACTIVE_EXAM_PAPER_KEY);
      }
    }
  },

  clearActiveExamPaper(): void {
    const active = this.getActiveExamPaper();
    this.saveExamPaper({ ...active, questions: [], updatedAt: Date.now() });
  },
};
