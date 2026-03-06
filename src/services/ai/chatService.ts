
import { AIProviderConfig, ChatMessage } from '@/types';
import { endUsageRequest, estimateTokensFromText, extractOpenAIUsage, startUsageRequest } from './devUsageTracker';
import { isReasoningModel, normalizeBaseURL, buildAuthHeaders, getTimeoutMs, getHttpErrorInfo } from './httpClient';

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB`;
};

const CHAT_SYSTEM_PROMPT = [
  "你是一位耐心、专业的数学辅导老师，擅长用清晰易懂的方式为学生答疑解惑。",
  "",
  "【回答原则】",
  "1. 如果学生选择了具体题目来提问，请围绕该题目进行分析、讲解和拓展。",
  "2. 如果学生没有选择题目，直接询问知识点，请给出系统全面的讲解。",
  "3. 所有数学公式必须使用 LaTeX 语法：行内用 $...$，块级用 $$...$$。",
  "4. 关键步骤请分步骤展示推导过程，帮助学生理解思路而非仅给结论。",
  "5. 适当指出常见错误和易混淆点。",
  "6. 回答要简洁有条理，避免冗余重复。",
].join("\n");

export interface ChatStreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
}

/**
 * 流式对话请求（SSE）
 */
export async function streamChat(
  provider: AIProviderConfig,
  messages: ChatMessage[],
  callbacks: ChatStreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const baseURL = normalizeBaseURL(provider.baseURL);
  const url = `${baseURL}/chat/completions`;

  const TIMEOUT_MS = getTimeoutMs(provider);

  // 构建消息数组：system + 历史消息
  const apiMessages: { role: string; content: string }[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
  ];

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    let content = msg.content;
    // 如果有引用题目，在用户消息前加上题目上下文
    if (msg.role === 'user' && msg.referencedProblem) {
      const ref = msg.referencedProblem;
      content = [
        `【参考题目】来源：${ref.source}`,
        `题干：${ref.question}`,
        `答案：${ref.answer}`,
        `解析：${ref.explanation}`,
        `---`,
        `【我的问题】${msg.content}`,
      ].join('\n');
    }

    const attachments = msg.fileAttachments && msg.fileAttachments.length > 0
      ? msg.fileAttachments
      : (msg.fileAttachment ? [msg.fileAttachment] : []);

    if (msg.role === 'user' && attachments.length > 0) {
      const allFileContexts = attachments.map((file, index) => {
        const fileContextParts = [
          `【上传文件 ${index + 1}】${file.name}`,
          `类型：${file.type || 'unknown'}，大小：${formatFileSize(file.size)}${file.encoding ? `，编码：${file.encoding}` : ''}`,
        ];

        if (file.textContent) {
          fileContextParts.push('【文件内容】');
          fileContextParts.push(file.textContent);
          if (file.truncated) {
            fileContextParts.push('（文件内容过长，已截断后发送）');
          }
        } else {
          fileContextParts.push('（该文件为二进制或不可直接解析文本，未附带正文内容）');
        }

        return fileContextParts.join('\n');
      });

      content = [content, ...allFileContexts].filter(Boolean).join('\n\n');
    }

    // 如果当前消息含图片，使用多模态内容格式
    if (msg.role === 'user' && msg.image) {
      apiMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: content || '请分析这张图片' },
          { type: 'image_url', image_url: { url: msg.image } },
        ] as any,
      });
    } else {
      apiMessages.push({ role: msg.role, content });
    }
  }

  const requestBody: any = {
    model: provider.model,
    messages: apiMessages,
    stream: true,
    temperature: isReasoningModel(provider.model) ? undefined : (provider.temperature ?? 0.7),
  };
  const startTime = Date.now();

  const requestId = startUsageRequest({
    channel: 'chat_stream',
    providerId: provider.id,
    providerName: provider.name,
    model: provider.model,
  });

  if (provider.maxTokens) {
    requestBody.max_tokens = provider.maxTokens;
  }

  const headers = buildAuthHeaders(provider);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // 合并外部 abort signal
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      await response.text();
      const { message } = getHttpErrorInfo(response.status, provider.model, provider.name);
      throw new Error(message);
    }

    // 处理 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';
    let usageFromStream: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 保留最后未完成的行
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          if (json.usage) {
            usageFromStream = json.usage;
          }
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            callbacks.onToken(delta.content);
          }
          // 兼容部分推理模型的 reasoning_content
          if (delta?.reasoning_content) {
            fullText += delta.reasoning_content;
            callbacks.onToken(delta.reasoning_content);
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    const promptText = apiMessages.map((msg: any) => {
      if (typeof msg?.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg?.content)) {
        return msg.content
          .map((part: any) => {
            if (part?.type === 'text') return part?.text || '';
            if (part?.type === 'image_url') return '[image]';
            return '';
          })
          .join(' ');
      }
      return '';
    }).join('\n');

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

    callbacks.onDone(fullText);
  } catch (error: any) {
    clearTimeout(timeoutId);
    endUsageRequest({
      requestId,
      success: false,
      latencyMs: Date.now() - startTime,
      error: error?.message,
    });
    if (error.name === 'AbortError') {
      callbacks.onError('请求已取消或超时。');
    } else {
      callbacks.onError(error.message || '未知错误');
    }
  }
}
