import { AIProviderConfig, DualModelConfig, GenerateConfig, MathProblem, LogEntry, Difficulty, QuestionType, QBankItem, DEFAULT_QBANK_FOLDER_ID } from "@/types";
import { endUsageRequest, extractOpenAIUsage, startUsageRequest, estimateTokensFromText } from "./devUsageTracker";
import { aiApi, tokenStore, BACKEND_BASE_URL } from "../api/backendApi";
import { isReasoningModel, normalizeBaseURL, buildAuthHeaders, getTimeoutMs, getHttpErrorInfo } from "./httpClient";
import { recordModelRequest, recordModelResponse } from "../dev/adminConsoleStore";

/**
 * 流式解析回调：每个 token 到达时通知调用方更新 UI。
 *
 * Why: 解析阶段改为 SSE 流式输出后，逐 token 回传给 Hook 层，
 *      Hook 实时更新对应题目的 explanation 字段，ProblemCard 即时渲染。
 */
export interface ExplanationStreamCallbacks {
  /** 流式 token 到达 */
  onToken: (token: string) => void;
  /** 流式完成 */
  onDone: (fullText: string) => void;
  /** 流式错误 */
  onError: (error: string) => void;
}

/**
 * 通用 AI 服务 - 基于 OpenAI 兼容 API 格式
 */
export class UnifiedAIService {
  private providerConfig: AIProviderConfig;
  private dualModelConfig: DualModelConfig;

  private getStreamIdleTimeoutMs(provider: AIProviderConfig): number {
    const totalTimeoutMs = getTimeoutMs(provider);
    return Math.min(totalTimeoutMs, 45000);
  }

  private sanitizeErrorMessage(message: string): string {
    if (!message) return '模型返回异常，请稍后重试。';
    let text = String(message)
      .replace(/```[\s\S]*?```/g, '[已隐藏代码片段]')
      .replace(/[\r\n]+/g, ' ')
      .trim();
    if (text.length > 120) {
      text = `${text.slice(0, 120)}...`;
    }
    return text;
  }

  constructor(config: AIProviderConfig, dualConfig: DualModelConfig = { enabled: false, provider: null }) {
    this.providerConfig = config;
    this.dualModelConfig = dualConfig;
  }

  updateConfig(config: AIProviderConfig, dualConfig?: DualModelConfig) {
    this.providerConfig = config;
    if (dualConfig) {
      this.dualModelConfig = dualConfig;
    }
  }

  getConfig(): AIProviderConfig {
    return this.providerConfig;
  }

  private getDifficultyGuidance(difficulty: Difficulty): string {
    switch (difficulty) {
      case Difficulty.EASY:
        return "【基础巩固】侧重核心概念的直接应用，数值简洁，逻辑清晰";
      case Difficulty.MEDIUM:
        return "【中坚拔高】包含知识点嵌套，需要中等程度的化简或构造，接近考试真题中后段水平";
      case Difficulty.HARD:
        return "【竞赛/压轴】涉及深层抽象思维、多步推导或不常用的数学技巧，设置精巧的陷阱";
      default:
        return "";
    }
  }

  private getQuestionTypeHardRules(questionType: QuestionType): string[] {
    if (questionType === QuestionType.CHOICE) {
      return [
        "【题型硬约束（必须满足）】",
        "- 仅允许输出选择题。",
        "- 每道题 options 必须且只能有 4 项。",
        "- question 里不要重复粘贴 A/B/C/D 选项正文。",
      ];
    }

    return [
      "【题型硬约束（必须满足）】",
      `- 仅允许输出「${questionType}」，严禁输出选择题。`,
      "- options 必须为空数组 []。",
      "- question 中严禁出现 A. / B. / C. / D. 等选项格式。",
    ];
  }

  private getQuestionTypeConstraintBlock(questionType: QuestionType): string[] {
    if (questionType === QuestionType.CHOICE) {
      return [
        "【最高优先级：题型一致性门禁】",
        "若与题型约束冲突，视为本次输出失败，必须重写后再输出。",
        ...this.getQuestionTypeHardRules(questionType),
        "【负例（禁止输出）】",
        "- 禁止输出 options 长度不等于 4 的题目。",
        "- 禁止将完整 A/B/C/D 选项正文重复写入 question。",
      ];
    }

    return [
      "【最高优先级：题型一致性门禁】",
      "若与题型约束冲突，视为本次输出失败，必须重写后再输出。",
      ...this.getQuestionTypeHardRules(questionType),
      "【负例（禁止输出）】",
      "- 错误示例：question 出现 A. / B. / C. / D.；此类必须判为选择题并禁止输出。",
      "- 错误示例：非选择题出现 options 非空数组；必须改为 options=[]。",
    ];
  }

  // ====== 单模型提示词（阶段1：仅生成题干）======

  private buildStemOnlySystemPrompt(): string {
    return [
      "你是一位极富创意的资深数学命题专家，擅长出具有高鉴别度、低同质化的优质试题。",
      "",
      "【最高优先级执行原则】",
      "- 先满足题型约束，再考虑创意与多样性。",
      "- 若题型不匹配，必须自检重写，不得输出。",
      "",
      "【铁律：禁止同质化，每道题必须真正不同】",
      "1. 同一批题目中，严禁两道题考察完全相同的运算步骤序列。",
      "2. 严禁两道题的函数主体相同（如同一批里两道都对同一类函数求导）。",
      "3. 数值参数必须多样，禁止连续两题的参数仅差一个常数。",
      "",
      "【本阶段任务：仅生成题干，不需要答案和解析】",
      "请专注于创作高质量的题目内容，确保题干完整、条件清晰、问法明确。",
      "所有数学符号必须用 LaTeX 包裹：行内 $...$，块级 $$...$$，单个字母也不例外。",
      "",
      "【输出格式】只返回 JSON 数组，每个元素只包含题干（选择题 options 填4项，否则空数组）：",
      '[{"id":"uid","question":"含LaTeX","options":[]}]',
      "严禁输出 JSON 以外的任何文字。",
    ].join("\n");
  }

  private buildStemOnlyUserPrompt(config: GenerateConfig, entropy: string, existingProblems: MathProblem[] = []): string {
    const { syllabus, difficulty, questionType, chapter, topic, count, referenceContext } = config;
    const lines = [
      `为 [${syllabus}] 学生出 ${count} 道 [${chapter}] 章节的 [${questionType}] 题干（只需题干，不需要答案和解析），确保每道题风格各异。`,
      "",
      "=== 题型门禁（必须最先满足）===",
      ...this.getQuestionTypeConstraintBlock(questionType),
      "",
      "=== 出题参数 ===",
      `章节：${chapter}`,
      `题型：${questionType}`,
      `难度：${difficulty}（${this.getDifficultyGuidance(difficulty)}）`,
      `额外要求：${topic || "综合考察章节核心内容，兼顾基本公式和综合应用"}`,
      `随机种子：${entropy}`,
    ];

    if (referenceContext) {
      lines.push("");
      lines.push("=== 学生错题/笔记参考资料（重点！请基于这些资料针对性出题）===");
      lines.push("请根据以下学生的错题和笔记，出一些能帮助弥补其知识短板的题目。");
      lines.push("可以考虑：同类题型的变式、错误类型的针对性练习、或笔记中知识点的拓展应用。");
      lines.push("");
      lines.push(referenceContext);
    }

    // 注入已有题目列表，避免重复
    if (existingProblems.length > 0) {
      lines.push("");
      lines.push("=== 已有题目列表（严禁与以下题目重复或雷同）===");
      lines.push("以下是本批次之前已经生成的题目，你必须确保新题目与它们在知识点侧重、函数主体、解题切入角度上完全不同：");
      existingProblems.forEach((p, idx) => {
        lines.push(`题目${idx + 1}：${p.question}`);
      });
    }

    lines.push("");
    lines.push("=== 特别禁止（本批次内）===");
    lines.push("- 禁止两道题函数主体相同。");
    lines.push("- 禁止两道题答案形式完全相同。");
    lines.push("- 禁止套用教材原始例题数据。");
    lines.push("- 禁止连续两题使用同一解题切入角度。");
    lines.push("");
    lines.push(`请输出 ${count} 道题目题干的 JSON 数组（只含 id、question、options，不含 answer 和 explanation）。`);

    return lines.join("\n");
  }

  // ====== 解析阶段提示词（阶段2：为题干生成解析）======

  /**
   * 解析阶段系统提示词 —— 纯作答模式。
   *
   * Why: 不再要求 JSON 或结构化标记，让模型像老师答疑一样自然输出，
   *      输出的原文直接作为题目的解析内容展示给用户。
   */
  private buildExplanationSystemPrompt(): string {
    return [
      "你是一位耐心、专业的数学辅导老师，擅长用清晰易懂的方式为学生答疑解惑。",
      "",
      "【你的任务】",
      "学生会给你一道或多道数学题目，请你逐一作答。",
      "",
      "【回答原则】",
      "1. 先给出本题的正确答案。",
      "2. 然后分步骤展示完整的推导过程，帮助学生理解思路而非仅给结论。",
      "3. 适当指出常见错误和易混淆点。",
      "4. 所有数学公式必须使用 LaTeX 语法：行内用 $...$，块级用 $$...$$。",
      "5. 回答要简洁有条理，避免冗余重复。",
      "6. 如果有多道题目，请用 --- 分隔每道题的解答。",
    ].join("\n");
  }

  /**
   * 解析阶段 user prompt —— 直接提供题目让模型作答。
   *
   * @param stems - 第一阶段已生成的题干列表
   */
  private buildExplanationUserPrompt(stems: MathProblem[]): string {
    const stemsText = stems.map((s, idx) => {
      let text = `题目 ${idx + 1}：${s.question}`;
      if (s.options && s.options.length > 0) {
        text += "\n选项：" + s.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join("　");
      }
      return text;
    }).join("\n\n");

    return [
      "请为以下题目逐一作答，给出正确答案和完整解题过程：",
      "",
      stemsText,
    ].join("\n");
  }

  // ====== 双模型四阶段提示词 ======

  // --- 阶段1a：大模型自由思考，仅构思题干 ---

  private buildStage1SystemPrompt(): string {
    return [
      "你是一位极富创意的资深数学命题专家，擅长出具有高鉴别度、低同质化的优质试题。",
      "",
      "【最高优先级执行原则】",
      "- 先满足题型约束，再考虑创意与多样性。",
      "- 若题型不匹配，必须自检重写，不得输出。",
      "",
      "【出题铁律：拒绝同质方案，每题必须不同】",
      "1. 禁止同批次题目考察完全相同的计算序列。",
      "2. 禁止两道题的函数主体相同。",
      "3. 题目的难点和核心考察必须有多样性。",
      "",
      "【本阶段任务：仅构思题干草稿，不需要答案和解析】",
      "请发挥创意，为每道题设计完整的题目内容和选项（如为选择题），专注于题干的质量与多样性。",
      "可以自由表达你的命题思路，格式不限。",
      "LaTeX 语法：所有数学符号必须使用 LaTeX 语法包裹（行内 $...$，块级 $$...$$）。",
    ].join("\n");
  }

  private buildDualStemThinkingUserPrompt(config: GenerateConfig, entropy: string, existingProblems: MathProblem[] = []): string {
    const { syllabus, difficulty, questionType, chapter, topic, count, referenceContext } = config;
    const lines = [
      `为 [${syllabus}] 学生构思 ${count} 道 [${chapter}] 章节的 [${questionType}] 题干（只需题目内容和选项，不需要答案和解析）。`,
      "",
      "=== 题型门禁（必须最先满足）===",
      ...this.getQuestionTypeConstraintBlock(questionType),
      "",
      "=== 出题参数 ===",
      `章节：${chapter}`,
      `题型：${questionType}`,
      `难度：${difficulty}（${this.getDifficultyGuidance(difficulty)}）`,
      `额外要求：${topic || "综合考察章节核心内容，兼顾基本公式和综合应用"}`,
      `随机种子：${entropy}`,
    ];

    if (referenceContext) {
      lines.push("");
      lines.push("=== 学生错题/笔记参考资料（重点！请基于这些资料针对性出题）===");
      lines.push("请根据以下学生的错题和笔记，出一些能帮助弥补其知识短板的题目。");
      lines.push("可以考虑：同类题型的变式、错误类型的针对性练习、或笔记中知识点的拓展应用。");
      lines.push("");
      lines.push(referenceContext);
    }

    // 注入已有题目列表，避免重复
    if (existingProblems.length > 0) {
      lines.push("");
      lines.push("=== 已有题目列表（严禁与以下题目重复或雷同）===");
      lines.push("以下是本批次之前已经生成的题目，你必须确保新题目与它们在知识点侧重、函数主体、解题切入角度上完全不同：");
      existingProblems.forEach((p, idx) => {
        lines.push(`题目${idx + 1}：${p.question}`);
      });
    }
    return lines.join("\n");
  }

  // --- 阶段1b：小模型格式化题干为 JSON（只含 id/question/options）---

  private buildDualStemFormattingSystemPrompt(): string {
    return [
      "你是一个高效的代码数据格式化助手。你的任务是从数学题目草稿中提取题干信息，转化为 JSON 数组输出。",
      "",
      "【输出要求】",
      "1. 必须输出并仅输出一个 JSON 数组，每个元素只包含题干（不含答案和解析）：",
      '[{"id":"uid","question":"题干内容","options":[]}]',
      "2. 选择题 options 填4项（只含选项内容，不含 A/B/C/D 前缀），非选择题为空数组。",
      "3. 提取所有数学符号时，必须继续使用原本的 LaTeX 语法包裹（行内 $...$，块级 $$...$$）。",
      "4. 严禁输出任何 JSON 以外的文字。",
      "5. 必须提取草稿中的所有完整题目，不得遗漏。",
    ].join("\n");
  }

  private buildDualStemFormattingUserPrompt(draft: string, count: number, questionType: QuestionType): string {
    return [
      `请从以下数学题目草稿中提取所有题干，目标数量为 ${count} 道。`,
      "先执行题型门禁，若冲突必须重写再输出。",
      ...this.getQuestionTypeConstraintBlock(questionType),
      `只输出包含 id、question、options 的 JSON 数组（不含 answer 和 explanation）。`,
      questionType === QuestionType.CHOICE
        ? "题型必须为选择题：每道题 options 必须是 4 项。"
        : `题型必须为「${questionType}」：每道题 options 必须为空数组 []，且 question 里不得出现 A/B/C/D 选项格式。`,
      `如不足 ${count} 道，则提取所有已完成的题目。`,
      "",
      draft,
    ].join("\n");
  }

  // --- 阶段2：大模型为已有题干作答（双模型模式复用同一组提示词）---
  // Why: 双模型模式下原有 4 阶段简化为 3 阶段（1a题干草稿 → 1b格式化题干 → 2大模型作答），
  //      不再需要小模型格式化解析（原 2b 阶段），大模型输出原文即为最终解析。

  // ====== 网络请求底层封装 ======

  private async fetchModelCompletion(
    provider: AIProviderConfig,
    messages: any[],
    onLog: (log: LogEntry) => void,
    isJsonMode: boolean,
    abortSignal?: AbortSignal,
  ): Promise<{ content: string; elapsedSec: string }> {
    // ===== 本地网关转发模式 =====
    if (provider.backendProvider) {
      const startTime = Date.now();
      const gatewayRequestBody = {
        provider: provider.backendProvider,
        model: provider.model,
        messages,
        temperature: provider.temperature,
        max_tokens: provider.maxTokens,
      };
      const adminRequestId = recordModelRequest({
        channel: 'problem_generation_gateway',
        provider,
        requestBody: gatewayRequestBody,
        messages,
      });
      try {
        const data = await aiApi.chat(
          provider.backendProvider,
          provider.model,
          messages,
          {
            temperature: provider.temperature,
            max_tokens: provider.maxTokens,
          },
          abortSignal,
        );
        const content = data?.choices?.[0]?.message?.content ?? '';
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        recordModelResponse({
          requestId: adminRequestId,
          channel: 'problem_generation_gateway',
          provider,
          responseBody: data,
          assistantContent: content,
          usage: extractOpenAIUsage(data?.usage),
          latencyMs: Date.now() - startTime,
          success: true,
        });
        return { content, elapsedSec };
      } catch (err: any) {
        recordModelResponse({
          requestId: adminRequestId,
          channel: 'problem_generation_gateway',
          provider,
          responseBody: null,
          latencyMs: Date.now() - startTime,
          success: false,
          error: err?.message || '本地网关请求失败',
        });
        if (err?.name === 'AbortError' || abortSignal?.aborted) {
          throw err;
        }
        // "Failed to fetch" = 网络层失败（CORS 被拦截、服务未启动或地址不通）
        // "401" / "403"      = 网关鉴权失败（远程网关模式）
        const isFetchError = err.message === 'Failed to fetch' || err.message?.includes('NetworkError');
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `本地网关请求失败：${err.message}`,
          suggestion: isFetchError
            ? '⚠️ 网关请求失败（Failed to fetch）。可能原因：① 本地网关未启动或地址不可达；② CORS_ORIGINS 未包含当前域名；③ VITE_BACKEND_URL 或 VITE_ENABLE_REMOTE_BACKEND 配置有误。'
            : '请检查网关供应商配置，或切换为本地直连 API Key 模式。',
          category: 'network',
          details: '',
        });
        throw err;
      }
    }

    const baseURL = normalizeBaseURL(provider.baseURL);
    const url = `${baseURL}/chat/completions`;
    const startTime = Date.now();
    const requestId = startUsageRequest({
      channel: 'problem_generation',
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
    });

    const TIMEOUT_MS = getTimeoutMs(provider);

    const requestBody: any = {
      model: provider.model,
      messages,
      temperature: isReasoningModel(provider.model) ? undefined : (provider.temperature ?? 1.0),
    };

    const noResponseFormat = isReasoningModel(provider.model)
      || provider.id === 'ollama'
      || provider.id === 'dashscope'
      || /qwen3|qwen-.*-thinking/i.test(provider.model);

    if (isJsonMode && !noResponseFormat) {
      requestBody.response_format = { type: "json_object" };
    }

    if (provider.maxTokens) {
      requestBody.max_tokens = provider.maxTokens;
    }

    const adminRequestId = recordModelRequest({
      channel: 'problem_generation',
      provider,
      requestBody,
      messages,
    });

    try {
      const headers = buildAuthHeaders(provider);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      if (abortSignal) {
        if (abortSignal.aborted) {
          controller.abort();
        } else {
          abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await response.text();
        const { message: userMessage, suggestion, category } = getHttpErrorInfo(
          response.status, provider.model, provider.name,
        );
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: userMessage,
          suggestion,
          category,
          details: '供应商错误详情已隐藏（避免展示模型原始返回内容）。',
        });
        throw new Error(userMessage);
      }

      const data = await response.json();
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const content = data.choices?.[0]?.message?.content || '';
      const usage = extractOpenAIUsage(data.usage);

      if (!content) {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'warn',
          message: `(${provider.name}) 模型返回内容为空。`,
          category: 'model',
          suggestion: '该模型可能不兼容当前请求格式或出现空响。建议在设置中更换模型。',
        });
        throw new Error('模型返回内容为空');
      }

      endUsageRequest({
        requestId,
        success: true,
        latencyMs: Date.now() - startTime,
        usage,
      });

      recordModelResponse({
        requestId: adminRequestId,
        channel: 'problem_generation',
        provider,
        responseBody: data,
        assistantContent: content,
        usage,
        latencyMs: Date.now() - startTime,
        success: true,
      });

      return { content, elapsedSec };
    } catch (error: any) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

      endUsageRequest({
        requestId,
        success: false,
        latencyMs: Date.now() - startTime,
        error: error?.message,
      });

      recordModelResponse({
        requestId: adminRequestId,
        channel: 'problem_generation',
        provider,
        responseBody: null,
        latencyMs: Date.now() - startTime,
        success: false,
        error: error?.message || '模型请求失败',
      });

      if (error.name === 'AbortError') {
        if (abortSignal?.aborted) {
          throw error;
        }
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `(${provider.name}) 请求超时（${TIMEOUT_MS / 1000}s），耗时 ${elapsedSec}s 后中断。`,
          category: 'network',
          suggestion: `当前超时设置为 ${TIMEOUT_MS / 1000} 秒。你可以在设置中增加超时时间，或更换为响应更快的模型。`,
        });
      } else if (error instanceof TypeError && error.message.includes('fetch')) {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `网络连接失败（耗时 ${elapsedSec}s）：无法连接到 ${provider.baseURL}`,
          category: 'network',
          suggestion: '请检查：1) 网络是否正常；2) Base URL 是否正确；3) 如果使用本地模型，确认本地服务已启动。',
        });
      } else if (!error.message?.includes('认证失败') && !error.message?.includes('模型为空')) {
        const safeMessage = this.sanitizeErrorMessage(error.message || '未知错误');
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `(${provider.name}) 生成失败（耗时 ${elapsedSec}s）：${safeMessage}`,
          category: 'system',
          suggestion: '如果问题持续出现，请尝试：1) 刷新页面；2) 重新配置供应商；3) 换一个模型。',
        });
      }
      throw error;
    }
  }

  // ====== 流式网络请求封装 ======

  /**
   * SSE 流式请求：逐 token 回调，用于解析阶段实时输出到 UI。
   *
   * Why: 解析阶段从 JSON 一次性返回改为自由文本流式输出，
   *      用户在骨架屏等待变为实时看到解题过程逐字展现，感知速度大幅提升。
   *
   * @param provider   - AI 供应商配置
   * @param messages   - 完整的 prompt 消息列表
   * @param callbacks  - 流式回调（onToken / onDone / onError）
   * @param onLog      - 日志回调
   * @returns Promise<string> - 完成后返回完整文本
   */
  private async fetchStreamCompletion(
    provider: AIProviderConfig,
    messages: any[],
    callbacks: ExplanationStreamCallbacks,
    onLog: (log: LogEntry) => void,
    abortSignal?: AbortSignal,
  ): Promise<{ content: string; elapsedSec: string }> {
    // 网关转发模式暂不支持流式，回退到非流式 + 模拟一次性推送
    if (provider.backendProvider) {
      const result = await this.fetchModelCompletion(provider, messages, onLog, true, abortSignal);
      callbacks.onToken(result.content);
      callbacks.onDone(result.content);
      return result;
    }

    const baseURL = normalizeBaseURL(provider.baseURL);
    const url = `${baseURL}/chat/completions`;
    const startTime = Date.now();

    const requestId = startUsageRequest({
      channel: 'problem_generation',
      providerId: provider.id,
      providerName: provider.name,
      model: provider.model,
    });

    const TIMEOUT_MS = getTimeoutMs(provider);
    const STREAM_IDLE_TIMEOUT_MS = this.getStreamIdleTimeoutMs(provider);

    const requestBody: any = {
      model: provider.model,
      messages,
      stream: true,
      temperature: isReasoningModel(provider.model) ? undefined : (provider.temperature ?? 1.0),
    };

    if (provider.maxTokens) {
      requestBody.max_tokens = provider.maxTokens;
    }

    const adminRequestId = recordModelRequest({
      channel: 'problem_generation_stream',
      provider,
      requestBody,
      messages,
    });

    let streamIdleTimedOut = false;
    let clearStreamIdleTimer = () => {};
    let resetStreamIdleTimer = () => {};

    try {
      const headers = buildAuthHeaders(provider);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let streamIdleTimer: ReturnType<typeof setTimeout> | null = null;
      clearStreamIdleTimer = () => {
        if (streamIdleTimer) {
          clearTimeout(streamIdleTimer);
          streamIdleTimer = null;
        }
      };
      resetStreamIdleTimer = () => {
        clearStreamIdleTimer();
        if (controller.signal.aborted) {
          return;
        }
        streamIdleTimer = setTimeout(() => {
          streamIdleTimedOut = true;
          controller.abort();
        }, STREAM_IDLE_TIMEOUT_MS);
      };
      if (abortSignal) {
        if (abortSignal.aborted) {
          controller.abort();
        } else {
          abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await response.text();
        const { message: userMessage, suggestion, category } = getHttpErrorInfo(
          response.status, provider.model, provider.name,
        );
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: userMessage,
          suggestion,
          category,
        });
        throw new Error(userMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      resetStreamIdleTimer();

      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      let usageFromStream: any = null;
      let inReasoning = false; // 追踪是否正在输出 reasoning_content（用于 <think> 包裹）

      // 逐 chunk 读取 SSE 流
      while (true) {
        const { done, value } = await reader.read();
        resetStreamIdleTimer();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            if (json.usage) usageFromStream = json.usage;

            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              // 若之前在输出 reasoning_content，先闭合 <think> 标签
              if (inReasoning) {
                fullText += '</think>\n\n';
                callbacks.onToken('</think>\n\n');
                inReasoning = false;
              }
              fullText += delta.content;
              callbacks.onToken(delta.content);
            }
            // 兼容推理模型的 reasoning_content（如 DeepSeek-R1）
            // Why: DeepSeek 推理模型把思考过程放在 delta.reasoning_content 字段，
            //      正文放在 delta.content。用 <think>...</think> 包裹思考内容，
            //      让前端 parseExplanation 能正确识别并折叠。
            if (delta?.reasoning_content) {
              if (!inReasoning) {
                fullText += '<think>';
                callbacks.onToken('<think>');
                inReasoning = true;
              }
              fullText += delta.reasoning_content;
              callbacks.onToken(delta.reasoning_content);
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }

      clearStreamIdleTimer();

      // 流结束时若 reasoning_content 仍未闭合，补上 </think>
      if (inReasoning) {
        fullText += '</think>\n\n';
        inReasoning = false;
      }

      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

      const promptText = messages.map((m: any) =>
        typeof m.content === 'string' ? m.content : ''
      ).join('\n');

      const usage = usageFromStream
        ? extractOpenAIUsage(usageFromStream)
        : {
            promptTokens: estimateTokensFromText(promptText),
            completionTokens: estimateTokensFromText(fullText),
            totalTokens: estimateTokensFromText(promptText) + estimateTokensFromText(fullText),
            estimated: true,
          };

      endUsageRequest({
        requestId,
        success: true,
        latencyMs: Date.now() - startTime,
        usage,
      });

      recordModelResponse({
        requestId: adminRequestId,
        channel: 'problem_generation_stream',
        provider,
        responseBody: { content: fullText, usage, stream: true },
        assistantContent: fullText,
        usage,
        latencyMs: Date.now() - startTime,
        success: true,
      });

      callbacks.onDone(fullText);
      return { content: fullText, elapsedSec };
    } catch (error: any) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      let normalizedError = error;

      if (error?.name === 'AbortError' && !abortSignal?.aborted && typeof error?.message === 'string' && streamIdleTimedOut) {
        normalizedError = new Error(`流式解析在 ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)} 秒内未收到新内容，已自动中断并准备重试。`);
        normalizedError.name = 'StreamIdleTimeoutError';
      }

      endUsageRequest({
        requestId,
        success: false,
        latencyMs: Date.now() - startTime,
        error: normalizedError?.message,
      });

      recordModelResponse({
        requestId: adminRequestId,
        channel: 'problem_generation_stream',
        provider,
        responseBody: null,
        latencyMs: Date.now() - startTime,
        success: false,
        error: normalizedError?.message || '流式模型请求失败',
      });

      callbacks.onError(normalizedError?.message || '流式请求失败');

      if (error.name === 'AbortError') {
        if (abortSignal?.aborted) {
          throw error;
        }
        if (streamIdleTimedOut) {
          onLog({
            timestamp: new Date().toLocaleTimeString(),
            level: 'warn',
            message: `(${provider.name}) 流式解析长时间无输出（>${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s），已自动中断并触发上层重试。`,
            category: 'network',
            suggestion: '这通常是模型流式输出中断或供应商连接卡住。系统已自动重试；若频繁出现，建议增大超时或切换更稳定的模型。',
          });
          throw normalizedError;
        }
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `(${provider.name}) 流式请求超时（${TIMEOUT_MS / 1000}s），耗时 ${elapsedSec}s 后中断。`,
          category: 'network',
        });
      }
      throw normalizedError;
    }
  }

  // ====== 核心生成逻辑 ======

  async generateProblems(
    config: GenerateConfig,
    onLog: (log: LogEntry) => void,
    existingProblems: MathProblem[] = [],
    /**
     * 题干生成完毕时的回调（在解析生成之前触发）。
     * Why: 让 UI 能在解析阶段开始前立即显示题目内容，提升感知速度。
     */
    onStemsReady?: (stems: MathProblem[]) => void,
    /**
      * 流式解析回调：保留类型兼容，当前默认不再由题目生成流程传入。
      * Why: 解析阶段已切换为非流式整段返回，减少状态同步复杂度。
     */
    onExplanationStream?: (token: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<MathProblem[]> {
    if (this.dualModelConfig.enabled && this.dualModelConfig.provider) {
      return this.generateDualStage(config, onLog, existingProblems, onStemsReady, onExplanationStream, abortSignal);
    }
    return this.generateSingleStage(config, onLog, existingProblems, onStemsReady, onExplanationStream, abortSignal);
  }

  private async generateSingleStage(
    config: GenerateConfig,
    onLog: (log: LogEntry) => void,
    existingProblems: MathProblem[] = [],
    onStemsReady?: (stems: MathProblem[]) => void,
    onExplanationStream?: (token: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<MathProblem[]> {
    const { syllabus, difficulty, questionType, chapter, count } = config;

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `正在为 [${syllabus}] 的 [${chapter}] 章节生成 [${count}道] 多样化 [${questionType}]（两阶段）...`,
    });

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `使用单模型（两阶段）: ${this.providerConfig.name} | ${this.providerConfig.model}`,
    });

    if (config.referenceContext) {
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: `已注入参考资料（${config.referenceContext.length} 字符），将针对性出题`,
      });
    }

    if (isReasoningModel(this.providerConfig.model)) {
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `检测到推理模型，两阶段各可能需要较长时间，请耐心等待...`,
      });
    }

    const entropy = (Math.random() * 1e7).toFixed(0) + "_" + Date.now();

    // ===== 阶段1/2：生成题干 =====
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `[阶段1/2] 正在生成题干...`,
    });

    const stemMessages = [
      { role: "system", content: this.buildStemOnlySystemPrompt() },
      { role: "user", content: this.buildStemOnlyUserPrompt(config, entropy, existingProblems) },
    ];

    const { content: stemContent, elapsedSec: elapsed1 } = await this.fetchModelCompletion(this.providerConfig, stemMessages, onLog, true, abortSignal);

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `[阶段1/2] 题干生成完成（耗时 ${elapsed1}s，${stemContent.length} 字符），正在解析...`,
    });

    const parsedStems = this.parseWithRetry(stemContent, onLog);
    const mappedStems = this.mapToMathProblems(parsedStems, config, difficulty, questionType);
    const stems = this.enforceQuestionTypeForStems(mappedStems, questionType, onLog);

    if (stems.length === 0) {
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'error',
        message: `[阶段1/2] 题干解析失败（共 0 道），无法继续生成解析。建议减少单次出题数量后重试。`,
        category: 'parse',
      });
      throw new Error('题干解析失败：未解析到有效题干。Hint: 请减少单次数量或更换模型后重试。');
    }

    // 题干生成完毕，立即通知 UI 显示
    onStemsReady?.(stems);

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `成功解析 ${stems.length} 道题干，即将生成解析...`,
    });

    // ===== 阶段2/2：生成解析 =====
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `[阶段2/2] 正在为 ${stems.length} 道题目生成答案和解析（非流式整段返回）...`,
    });

    const explanationMessages = [
      { role: "system", content: this.buildExplanationSystemPrompt() },
      { role: "user", content: this.buildExplanationUserPrompt(stems) },
    ];

    let expText: string;
    let elapsed2: string;

    // ===== 非流式路径：等待完整解析后一次性回填 =====
    const result = await this.fetchModelCompletion(this.providerConfig, explanationMessages, onLog, false, abortSignal);
    expText = result.content;
    elapsed2 = result.elapsedSec;

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'debug',
      message: `[阶段2/2] 解析完成（耗时 ${elapsed2}s，${expText.length} 字符）。`,
    });

    // 纯作答模式：模型输出原文直接作为解析内容，不再提取结构化数据
    const problems = this.assignRawExplanation(stems, expText);

    const totalElapsed = (parseFloat(elapsed1) + parseFloat(elapsed2)).toFixed(1);
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `生成成功：两阶段共产出 ${problems.length} 道高质量题目（总耗时 ${totalElapsed}s）。`,
    });

    return problems;
  }

  private async generateDualStage(
    config: GenerateConfig,
    onLog: (log: LogEntry) => void,
    existingProblems: MathProblem[] = [],
    onStemsReady?: (stems: MathProblem[]) => void,
    onExplanationStream?: (token: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<MathProblem[]> {
    const { syllabus, difficulty, questionType, chapter, count } = config;
    const bigModel = this.providerConfig;
    const smallModel = this.dualModelConfig.provider!;

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `开启双模型三阶段模式，开始构思 [${count}道] [${questionType}]...`,
    });

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `大模型: ${bigModel.name} | ${bigModel.model}　　小模型: ${smallModel.name} | ${smallModel.model}`,
    });

    const entropy = (Math.random() * 1e7).toFixed(0) + "_" + Date.now();

    // ===== 阶段1a/4：大模型自由思考，生成题干草稿 =====
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `[阶段1a/4] 大模型正在自由构思题干草稿...`,
    });

    const stage1aMessages = [
      { role: "system", content: this.buildStage1SystemPrompt() },
      { role: "user", content: this.buildDualStemThinkingUserPrompt(config, entropy, existingProblems) },
    ];

    const { content: stemDraft, elapsedSec: elapsed1a } = await this.fetchModelCompletion(bigModel, stage1aMessages, onLog, false, abortSignal);

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `[阶段1a/4] 题干草稿完成（耗时 ${elapsed1a}s，${stemDraft.length} 字符）。`,
    });

    // ===== 阶段1b/4：小模型格式化题干为 JSON =====
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `[阶段1b/4] 小模型正在格式化题干为 JSON...`,
    });

    const stage1bMessages = [
      { role: "system", content: this.buildDualStemFormattingSystemPrompt() },
      { role: "user", content: this.buildDualStemFormattingUserPrompt(stemDraft, count, questionType) },
    ];

    const { content: stemJson, elapsedSec: elapsed1b } = await this.fetchModelCompletion(smallModel, stage1bMessages, onLog, true, abortSignal);

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `[阶段1b/4] 题干格式化完成（耗时 ${elapsed1b}s）。`,
    });

    const parsedStems = this.parseWithRetry(stemJson, onLog);
    const mappedStems = this.mapToMathProblems(parsedStems, config, difficulty, questionType);
    const stems = this.enforceQuestionTypeForStems(mappedStems, questionType, onLog);

    if (stems.length === 0) {
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'error',
        message: `题干解析失败（共 0 道题干），无法继续生成解析。建议减少单次出题数量后重试。`,
        category: 'parse',
      });
      throw new Error('题干解析失败：未解析到有效题干。Hint: 请减少单次数量或更换模型后重试。');
    }

    // 题干格式化完毕，立即通知 UI 显示
    onStemsReady?.(stems);

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `成功解析 ${stems.length} 道题干，开始深度解析...`,
    });

    // ===== 阶段2/3：大模型为题干作答 =====
    const explanationMessages = [
      { role: "system", content: this.buildExplanationSystemPrompt() },
      { role: "user", content: this.buildExplanationUserPrompt(stems) },
    ];

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `[阶段2/3] 大模型正在为 ${stems.length} 道题目作答（非流式整段返回）...`,
    });

    let expText: string;
    let elapsed2: string;

    // ===== 非流式路径：等待完整解析后一次性回填 =====
    const result = await this.fetchModelCompletion(bigModel, explanationMessages, onLog, false, abortSignal);
    expText = result.content;
    elapsed2 = result.elapsedSec;

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'debug',
      message: `[阶段2/3] 解析完成（耗时 ${elapsed2}s，${expText.length} 字符）。`,
    });

    // 纯作答模式：模型输出原文直接作为解析内容
    const problems = this.assignRawExplanation(stems, expText);

    if (problems.length < count) {
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `注意：请求 ${count} 道题目，实际获得 ${problems.length} 道。`,
        category: 'model',
        suggestion: `可能是大模型阶段1a未生成足够数量的题干（草稿 ${stemDraft.length} 字符）。建议：1) 减少单次出题数量；2) 增加大模型超时时间。`,
      });
    }

    const totalElapsed = (parseFloat(elapsed1a) + parseFloat(elapsed1b) + parseFloat(elapsed2)).toFixed(1);
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `生成成功：三阶段共产出 ${problems.length} 道高质量题目（总耗时 ${totalElapsed}s）。`,
    });

    return problems;
  }

  /**
   * 将模型原文直接赋给所有题干的 explanation 字段。
   *
   * Why: 纯作答模式下模型不输出 JSON，输出的原文涵盖所有题目的解答，
   *      直接将完整文本赋给每道题的 explanation 即可在 UI 中展示。
   *
   * @param stems   - 第一阶段题干列表
   * @param rawText - 模型解答原文
   * @returns 填充了 explanation 的 MathProblem 列表
   */
  private assignRawExplanation(stems: MathProblem[], rawText: string): MathProblem[] {
    const normalizedText = (rawText || '').trim();

    if (!normalizedText) {
      return stems.map((stem) => ({
        ...stem,
        answer: '',
        explanation: '模型未返回有效解析内容，请重试或更换模型。',
      }));
    }

    return stems.map((stem) => ({
      ...stem,
      answer: '',
      explanation: normalizedText,
    }));
  }

  private containsChoicePattern(text: string): boolean {
    if (!text) return false;
    const normalized = text.replace(/\s+/g, ' ').toUpperCase();
    return /(?:^|\s)(A[\.、\)）]|B[\.、\)）]|C[\.、\)）]|D[\.、\)）])/.test(normalized)
      || /选项/.test(text);
  }

  /**
   * 题型结构守卫：防止「要求计算题却输出选择题」等题型漂移。
   *
   * @throws 当所有题干都不满足题型约束时抛错，交由上层重试。
   */
  private enforceQuestionTypeForStems(
    stems: MathProblem[],
    questionType: QuestionType,
    onLog: (log: LogEntry) => void,
  ): MathProblem[] {
    const normalized: MathProblem[] = [];

    stems.forEach((stem, idx) => {
      const options = Array.isArray(stem.options)
        ? stem.options.map(option => String(option).trim()).filter(Boolean)
        : [];

      if (questionType === QuestionType.CHOICE) {
        if (options.length !== 4) {
          onLog({
            timestamp: new Date().toLocaleTimeString(),
            level: 'warn',
            message: `题型校验未通过：第 ${idx + 1} 题应为选择题，但选项数量为 ${options.length}。已丢弃该题。`,
            category: 'model',
          });
          return;
        }
        normalized.push({ ...stem, options });
        return;
      }

      if (this.containsChoicePattern(stem.question || '')) {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'warn',
          message: `题型校验未通过：第 ${idx + 1} 题包含 A/B/C/D 选项格式，但当前要求为「${questionType}」。已丢弃该题。`,
          category: 'model',
        });
        return;
      }

      normalized.push({ ...stem, options: [] });
    });

    if (normalized.length === 0) {
      throw new Error(`题型校验失败：未获得符合「${questionType}」的题干。Hint: 请降低温度或更换模型后重试。`);
    }

    if (normalized.length < stems.length) {
      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'warn',
        message: `题型纠偏：已过滤 ${stems.length - normalized.length} 道不符合「${questionType}」的题目。`,
        category: 'model',
      });
    }

    return normalized;
  }

  private mapToMathProblems(parsed: any, config: GenerateConfig, difficulty: Difficulty, questionType: QuestionType): MathProblem[] {
    const problemsArray = Array.isArray(parsed) ? parsed : (parsed.problems || parsed.data || parsed.questions || []);

    // 模型常见占位 id（如 "uid"、"id"、"1"、"question_1" 等），不可用于全局唯一标识。
    // Why: 并行模式下若 id 相同，解析回填会按 id 串题覆盖，最终多题显示为同一题。
    const isPlaceholderId = (id: any): boolean => {
      const raw = String(id ?? '').trim();
      if (!raw) return true;
      const normalized = raw.toLowerCase();
      const placeholderSet = new Set([
        'uid',
        'id',
        'temp',
        'placeholder',
        'question',
        'problem',
      ]);
      if (placeholderSet.has(normalized)) return true;
      if (/^\d+$/.test(normalized)) return true;
      if (/^(question|problem|item|q)[_-]?\d+$/.test(normalized)) return true;
      return false;
    };

    const usedIds = new Set<string>();

    return problemsArray.map((p: any) => ({
      ...p,
      id: (() => {
        const candidate = String(p.id ?? '').trim();
        const shouldRegenerate = isPlaceholderId(candidate) || usedIds.has(candidate);
        const resolved = shouldRegenerate ? crypto.randomUUID() : candidate;
        usedIds.add(resolved);
        return resolved;
      })(),
      options: p.options || [],
      suggestedErrorTypes: [],
      difficulty,
      syllabus: config.syllabus,
      questionType,
    }));
  }

  /**
   * 在 JSON 字符串内部保护 LaTeX 反斜杠，避免 \frac / \right / \theta 等命令
   * 被 JSON.parse 误当成 \f / \r / \t 等转义序列吞掉。
   */
  private protectLatexBackslashesInJson(text: string): { normalized: string; replacements: number } {
    let normalized = '';
    let inString = false;
    let replacements = 0;

    for (let index = 0; index < text.length; index += 1) {
      const currentChar = text[index];

      if (!inString) {
        normalized += currentChar;
        if (currentChar === '"') {
          inString = true;
        }
        continue;
      }

      if (currentChar === '"') {
        normalized += currentChar;
        inString = false;
        continue;
      }

      if (currentChar !== '\\') {
        normalized += currentChar;
        continue;
      }

      const nextChar = text[index + 1];
      if (!nextChar) {
        normalized += '\\\\';
        replacements += 1;
        continue;
      }

      if (this.shouldPreserveJsonEscape(nextChar, text, index + 1)) {
        normalized += currentChar + nextChar;
        index += 1;
        continue;
      }

      normalized += '\\\\';
      replacements += 1;
    }

    return { normalized, replacements };
  }

  /**
   * 判断当前反斜杠是否属于合法且应保留的 JSON 转义。
   * 若是 LaTeX 命令的起始反斜杠，则返回 false，后续会自动补成双反斜杠。
   */
  private shouldPreserveJsonEscape(nextChar: string, source: string, nextIndex: number): boolean {
    if (nextChar === '"' || nextChar === '\\' || nextChar === '/') {
      return true;
    }

    if (nextChar === 'u') {
      const unicodeBody = source.slice(nextIndex + 1, nextIndex + 5);
      if (/^[0-9a-fA-F]{4}$/.test(unicodeBody)) {
        return true;
      }

      return !this.isLikelyLatexCommand(source, nextIndex);
    }

    if (!'bfnrt'.includes(nextChar)) {
      return false;
    }

    return !this.isLikelyLatexCommand(source, nextIndex);
  }

  /**
   * 仅对白名单中的数学 LaTeX 命令做自动保护，避免误伤正常的 \n / \t 等 JSON 转义。
   */
  private isLikelyLatexCommand(source: string, startIndex: number): boolean {
    const commandMatch = source.slice(startIndex).match(/^[A-Za-z]+/);
    if (!commandMatch) {
      return false;
    }

    const command = commandMatch[0].toLowerCase();
    const latexCommands = [
      'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'nu', 'pi', 'phi', 'psi', 'sigma',
      'frac', 'dfrac', 'tfrac', 'sqrt', 'sum', 'prod', 'int', 'iint', 'iiint', 'oint', 'lim',
      'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log',
      'left', 'right', 'begin', 'end', 'text', 'mathrm', 'mathbf', 'mathbb', 'mathcal', 'displaystyle',
      'cdot', 'times', 'div', 'pm', 'mp', 'leq', 'geq', 'neq', 'approx', 'infty', 'partial', 'nabla',
      'rightarrow', 'leftarrow', 'leftrightarrow', 'to', 'mapsto', 'because', 'therefore',
      'underline', 'overline', 'overrightarrow', 'hat', 'bar', 'vec', 'quad', 'qquad', 'boxed'
    ];

    return latexCommands.some((candidate) => command === candidate || command.startsWith(candidate));
  }

  /**
   * 仅转义 JSON 字符串内部的裸换行，避免误伤外层 JSON 排版。
   */
  private escapeRawLineBreaksInJsonStrings(text: string): string {
    let normalized = '';
    let inString = false;

    for (let index = 0; index < text.length; index += 1) {
      const currentChar = text[index];

      if (!inString) {
        normalized += currentChar;
        if (currentChar === '"') {
          inString = true;
        }
        continue;
      }

      if (currentChar === '"') {
        normalized += currentChar;
        inString = false;
        continue;
      }

      if (currentChar === '\\') {
        normalized += currentChar;
        if (index + 1 < text.length) {
          normalized += text[index + 1];
          index += 1;
        }
        continue;
      }

      if (currentChar === '\n') {
        normalized += '\\n';
        continue;
      }

      if (currentChar === '\r') {
        normalized += '\\r';
        continue;
      }

      normalized += currentChar;
    }

    return normalized;
  }

  private parseWithRetry(text: string, onLog?: (log: LogEntry) => void): any {
    let jsonString = text.trim();

    const thinkMatch = jsonString.match(/<think>[\s\S]*?<\/think>\s*([\s\S]*)/);
    if (thinkMatch) {
      jsonString = thinkMatch[1].trim();
    }

    const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1].trim();
    }

    const arrayMatch = jsonString.match(/\[[\s\S]*\]/);
    const objectMatch = jsonString.match(/\{[\s\S]*\}/);

    if (arrayMatch) {
      jsonString = arrayMatch[0];
    } else if (objectMatch) {
      jsonString = objectMatch[0];
    }

    if (!jsonString || jsonString === '[]' || jsonString === '{}') {
      return [];
    }

    const protectedJson = this.protectLatexBackslashesInJson(jsonString);

    try {
      if (protectedJson.replacements > 0 && onLog) {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'warn',
          message: `已自动修复 ${protectedJson.replacements} 处公式转义，避免 LaTeX 乱码。`,
          category: 'parse',
          suggestion: '若仍出现公式乱码，建议切换模型后重新生成。',
        });
      }

      return JSON.parse(protectedJson.normalized);
    } catch (e) {
      try {
        const fixed = protectedJson.normalized.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
        return JSON.parse(fixed);
      } catch (e2) {
        const fixed2 = this.escapeRawLineBreaksInJsonStrings(protectedJson.normalized);
        try {
          return JSON.parse(fixed2);
        } catch (e3) {
          const fixed3 = fixed2.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
          try {
            return JSON.parse(fixed3);
          } catch (e4) {
            console.error("JSON 解析彻底失败:", e);
            if (onLog) {
              onLog({
                timestamp: new Date().toLocaleTimeString(),
                level: 'warn',
                message: `模型返回了内容但未能解析出题目。`,
                category: 'parse',
                suggestion: '可能的原因：1) 模型输出了非 JSON 格式的文本；2) JSON 中的 LaTeX 公式导致了格式错误。建议更换模型重试。',
                details: '解析详情已隐藏（避免展示模型原始返回内容）。',
              });
            }
            return [];
          }
        }
      }
    }
  }

  // ====== 图片扫描识别：多模态题目收录 ======

  /**
   * 使用多模态大模型分析图片，自动提取其中的数学题目。
   * 返回可直接存入题库的 QBankItem 列表。
   */
  async scanImagesForProblems(
    images: string[],
    onLog: (log: LogEntry) => void,
    folderId: string = DEFAULT_QBANK_FOLDER_ID
  ): Promise<QBankItem[]> {
    if (images.length === 0) return [];

    const provider = this.providerConfig;
    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: `图片识别：正在分析 ${images.length} 张图片，使用 ${provider.name} / ${provider.model}...`,
    });

    const imageContents = images.map(base64 => ({
      type: 'image_url',
      image_url: { url: base64 }
    }));

    const systemPrompt = [
      '你是一个专业的数学题目提取助手，负责从图片中精确识别并结构化所有数学题目。',
      '',
      '【任务】：仔细分析图片，提取其中所有可见的数学题目，返回 JSON 数组。',
      '',
      '【输出格式】只输出 JSON 数组，每个题目结构如下：',
      '[{"question":"题干（含LaTeX）","options":["A...","B...","C...","D..."],"answer":"答案（含LaTeX）","explanation":"解析（若图中有则填写，否则填空字符串）","tags":["标签1","标签2"]}]',
      '',
      '【注意事项】：',
      '1. 所有数学公式和符号必须转为 LaTeX 格式，行内用 $...$，块级用 $$...$$。',
      '2. 选择题 options 填入4个选项（不含A/B/C/D字母），非选择题 options 为空数组。',
      '3. 如果图中没有解析，explanation 留空字符串。',
      '4. tags 可根据题目内容推断，例如["微积分","极限","导数"]，最多3个。',
      '5. 只输出 JSON，不输出任何其他文字。',
    ].join('\n');

    const userContent: any[] = [
      ...imageContents,
      {
        type: 'text',
        text: '请识别这些图片中的所有数学题目，以 JSON 数组格式输出。'
      }
    ];

    const baseURL = normalizeBaseURL(provider.baseURL);
    const url = `${baseURL}/chat/completions`;
    const TIMEOUT_MS = getTimeoutMs(provider);
    const startTime = Date.now();

    try {
      const headers = buildAuthHeaders(provider);

      const requestBody: any = {
        model: provider.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.3,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await response.text();
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `图片识别失败（HTTP ${response.status}）。`,
          category: 'model',
          suggestion: '请确认当前模型支持视觉/多模态功能（如 gpt-4o、qwen-vl 等）。',
        });
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const content = data.choices?.[0]?.message?.content || '';

      if (!content) {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'warn',
          message: '图片识别返回内容为空，请确认当前模型支持视觉输入。',
          suggestion: '建议使用支持多模态的模型，例如 gpt-4o、claude-3-opus、qwen-vl-plus 等。',
        });
        return [];
      }

      const parsed = this.parseWithRetry(content, onLog);
      const problemsArray: any[] = Array.isArray(parsed) ? parsed : [];

      const now = Date.now();
      const items: QBankItem[] = problemsArray.map((p: any, idx: number) => ({
        id: 'qb_' + now + '_' + idx + '_' + Math.random().toString(36).slice(2, 6),
        question: p.question || '',
        options: Array.isArray(p.options) ? p.options : [],
        answer: p.answer || '',
        explanation: p.explanation || '',
        tags: Array.isArray(p.tags) ? p.tags : [],
        folderId,
        source: 'image_scan' as const,
        sourceNote: `图片扫描 ${new Date().toLocaleDateString()}`,
        images: images.length === 1 ? [images[0]] : [],
        createdAt: now,
        updatedAt: now,
      }));

      onLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'success',
        message: `图片识别完成（耗时 ${elapsedSec}s），共提取 ${items.length} 道题目。`,
      });

      return items;
    } catch (error: any) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      if (error.name === 'AbortError') {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `图片识别超时（${TIMEOUT_MS / 1000}s），耗时 ${elapsedSec}s 后中断。`,
          category: 'network',
        });
      } else {
        onLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'error',
          message: `图片识别失败（耗时 ${elapsedSec}s）：${error.message}`,
          category: 'system',
        });
      }
      throw error;
    }
  }
}
