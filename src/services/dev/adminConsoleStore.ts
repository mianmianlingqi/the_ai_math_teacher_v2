import { AIProviderConfig, LogEntry } from '@/types';

export type AdminIoRole = 'request' | 'response' | 'error' | 'status';
export type AdminContextRole = 'system' | 'user' | 'assistant';

export interface AdminIoLogEntry {
  id: string;
  timestamp: string;
  role: AdminIoRole;
  content: unknown;
  token_count: number;
  latency_ms: number | null;
  channel?: string;
  provider?: string;
  model?: string;
}

export interface AdminContextMessage {
  id: string;
  timestamp: string;
  role: AdminContextRole;
  content: string;
  token_count: number;
  token_sequence: string[];
  raw: unknown;
}

export interface AdminModelParams {
  provider: string;
  model: string;
  base_url: string;
  backend_provider?: string;
  temperature: number | string;
  top_p: number | string;
  max_tokens: number | string;
  timeout_seconds: number | string;
  updated_at: string;
}

export interface AdminConsoleSnapshot {
  ioLogs: AdminIoLogEntry[];
  systemLogs: LogEntry[];
  contextMessages: AdminContextMessage[];
  modelParams: AdminModelParams | null;
  updatedAt: string;
}

interface RecordRequestPayload {
  channel: string;
  provider: AIProviderConfig;
  requestBody: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
}

interface RecordResponsePayload {
  requestId: string;
  channel: string;
  provider: AIProviderConfig;
  responseBody: unknown;
  assistantContent?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; estimated?: boolean };
  latencyMs?: number;
  success: boolean;
  error?: string;
}

interface FetchInterceptorState {
  installed: boolean;
  originalFetch: typeof window.fetch | null;
}

const IO_LOG_KEY = 'ai_math_dev_admin_io_logs_v1';
const SYSTEM_LOG_KEY = 'ai_math_dev_admin_system_logs_v1';
const CONTEXT_KEY = 'ai_math_dev_admin_context_v1';
const PARAMS_KEY = 'ai_math_dev_admin_params_v1';
const UPDATE_EVENT = 'ai-dev-admin-console-update';
const MAX_SYSTEM_LOGS = 500;
const MAX_TOKEN_SEQUENCE = 4000;
const fetchInterceptorState: FetchInterceptorState = {
  installed: false,
  originalFetch: null,
};

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (!hasWindow()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn('后台调试面板数据读取失败，已回退为空数据。', error);
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
  } catch (error) {
    console.warn('后台调试面板数据写入失败，可能是本地存储空间不足。', error);
  }
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        const item = part as any;
        if (item.type === 'text') return item.text || '';
        if (item.type === 'image_url') return '[图片输入]';
      }
      return JSON.stringify(part);
    }).join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}

export function estimateAdminTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildTokenSequence(content: string): string[] {
  if (!content) return [];
  const matched = content.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_]+|\$\$|\\[A-Za-z]+|[^\s]/g) || [];
  if (matched.length <= MAX_TOKEN_SEQUENCE) return matched;
  return [...matched.slice(0, MAX_TOKEN_SEQUENCE), `...已截断 ${matched.length - MAX_TOKEN_SEQUENCE} 个前端估算 token`];
}

function toModelParams(provider: AIProviderConfig): AdminModelParams {
  return {
    provider: provider.name || provider.id || '未知供应商',
    model: provider.model || '未配置模型',
    base_url: provider.baseURL || '',
    backend_provider: provider.backendProvider,
    temperature: provider.temperature ?? '默认',
    top_p: (provider as any).topP ?? (provider as any).top_p ?? '默认',
    max_tokens: provider.maxTokens ?? '默认',
    timeout_seconds: provider.timeout ?? '默认',
    updated_at: nowIso(),
  };
}

function appendIoLog(entry: AdminIoLogEntry): void {
  const logs = readJson<AdminIoLogEntry[]>(IO_LOG_KEY, []);
  writeJson(IO_LOG_KEY, [entry, ...logs]);
}

function normalizeSystemLog(log: LogEntry): LogEntry {
  return {
    ...log,
    timestamp: log.timestamp || new Date().toLocaleTimeString(),
    level: log.level || 'info',
    message: log.message || '空日志消息',
  };
}

function appendSystemLog(log: LogEntry): void {
  const logs = readJson<LogEntry[]>(SYSTEM_LOG_KEY, []);
  writeJson(SYSTEM_LOG_KEY, [...logs, normalizeSystemLog(log)].slice(-MAX_SYSTEM_LOGS));
}

function mergeContextMessages(nextMessages: AdminContextMessage[]): void {
  const current = readJson<AdminContextMessage[]>(CONTEXT_KEY, []);
  const seen = new Set(current.map(item => `${item.role}::${item.content}`));
  const merged = [...current];

  nextMessages.forEach((message) => {
    const key = `${message.role}::${message.content}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(message);
  });

  writeJson(CONTEXT_KEY, merged);
}

function normalizeContextMessages(messages: Array<{ role?: string; content?: unknown }> = []): AdminContextMessage[] {
  const ts = nowIso();
  return messages
    .filter(message => message?.role === 'system' || message?.role === 'user' || message?.role === 'assistant')
    .map((message, index) => {
      const content = normalizeContent(message.content);
      return {
        id: makeId(`ctx_${index}`),
        timestamp: ts,
        role: message.role as AdminContextRole,
        content,
        token_count: estimateAdminTokens(content),
        token_sequence: buildTokenSequence(content),
        raw: message,
      };
    });
}

function tryParseJson(text: string): unknown {
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readFetchBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const body = init?.body;
  if (typeof body === 'string') return tryParseJson(body);
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (body && typeof body === 'object') return '[二进制或流式请求体，前端调试面板未展开]';

  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      return tryParseJson(await input.clone().text());
    } catch {
      return '[请求体读取失败]';
    }
  }

  return null;
}

function getFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function shouldTraceFetch(url: string): boolean {
  const normalized = url.toLowerCase();
  if (normalized.includes('/api/dev-usage-state')) return false;
  return normalized.includes('/chat/completions')
    || normalized.includes('/api/ai/chat')
    || normalized.includes('/api/ai/providers')
    || normalized.includes('/api/generate')
    || normalized.includes('/api/chat');
}

async function readResponsePayload(response: Response): Promise<unknown> {
  try {
    const clone = response.clone();
    const contentType = clone.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await clone.json();
    }
    const text = await clone.text();
    return tryParseJson(text.length > 24000 ? `${text.slice(0, 24000)}\n...响应内容过长，已截断` : text);
  } catch {
    return '[响应体读取失败或已被消费]';
  }
}

function extractMessagesFromBody(body: unknown): Array<{ role?: string; content?: unknown }> {
  if (!body || typeof body !== 'object') return [];
  const data = body as any;
  if (Array.isArray(data.messages)) return data.messages;
  if (data.body && typeof data.body === 'object' && Array.isArray(data.body.messages)) return data.body.messages;
  return [];
}

function extractModelFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const data = body as any;
  return data.model || data.provider || data.body?.model;
}

function appendStatusLog(content: unknown, channel = 'runtime_status'): void {
  appendIoLog({
    id: makeId('admin_status'),
    timestamp: nowIso(),
    role: 'status',
    content,
    token_count: estimateAdminTokens(content),
    latency_ms: null,
    channel,
    provider: '前端运行时',
    model: 'workflow',
  });
}

export function recordModelRequest(payload: RecordRequestPayload): string {
  const requestId = makeId('admin_req');
  const params = toModelParams(payload.provider);
  writeJson(PARAMS_KEY, params);

  appendIoLog({
    id: requestId,
    timestamp: nowIso(),
    role: 'request',
    content: payload.requestBody,
    token_count: estimateAdminTokens(payload.requestBody),
    latency_ms: null,
    channel: payload.channel,
    provider: params.provider,
    model: params.model,
  });

  mergeContextMessages(normalizeContextMessages(payload.messages));
  return requestId;
}

export function recordRuntimeLog(
  log: LogEntry,
  extra?: Record<string, unknown>,
  options: { syncSystemLog?: boolean } = {},
): void {
  if (options.syncSystemLog !== false) {
    appendSystemLog(log);
  }
  appendStatusLog({
    timestamp: new Date().toISOString(),
    role: 'status',
    content: {
      level: log.level,
      message: log.message,
      details: log.details,
      category: log.category,
      suggestion: log.suggestion,
      ...extra,
    },
    token_count: estimateAdminTokens(log.message),
    latency_ms: null,
  }, 'generation_workflow');
}

export function recordSystemLogSnapshot(logs: LogEntry[]): void {
  writeJson(SYSTEM_LOG_KEY, logs.map(normalizeSystemLog).slice(-MAX_SYSTEM_LOGS));
}

export function recordRuntimeStatus(message: string, content?: Record<string, unknown>): void {
  appendStatusLog({
    timestamp: new Date().toISOString(),
    role: 'status',
    content: {
      message,
      ...(content || {}),
    },
    token_count: estimateAdminTokens(`${message}${JSON.stringify(content || {})}`),
    latency_ms: null,
  }, 'runtime_status');
}

export function installAdminFetchInterceptor(): void {
  if (!hasWindow() || fetchInterceptorState.installed || typeof window.fetch !== 'function') return;

  fetchInterceptorState.installed = true;
  fetchInterceptorState.originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const originalFetch = fetchInterceptorState.originalFetch!;
    const url = getFetchUrl(input);
    if (!shouldTraceFetch(url)) {
      return originalFetch(input, init);
    }

    const startTime = Date.now();
    const requestBody = await readFetchBody(input, init);
    const requestId = makeId('admin_fetch');
    const model = extractModelFromBody(requestBody) || 'unknown';
    const messages = extractMessagesFromBody(requestBody);

    appendIoLog({
      id: requestId,
      timestamp: nowIso(),
      role: 'request',
      content: {
        url,
        method: init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'),
        body: requestBody,
        source: 'fetch_interceptor',
      },
      token_count: estimateAdminTokens(requestBody),
      latency_ms: null,
      channel: 'fetch_interceptor',
      provider: '网络请求拦截',
      model,
    });
    mergeContextMessages(normalizeContextMessages(messages));

    try {
      const response = await originalFetch(input, init);
      const responsePayload = await readResponsePayload(response);
      appendIoLog({
        id: requestId,
        timestamp: nowIso(),
        role: response.ok ? 'response' : 'error',
        content: {
          url,
          status: response.status,
          ok: response.ok,
          body: responsePayload,
          source: 'fetch_interceptor',
        },
        token_count: estimateAdminTokens(responsePayload),
        latency_ms: Date.now() - startTime,
        channel: 'fetch_interceptor',
        provider: '网络请求拦截',
        model,
      });

      const assistantContent = (responsePayload as any)?.choices?.[0]?.message?.content
        || (responsePayload as any)?.data?.choices?.[0]?.message?.content;
      if (assistantContent) {
        mergeContextMessages([{
          id: makeId('ctx_fetch_assistant'),
          timestamp: nowIso(),
          role: 'assistant',
          content: assistantContent,
          token_count: estimateAdminTokens(assistantContent),
          token_sequence: buildTokenSequence(assistantContent),
          raw: { role: 'assistant', content: assistantContent, source: 'fetch_interceptor' },
        }]);
      }

      return response;
    } catch (error: any) {
      appendIoLog({
        id: requestId,
        timestamp: nowIso(),
        role: 'error',
        content: {
          url,
          error: error?.message || '网络请求失败',
          source: 'fetch_interceptor',
        },
        token_count: estimateAdminTokens(error?.message || ''),
        latency_ms: Date.now() - startTime,
        channel: 'fetch_interceptor',
        provider: '网络请求拦截',
        model,
      });
      throw error;
    }
  };

  recordRuntimeStatus('后台网络请求拦截器已启用，将捕获 AI 请求/响应。');
}

export function resetAdminFetchInterceptorForTests(): void {
  if (!hasWindow() || !fetchInterceptorState.installed || !fetchInterceptorState.originalFetch) return;
  window.fetch = fetchInterceptorState.originalFetch;
  fetchInterceptorState.installed = false;
  fetchInterceptorState.originalFetch = null;
}

export function recordModelResponse(payload: RecordResponsePayload): void {
  const role: AdminIoRole = payload.success ? 'response' : 'error';
  appendIoLog({
    id: payload.requestId,
    timestamp: nowIso(),
    role,
    content: payload.success
      ? payload.responseBody
      : { error: payload.error || '未知错误', response: payload.responseBody },
    token_count: payload.usage?.totalTokens ?? estimateAdminTokens(payload.responseBody),
    latency_ms: Number.isFinite(payload.latencyMs) ? Math.round(payload.latencyMs || 0) : null,
    channel: payload.channel,
    provider: payload.provider.name || payload.provider.id,
    model: payload.provider.model,
  });

  if (payload.assistantContent) {
    const content = payload.assistantContent;
    mergeContextMessages([{
      id: makeId('ctx_assistant'),
      timestamp: nowIso(),
      role: 'assistant',
      content,
      token_count: payload.usage?.completionTokens ?? estimateAdminTokens(content),
      token_sequence: buildTokenSequence(content),
      raw: { role: 'assistant', content },
    }]);
  }
}

export function getAdminConsoleSnapshot(fallbackProvider?: AIProviderConfig): AdminConsoleSnapshot {
  const storedParams = readJson<AdminModelParams | null>(PARAMS_KEY, null);
  return {
    ioLogs: readJson<AdminIoLogEntry[]>(IO_LOG_KEY, []),
    systemLogs: readJson<LogEntry[]>(SYSTEM_LOG_KEY, []),
    contextMessages: readJson<AdminContextMessage[]>(CONTEXT_KEY, []),
    modelParams: storedParams || (fallbackProvider ? toModelParams(fallbackProvider) : null),
    updatedAt: nowIso(),
  };
}

export function clearAdminConsoleData(): void {
  writeJson(IO_LOG_KEY, []);
  writeJson(SYSTEM_LOG_KEY, []);
  writeJson(CONTEXT_KEY, []);
}

export function getAdminConsoleUpdateEventName(): string {
  return UPDATE_EVENT;
}
