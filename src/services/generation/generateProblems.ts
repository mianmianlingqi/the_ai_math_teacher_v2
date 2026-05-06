/**
 * generateProblems.ts
 *
 * 单一职责：出题编排——上下文累积、补位调度、回调通知。
 */

import { GenerateConfig, MathProblem, LogEntry } from '@/types';
import { buildStemSystemPrompt, buildExistingProblemsContext } from '@/services/ai/prompts';
import { generateOneProblem, AIServiceForGeneration, GenerationCallbacks } from './generateOneProblem';

// ====== 类型 ======

export interface GenerateProblemsCallbacks extends GenerationCallbacks {
  onProgress: (completed: number, total: number) => void;
  onProblemReady: (problem: MathProblem) => void;
}

// ====== 常量 ======

const MAX_SUPPLEMENT = 5;

// ====== 核心函数 ======

/**
 * 编排整批出题流程。
 *
 * 1. 注入系统 prompt
 * 2. while 循环：生成 → 成功累积 → 失败补位
 * 3. 每道完整题目通过 onProblemReady 逐题交付 UI
 */
export async function generateProblems(
  config: GenerateConfig,
  aiService: AIServiceForGeneration,
  callbacks: GenerateProblemsCallbacks
): Promise<MathProblem[]> {
  const acceptedProblems: MathProblem[] = [];
  let successCount = 0;
  let dispatchCount = 0;
  const maxDispatch = config.count * MAX_SUPPLEMENT;

  const systemPrompt = buildStemSystemPrompt();

  callbacks.onLog({
    timestamp: new Date().toLocaleTimeString(),
    level: 'info',
    message: `开始生成 ${config.count} 道 [${config.questionType}]（单模型串行 + 上下文累积 + 失败补位上限${MAX_SUPPLEMENT}x）...`,
  });

  while (successCount < config.count && dispatchCount < maxDispatch) {
    dispatchCount++;

    const existingContext = buildExistingProblemsContext(acceptedProblems);

    callbacks.onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: dispatchCount <= config.count
        ? `[${successCount}/${config.count}] 正在生成第 ${dispatchCount} 道题目...`
        : `[补位 ${dispatchCount - config.count}] 前有题目失败，正在补位生成...`,
    });

    const result = await generateOneProblem(
      config,
      systemPrompt,
      existingContext,
      aiService,
      acceptedProblems,
      callbacks,
    );

    if (result) {
      acceptedProblems.push(result);
      successCount++;
      callbacks.onProblemReady(result);
      callbacks.onProgress(successCount, config.count);
    }
  }

  if (successCount < config.count) {
    callbacks.onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'warn',
      message: `已达到补位上限：共调度 ${dispatchCount} 次，成功 ${successCount}/${config.count} 道。`,
    });
  } else {
    callbacks.onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `全部完成：成功生成 ${successCount}/${config.count} 道题目。`,
    });
  }

  return acceptedProblems;
}
