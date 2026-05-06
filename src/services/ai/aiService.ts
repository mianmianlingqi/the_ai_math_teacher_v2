import { AIProviderConfig, DualModelConfig, GenerateConfig, MathProblem, LogEntry, Difficulty, QuestionType, QBankItem, DEFAULT_QBANK_FOLDER_ID } from "@/types";
import { endUsageRequest, extractOpenAIUsage, startUsageRequest, estimateTokensFromText } from "./devUsageTracker";
import { aiApi, tokenStore, BACKEND_BASE_URL } from "../api/backendApi";
import { isReasoningModel, normalizeBaseURL, buildAuthHeaders, getTimeoutMs, getHttpErrorInfo } from "./httpClient";
import { recordModelRequest, recordModelResponse } from "../dev/adminConsoleStore";
import { parseWithRetry } from "./jsonParser";
import {
  buildStemSystemPrompt, buildStemUserPrompt,
  buildExplanationSystemPrompt, buildExplanationUserPrompt,
  getQuestionTypeConstraintBlock, getDifficultyGuidance,
} from "./prompts";

/**
 * 通用 AI 服务 - 基于 OpenAI 兼容 API 格式
 */
export class UnifiedAIService {
  private providerConfig: AIProviderConfig;
  private dualModelConfig: DualModelConfig;

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
      { role: "system", content: buildStemSystemPrompt() },
      { role: "user", content: buildStemUserPrompt(config, entropy, existingProblems) },
    ];

    const { content: stemContent, elapsedSec: elapsed1 } = await this.fetchModelCompletion(this.providerConfig, stemMessages, onLog, true, abortSignal);

    onLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `[阶段1/2] 题干生成完成（耗时 ${elapsed1}s，${stemContent.length} 字符），正在解析...`,
    });

    const parsedStems = parseWithRetry(stemContent, onLog);
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
      { role: "system", content: buildExplanationSystemPrompt() },
      { role: "user", content: buildExplanationUserPrompt(stems) },
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

      const parsed = parseWithRetry(content, onLog);
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
