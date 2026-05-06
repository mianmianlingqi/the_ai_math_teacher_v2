/**
 * paperWordExport.ts
 *
 * 前端仅负责调用本地导出服务，不在浏览器中执行 docx / MathJax / 公式渲染逻辑。
 * Why: 浏览器端运行重型导出链路会引发 require is not defined 等兼容问题；
 *      迁移到 Electron / Vite 本地 API 的 Node 环境后更稳定，也更符合“创建即可用”的目标。
 */

import type { ExamPaper } from '@/types';

async function requestWordBlob(paper: ExamPaper, variant: 'question' | 'answer'): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch('/api/export-paper-word', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper, variant }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `导出 Word 失败（HTTP ${response.status}）`);
  }

  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const matched = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filename = matched?.[1] ? decodeURIComponent(matched[1]) : `paper_${variant}.docx`;
  const blob = await response.blob();
  return { blob, filename };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportPaperToWordPair(paper: ExamPaper): Promise<void> {
  if (!paper.questions.length) {
    throw new Error('试卷中还没有题目，无法导出 Word。');
  }

  const [questionFile, answerFile] = await Promise.all([
    requestWordBlob(paper, 'question'),
    requestWordBlob(paper, 'answer'),
  ]);

  downloadBlob(questionFile.blob, questionFile.filename);
  window.setTimeout(() => {
    downloadBlob(answerFile.blob, answerFile.filename);
  }, 250);
}
