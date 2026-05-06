/**
 * generateOneProblem.ts
 *
 * 单一职责：生成一道完整题目（题干 + 解析），含 Tool-Calling 自检、答案验证、异常检测和去重。
 */

import { GenerateConfig, MathProblem, LogEntry, QuestionType } from '@/types';
import { parseWithRetry, detectRepetition, isValidJsonBoundary } from '@/services/ai/jsonParser';
import { buildStemSystemPrompt, buildStemUserPrompt, buildExplanationSystemPrompt, buildExplanationUserPrompt } from '@/services/ai/prompts';
import { RETRACT_PROBLEM_TOOL, hasRetractCall, ToolCall } from './toolExecutor';

// ====== 类型 ======

export interface GenerationCallbacks {
  onLog: (log: LogEntry) => void;
}

export interface StemGenerationResult {
  problems: MathProblem[];
  toolCalls?: ToolCall[];
}

export interface AIServiceForGeneration {
  generateStemsWithTools(
    config: GenerateConfig,
    systemPrompt: string,
    existingContext: string,
    tools: typeof RETRACT_PROBLEM_TOOL[]
  ): Promise<StemGenerationResult>;

  generateExplanation(stem: MathProblem): Promise<string>;
}

// ====== 常量 ======

const MAX_RETRIES = 3;
const DEDUP_THRESHOLD = 0.95;
const MIN_EXPLANATION_LENGTH = 20;

// ====== 题型校验 ======

function containsChoicePattern(text: string): boolean {
  if (!text) return false;
  const normalized = text.replace(/\s+/g, ' ').toUpperCase();
  return /(?:^|\s)(A[\.、\)）]|B[\.、\)）]|C[\.、\)）]|D[\.、\)）])/.test(normalized)
    || /选项/.test(text);
}

function enforceQuestionType(stem: MathProblem, questionType: QuestionType): void {
  const options = Array.isArray(stem.options)
    ? stem.options.map(o => String(o).trim()).filter(Boolean)
    : [];

  if (questionType === QuestionType.CHOICE) {
    if (options.length !== 4) {
      throw new Error(`题型校验失败：选择题必须4个选项，实际${options.length}个`);
    }
    stem.options = options;
    return;
  }

  if (containsChoicePattern(stem.question || '')) {
    throw new Error(`题型校验失败：非选择题题干含A/B/C/D选项格式`);
  }
}

// ====== 去重 ======

/** 简单相似度检测——基于题干重叠字符比例 */
function checkSimilarity(problem: MathProblem, existing: MathProblem[]): number {
  if (existing.length === 0) return 0;
  const q1 = (problem.question || '').replace(/\s+/g, '');
  if (q1.length === 0) return 0;

  let maxScore = 0;
  for (const ep of existing) {
    const q2 = (ep.question || '').replace(/\s+/g, '');
    if (q2.length === 0) continue;

    // Jaccard 字符级相似度
    const set1 = new Set(q1.split(''));
    const set2 = new Set(q2.split(''));
    let intersection = 0;
    for (const ch of set1) {
      if (set2.has(ch)) intersection++;
    }
    const union = new Set([...set1, ...set2]).size;
    const score = union > 0 ? intersection / union : 0;

    // 也做长度比例检查
    const lenRatio = Math.min(q1.length, q2.length) / Math.max(q1.length, q2.length);
    maxScore = Math.max(maxScore, score * 0.7 + lenRatio * 0.3);
  }
  return maxScore;
}

// ====== 核心函数 ======

/**
 * 生成一道完整题目。
 *
 * 流程：生成题干 → Tool-Calling 自检 → 题型校验 → 生成解析(验证可解性) → 异常检测 → 95% 去重
 * 返回 null 表示本次调度失败，由编排层决定是否补位。
 */
export async function generateOneProblem(
  config: GenerateConfig,
  systemPrompt: string,
  existingContext: string,
  aiService: AIServiceForGeneration,
  existingProblems: MathProblem[],
  callbacks: GenerationCallbacks
): Promise<MathProblem | null> {
  const entropy = (Math.random() * 1e7).toFixed(0) + "_" + Date.now();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // ===== 阶段 1：生成题干（带 Tool-Calling 自检）=====
    let stemResult: StemGenerationResult;
    try {
      stemResult = await aiService.generateStemsWithTools(
        config, systemPrompt, existingContext, [RETRACT_PROBLEM_TOOL]
      );
    } catch (err: any) {
      // 网络超时等
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `题干生成异常(第${attempt + 1}次尝试)：${err?.message || '未知错误'}，重试中...`,
      });
      continue;
    }

    // Tool-Calling 死循环检测
    const retractCall = hasRetractCall(stemResult.toolCalls);
    if (retractCall) {
      const reason = (retractCall.arguments as any)?.reason || '未知原因';
      if (attempt >= 2) {
        callbacks.onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'warn',
          message: `模型连续3次撤回(${reason})，判定为死循环，跳过本题。`,
        });
        return null;
      }
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `模型自检撤回(${reason})，重新生成。`,
      });
      continue;
    }

    const stems = stemResult.problems;
    if (!stems || stems.length === 0) {
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `题干解析为空，重试中...`,
      });
      continue;
    }

    const stem = stems[0];

    // ===== 硬性题型校验 =====
    try {
      enforceQuestionType(stem, config.questionType);
    } catch (err: any) {
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `题型校验失败：${err?.message || ''}，重试中...`,
      });
      continue;
    }

    // ===== 阶段 2：生成解析（验证可解性）=====
    let explanation: string;
    try {
      explanation = await aiService.generateExplanation(stem);
    } catch (err: any) {
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `解析生成失败→判定题干不可解：${err?.message || '未知错误'}，重试中...`,
      });
      continue;
    }

    // 解析有效性验证
    if (!explanation || explanation.length < MIN_EXPLANATION_LENGTH) {
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `解析过短(${explanation?.length || 0}字符)→判定题干不可解，重试中...`,
      });
      continue;
    }

    // ===== 异常检测 =====
    if (detectRepetition(explanation, { minRepeat: 3, minLen: 50 }) >= 3) {
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: '检测到解析内容无限重复，自动中断并重试。',
      });
      continue;
    }

    // ===== 拼接完整题目 =====
    const fullProblem: MathProblem = {
      ...stem,
      answer: '',
      explanation,
      isExplanationStreaming: false,
    };

    // ===== 95% 去重 =====
    const similarity = checkSimilarity(fullProblem, existingProblems);
    if (similarity >= DEDUP_THRESHOLD) {
      callbacks.onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `去重拦截：与已有题目相似度${(similarity * 100).toFixed(1)}%≥95%，重新生成。`,
      });
      continue;
    }

    // 全部通过
    return fullProblem;
  }

  return null; // 重试耗尽
}
