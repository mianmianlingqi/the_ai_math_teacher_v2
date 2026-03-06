export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
}

interface UsageTotals {
  requests: number;
  success: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface ModelUsageStats extends UsageTotals {
  providerId?: string;
  providerName: string;
  model: string;
  activeRequests: number;
  lastSeenAt: number;
}

interface ActiveRequest {
  requestId: string;
  channel: string;
  providerId?: string;
  providerName: string;
  model: string;
  startedAt: number;
}

interface UsageEvent {
  requestId: string;
  channel: string;
  providerName: string;
  model: string;
  success: boolean;
  latencyMs?: number;
  usage: Required<TokenUsage>;
  error?: string;
  timestamp: number;
}

export interface UsageMonitorState {
  sessionStartedAt: number;
  updatedAt: number;
  totals: UsageTotals;
  activeRequests: ActiveRequest[];
  perModel: Record<string, ModelUsageStats>;
  recentEvents: UsageEvent[];
}

interface StartRequestPayload {
  channel: string;
  providerId?: string;
  providerName: string;
  model: string;
}

interface EndRequestPayload {
  requestId: string;
  success: boolean;
  latencyMs?: number;
  usage?: TokenUsage;
  error?: string;
}

const STORAGE_KEY = 'dev_usage_monitor_state_v1';
const CHANNEL_NAME = 'ai_usage_monitor_channel_v1';
const MAX_EVENTS = 100;

const hasWindow = typeof window !== 'undefined';
let broadcastChannel: BroadcastChannel | null = null;

function now(): number {
  return Date.now();
}

function createInitialState(): UsageMonitorState {
  const ts = now();
  return {
    sessionStartedAt: ts,
    updatedAt: ts,
    totals: {
      requests: 0,
      success: 0,
      failed: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    activeRequests: [],
    perModel: {},
    recentEvents: [],
  };
}

function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Math.random().toString(36).slice(2, 10)}_${now()}`;
}

function clampTokens(value?: number): number {
  if (!Number.isFinite(value) || !value || value < 0) return 0;
  return Math.floor(value);
}

function toRequiredUsage(usage?: TokenUsage): Required<TokenUsage> {
  const promptTokens = clampTokens(usage?.promptTokens);
  const completionTokens = clampTokens(usage?.completionTokens);
  const totalTokens = clampTokens(usage?.totalTokens) || promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimated: Boolean(usage?.estimated),
  };
}

function modelKey(providerName: string, model: string): string {
  return `${providerName}::${model}`;
}

function readState(): UsageMonitorState {
  if (!hasWindow) return createInitialState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as UsageMonitorState;
    if (!parsed || typeof parsed !== 'object') return createInitialState();
    return {
      ...createInitialState(),
      ...parsed,
      totals: { ...createInitialState().totals, ...(parsed.totals || {}) },
      activeRequests: Array.isArray(parsed.activeRequests) ? parsed.activeRequests : [],
      perModel: parsed.perModel || {},
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
    };
  } catch {
    return createInitialState();
  }
}

function getChannel(): BroadcastChannel | null {
  if (!hasWindow || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
  return broadcastChannel;
}

function emitState(state: UsageMonitorState): void {
  if (!hasWindow) return;
  state.updatedAt = now();
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  getChannel()?.postMessage({ type: 'state', state });
  window.dispatchEvent(new CustomEvent('ai-usage-monitor-update', { detail: state }));
  fetch('/api/dev-usage-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
    keepalive: true,
  }).catch(() => {
    // ignore relay sync failures in non-dev env
  });
}

function updateState(mutator: (state: UsageMonitorState) => void): void {
  const state = readState();
  mutator(state);
  emitState(state);
}

function ensureModel(state: UsageMonitorState, payload: StartRequestPayload): ModelUsageStats {
  const key = modelKey(payload.providerName, payload.model);
  const current = state.perModel[key];
  if (current) return current;

  const created: ModelUsageStats = {
    providerId: payload.providerId,
    providerName: payload.providerName,
    model: payload.model,
    requests: 0,
    success: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    activeRequests: 0,
    lastSeenAt: now(),
  };
  state.perModel[key] = created;
  return created;
}

export function startUsageRequest(payload: StartRequestPayload): string {
  const requestId = makeRequestId();
  updateState((state) => {
    ensureModel(state, payload);
    state.activeRequests.push({
      requestId,
      channel: payload.channel,
      providerId: payload.providerId,
      providerName: payload.providerName,
      model: payload.model,
      startedAt: now(),
    });
    const stats = state.perModel[modelKey(payload.providerName, payload.model)];
    stats.activeRequests += 1;
    stats.lastSeenAt = now();
  });
  return requestId;
}

export function endUsageRequest(payload: EndRequestPayload): void {
  updateState((state) => {
    const idx = state.activeRequests.findIndex(item => item.requestId === payload.requestId);
    if (idx === -1) return;

    const active = state.activeRequests[idx];
    state.activeRequests.splice(idx, 1);
    const usage = toRequiredUsage(payload.usage);

    state.totals.requests += 1;
    if (payload.success) {
      state.totals.success += 1;
    } else {
      state.totals.failed += 1;
    }
    state.totals.promptTokens += usage.promptTokens;
    state.totals.completionTokens += usage.completionTokens;
    state.totals.totalTokens += usage.totalTokens;

    const key = modelKey(active.providerName, active.model);
    const stats = state.perModel[key] || ensureModel(state, {
      channel: active.channel,
      providerId: active.providerId,
      providerName: active.providerName,
      model: active.model,
    });

    stats.requests += 1;
    if (payload.success) {
      stats.success += 1;
    } else {
      stats.failed += 1;
    }
    stats.promptTokens += usage.promptTokens;
    stats.completionTokens += usage.completionTokens;
    stats.totalTokens += usage.totalTokens;
    stats.activeRequests = Math.max(0, stats.activeRequests - 1);
    stats.lastSeenAt = now();

    state.recentEvents.unshift({
      requestId: payload.requestId,
      channel: active.channel,
      providerName: active.providerName,
      model: active.model,
      success: payload.success,
      latencyMs: payload.latencyMs,
      usage,
      error: payload.error,
      timestamp: now(),
    });

    if (state.recentEvents.length > MAX_EVENTS) {
      state.recentEvents = state.recentEvents.slice(0, MAX_EVENTS);
    }
  });
}

export function getUsageMonitorState(): UsageMonitorState {
  return readState();
}

export function resetUsageMonitorState(): void {
  emitState(createInitialState());
}

export function extractOpenAIUsage(usage: any): TokenUsage {
  if (!usage || typeof usage !== 'object') return {};
  const promptTokens = clampTokens(
    usage.prompt_tokens
    ?? usage.input_tokens
    ?? usage.promptTokenCount
    ?? usage.inputTokenCount
  );
  const completionTokens = clampTokens(
    usage.completion_tokens
    ?? usage.output_tokens
    ?? usage.candidatesTokenCount
    ?? usage.outputTokenCount
  );
  const totalTokens = clampTokens(
    usage.total_tokens
    ?? usage.totalTokenCount
    ?? usage.totalToken
  ) || (promptTokens + completionTokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
