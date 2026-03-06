/**
 * uiOptions.ts
 *
 * 单一职责：UI 下拉框枚举选项 + 出题默认配置。
 * 变化原因：题型/难度/学科 UI 调整时修改此文件。
 */

import { Syllabus, Difficulty, QuestionType } from '@/types';

export const SYLLABUS_OPTIONS = [
  { value: Syllabus.POSTGRADUATE, label: '考研数学' },
  { value: Syllabus.UNDERGRADUATE_TRANSITION, label: '专升本数学' },
  { value: Syllabus.GAOKAO, label: '高考数学' },
];

export const DIFFICULTY_OPTIONS = [
  { value: Difficulty.EASY, label: '较简单' },
  { value: Difficulty.MEDIUM, label: '中等' },
  { value: Difficulty.HARD, label: '较难' },
];

export const QUESTION_TYPE_OPTIONS = [
  { value: QuestionType.CHOICE, label: '选择题' },
  { value: QuestionType.FILL_BLANK, label: '填空题' },
  { value: QuestionType.CALCULATION, label: '计算题' },
  { value: QuestionType.PROOF, label: '证明题' },
  { value: QuestionType.APPLICATION, label: '应用题' },
  { value: QuestionType.COMPREHENSIVE, label: '综合题' },
];

export const DEFAULT_CONFIG = {
  syllabus: Syllabus.UNDERGRADUATE_TRANSITION,
  difficulty: Difficulty.MEDIUM,
  questionType: QuestionType.CALCULATION,
  chapter: '一元函数微分学',
  topic: '',
  count: 5,
};
