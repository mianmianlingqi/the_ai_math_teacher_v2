
import { AIProviderConfig, QBankItem, Difficulty, QuestionType, Syllabus } from '@/types';
import { extractOpenAIUsage } from './devUsageTracker';
import { recordModelRequest, recordModelResponse } from '../dev/adminConsoleStore';

const VISION_SCAN_PROMPT = `
请分析这张图片，识别其中的所有数学题目，并将其转换为结构化的 JSON 数据。

【核心要求】
- 如果图片里有多道题，必须全部识别出来，按阅读顺序输出。
- 不允许只返回第一道题。
- 若只有一道题，也要放在数组里返回。

【要求】
1. **题干 (question)**: 
   - 提取完整的题目描述。
   - 所有数学公式必须转换成标准的 LaTeX 格式（行内用 $...$, 独立行用 $$...$$）。
2. **选项 (options)**: 
   - 如果是选择题，提取所有选项内容（不包含 A. B. C. D. 等前缀）。
   - 如果不是选择题，返回空数组。
3. **题型 (questionType)**: 根据内容推断题型（选择题/填空题/计算题/证明题/应用题/综合题）。
4. **答案 (answer)**: 如果图片中包含答案或解析，请提取；如果没有，请你自己**做一遍这道题**，给出正确答案。
5. **解析 (explanation)**: 如果图片包含解析，请提取；如果没有，请你自己**详细撰写解析**，包含解题步骤和思维逻辑。
6. **标签 (tags)**: 根据题目内容生成 3-5 个知识点标签。
7. **难度 (difficulty)**: 预估题目难度（较简单/中等/较难）。
8. **大纲 (syllabus)**: 推断所属考纲（考研数学/专升本数学/高考数学）。

请直接返回 JSON 对象，格式如下：
{
  "questions": [
    {
      "question": "题干文本（含LaTeX）",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "questionType": "题型",
      "answer": "答案（含LaTeX）",
      "explanation": "详细解析（含LaTeX）",
      "tags": ["标签1", "标签2", "标签3"],
      "difficulty": "难度",
      "syllabus": "大纲"
    }
  ]
}

严禁输出 JSON 以外的任何文字。
请特别注意：JSON 字符串中的反斜杠必须正确转义（例如 LaTeX 在 JSON 中要写成 \\\\frac 而不是 \\frac）。
`;

function extractJsonPayload(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const first = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (first === -1) return trimmed;

  const lastObj = trimmed.lastIndexOf('}');
  const lastArr = trimmed.lastIndexOf(']');
  const last = Math.max(lastObj, lastArr);
  if (last > first) {
    return trimmed.slice(first, last + 1).trim();
  }

  return trimmed.slice(first).trim();
}

function parseModelJson(raw: string): any {
  const payload = extractJsonPayload(raw);
  if (!payload) {
    throw new Error('模型返回为空');
  }

  try {
    return JSON.parse(payload);
  } catch (error: any) {
    const msg = error?.message || '';
    throw new Error(
      `模型返回的 JSON 格式不完整或被截断（${msg}）。请重试；若仍失败，请减少单图题量、提高模型 max_tokens，或换更稳定的视觉模型。`
    );
  }
}

function resolveVisionModels(provider: AIProviderConfig): string[] {
  const rawModel = (provider.model || '').trim();
  if (!rawModel) return [];

  // Moonshot / Kimi: 兼容别名（UI 里可显示 k2 / k2.5）
  // 实际请求需使用可调用的 model id；k2.5 不可用时自动回退 k2
  if (provider.id === 'moonshot') {
    const key = rawModel.toLowerCase();
    if (key === 'k2.5') return ['kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'moonshot-v1-auto'];
    if (key === 'k2') return ['kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'moonshot-v1-auto'];
  }

  return [rawModel];
}

/**
 * 使用 OpenAI 兼容 API 的视觉模型识别图片中的数学题目
 */
export async function scanImageWithVisionAPI(
  provider: AIProviderConfig,
  imageBase64: string
): Promise<Partial<QBankItem>[]> {
  const baseURL = provider.baseURL.replace(/\/+$/, '');
  const url = `${baseURL}/chat/completions`;
  const TIMEOUT_MS = (provider.timeout ?? 120) * 1000;

  // 确保 base64 数据有正确的前缀
  const imageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  const candidateModels = resolveVisionModels(provider);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let parsed: any = null;
    let resolvedModel = candidateModels[0] || provider.model;
    let lastStatus = 0;

    for (let index = 0; index < candidateModels.length; index++) {
      const model = candidateModels[index];
      const startTime = Date.now();
      const requestBody = {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_SCAN_PROMPT },
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: provider.maxTokens || 8192,
        temperature: provider.temperature ?? 0.3,
        response_format: { type: 'json_object' },
      };
      const activeProvider = { ...provider, model };
      const adminRequestId = recordModelRequest({
        channel: 'vision_scan',
        provider: activeProvider,
        requestBody,
        messages: requestBody.messages,
      });
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        lastStatus = response.status;
        const canFallback = response.status === 404 && /resource_not_found_error|model/i.test(errText);
        if (canFallback && index < candidateModels.length - 1) {
          recordModelResponse({
            requestId: adminRequestId,
            channel: 'vision_scan',
            provider: activeProvider,
            responseBody: { status: response.status, error: errText, fallback: true },
            latencyMs: Date.now() - startTime,
            success: false,
            error: '视觉模型不可用，尝试自动回退。',
          });
          continue;
        }
        recordModelResponse({
          requestId: adminRequestId,
          channel: 'vision_scan',
          provider: activeProvider,
          responseBody: { status: response.status, error: errText },
          latencyMs: Date.now() - startTime,
          success: false,
          error: `视觉识别请求失败（HTTP ${response.status}）`,
        });
        if (response.status === 401 || response.status === 403) {
          throw new Error('视觉识别认证失败，请检查 API Key 是否有效');
        }
        if (response.status === 404) {
          throw new Error('视觉识别模型不可用，请检查模型名称或切换模型');
        }
        if (response.status === 429) {
          throw new Error('视觉识别请求过于频繁，请稍后重试');
        }
        if (response.status >= 500) {
          throw new Error('视觉识别服务暂时不可用，请稍后重试');
        }
        throw new Error(`视觉识别请求失败（HTTP ${response.status}）`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        recordModelResponse({
          requestId: adminRequestId,
          channel: 'vision_scan',
          provider: activeProvider,
          responseBody: data,
          latencyMs: Date.now() - startTime,
          success: false,
          error: '模型未返回有效内容',
        });
        throw new Error('模型未返回有效内容');
      }
      parsed = parseModelJson(content);
      recordModelResponse({
        requestId: adminRequestId,
        channel: 'vision_scan',
        provider: activeProvider,
        responseBody: data,
        assistantContent: content,
        usage: extractOpenAIUsage(data?.usage),
        latencyMs: Date.now() - startTime,
        success: true,
      });
      resolvedModel = model;
      break;
    }

    clearTimeout(timeoutId);

    if (!parsed) {
      if (lastStatus > 0) {
        throw new Error(`视觉识别模型调用失败（HTTP ${lastStatus}）`);
      }
      throw new Error('视觉识别模型调用失败');
    }

    const rawQuestions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.questions)
        ? parsed.questions
        : [parsed];

    const typeMap: Record<string, QuestionType> = {
      '选择题': QuestionType.CHOICE,
      '填空题': QuestionType.FILL_BLANK,
      '计算题': QuestionType.CALCULATION,
      '证明题': QuestionType.PROOF,
      '应用题': QuestionType.APPLICATION,
      '综合题': QuestionType.COMPREHENSIVE,
    };

    const diffMap: Record<string, Difficulty> = {
      '较简单': Difficulty.EASY,
      '简单': Difficulty.EASY,
      '中等': Difficulty.MEDIUM,
      '较难': Difficulty.HARD,
      '困难': Difficulty.HARD,
    };

    const syllabusMap: Record<string, Syllabus> = {
      '考研数学': Syllabus.POSTGRADUATE,
      '专升本数学': Syllabus.UNDERGRADUATE_TRANSITION,
      '高考数学': Syllabus.GAOKAO,
    };

    const normalized: Partial<QBankItem>[] = rawQuestions
      .map((one: any) => {
        const result: Partial<QBankItem> = {
          question: one?.question || '',
          options: Array.isArray(one?.options) ? one.options : [],
          answer: one?.answer || '',
          explanation: one?.explanation || '',
          tags: Array.isArray(one?.tags) ? one.tags : [],
          sourceNote: `OCR 识别 (${resolvedModel})`,
        };

        if (one?.questionType) {
          result.questionType = typeMap[one.questionType] || one.questionType;
        }
        if (one?.difficulty) {
          result.difficulty = diffMap[one.difficulty] || one.difficulty;
        }
        if (one?.syllabus) {
          result.syllabus = syllabusMap[one.syllabus] || one.syllabus;
        }
        return result;
      })
      .filter((item) => (item.question || '').trim().length > 0);

    return normalized;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`视觉识别请求超时（${provider.timeout ?? 120}秒），请检查网络或增大超时设置`);
    }
    throw error;
  }
}
