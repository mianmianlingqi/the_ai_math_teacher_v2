/**
 * promptBuilder.ts
 *
 * 单一职责：将选中的参考资料（错题 / 笔记 / 题库）序列化为 AI 提示词上下文字符串。
 *
 * Why: 此函数属于 AI 服务层的提示工程逻辑，不应放在 UI 组件文件中。
 *      原在 ReferenceSelector.tsx 被 export，导致 hooks 层需从 components 层 import，
 *      违反了 components 依赖 hooks/services 而非反向的层次原则。
 */

import { WrongProblem, NoteItem, QBankItem } from '@/types';

/**
 * 将选中的错题 / 笔记 / 题库序列化为纯文本参考资料。
 * 笔记中的图片不会被传给大模型，但会注明 "[本条笔记含 N 张图片，仅提供文字内容]"。
 */
export function buildReferenceContext(
  wrongProblems: WrongProblem[],
  notes: NoteItem[],
  qbankItems: QBankItem[],
): string {
  const parts: string[] = [];

  if (wrongProblems.length > 0) {
    parts.push('=== 学生错题参考 ===');
    wrongProblems.forEach((wp, i) => {
      parts.push(`【错题 ${i + 1}】`);
      parts.push(`题目：${wp.question}`);
      parts.push(`正确答案：${wp.answer}`);
      if (wp.explanation) parts.push(`解析：${wp.explanation}`);
      parts.push(`错误类型：${wp.errorType}`);
      if (wp.userNote) parts.push(`学生笔记：${wp.userNote}`);
      parts.push('');
    });
  }

  if (notes.length > 0) {
    parts.push('=== 学生笔记参考 ===');
    notes.forEach((note, i) => {
      parts.push(`【笔记 ${i + 1}：${note.title}】`);
      if (note.images.length > 0) {
        parts.push(`[本条笔记含 ${note.images.length} 张图片，以下仅为文字内容]`);
      }
      if (note.content) parts.push(note.content);
      if (note.tags.length > 0) parts.push(`标签：${note.tags.join('、')}`);
      parts.push('');
    });
  }

  if (qbankItems.length > 0) {
    parts.push('=== 题库参考 ===');
    qbankItems.forEach((item, i) => {
      parts.push(`【题库题目 ${i + 1}】`);
      parts.push(`题目：${item.question}`);
      if (item.options.length > 0) parts.push(`选项：${item.options.join(' / ')}`);
      if (item.answer) parts.push(`答案：${item.answer}`);
      if (item.explanation) parts.push(`解析：${item.explanation}`);
      if (item.questionType) parts.push(`题型：${item.questionType}`);
      if (item.difficulty) parts.push(`难度：${item.difficulty}`);
      if (item.syllabus) parts.push(`大纲：${item.syllabus}`);
      if (item.tags.length > 0) parts.push(`标签：${item.tags.join('、')}`);
      if (item.images.length > 0) {
        parts.push(`[本题含 ${item.images.length} 张图片，仅提供文字内容]`);
      }
      parts.push('');
    });
  }

  return parts.join('\n').trim();
}
