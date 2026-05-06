import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AIProviderConfig, LogEntry } from '@/types';
import {
  AdminConsoleSnapshot,
  AdminContextMessage,
  AdminIoLogEntry,
  clearAdminConsoleData,
  getAdminConsoleSnapshot,
  getAdminConsoleUpdateEventName,
  installAdminFetchInterceptor,
} from '@/services/dev/adminConsoleStore';
import toast from 'react-hot-toast';

interface AdminConsoleProps {
  providerConfig: AIProviderConfig;
}

const VIRTUAL_ROW_HEIGHT = 176;
const VIRTUAL_OVERSCAN = 4;

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringifyTokenSequence(tokens: string[]): string {
  if (!Array.isArray(tokens) || tokens.length === 0) return '（空 token 序列）';
  return tokens
    .join(' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '（空 token 序列）';
}

function roleColor(role: string): string {
  if (role === 'system') return 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200';
  if (role === 'user') return 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200';
  if (role === 'assistant') return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200';
  if (role === 'error') return 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200';
  if (role === 'request') return 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200';
  return 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200';
}

function levelColor(level: LogEntry['level']): string {
  if (level === 'success') return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200';
  if (level === 'warn') return 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200';
  if (level === 'error') return 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200';
  if (level === 'debug') return 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200';
  return 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200';
}

function useVirtualWindow<T>(items: T[], rowHeight = VIRTUAL_ROW_HEIGHT) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(520);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => setHeight(el.clientHeight || 520);
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN);
  const visibleCount = Math.ceil(height / rowHeight) + VIRTUAL_OVERSCAN * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const visibleItems = items.slice(startIndex, endIndex);

  return {
    containerRef,
    visibleItems,
    startIndex,
    totalHeight: items.length * rowHeight,
    offsetY: startIndex * rowHeight,
    onScroll: (event: React.UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop),
  };
}

const GearIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.607 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const IoLogColumn: React.FC<{ logs: AdminIoLogEntry[] }> = ({ logs }) => {
  const [keyword, setKeyword] = useState('');
  const normalizedKeyword = keyword.trim().toLowerCase();

  const filteredLogs = useMemo(() => logs.filter((log) => {
    if (!normalizedKeyword) return true;
    return stringifyJson(log).toLowerCase().includes(normalizedKeyword);
  }), [logs, normalizedKeyword]);

  const virtual = useVirtualWindow<AdminIoLogEntry>(filteredLogs);

  return (
    <section className="admin-console-card admin-console-card-io">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="admin-console-title">实时 IO 日志流</h3>
          <p className="admin-console-subtitle">倒序显示完整请求/响应 JSON</p>
        </div>
        <span className="admin-console-badge">{filteredLogs.length} 条</span>
      </div>

      <input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        className="admin-console-input mt-4"
        placeholder="搜索 timestamp、role、content..."
      />

      <div ref={virtual.containerRef} onScroll={virtual.onScroll} className="admin-console-virtual custom-scrollbar mt-4">
        <div style={{ height: virtual.totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${virtual.offsetY}px)` }}>
            {virtual.visibleItems.map((log, index) => (
              <article key={`${log.id}-${virtual.startIndex + index}`} className="admin-console-row" style={{ minHeight: VIRTUAL_ROW_HEIGHT - 12 }}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${roleColor(log.role)}`}>{log.role}</span>
                  <span className="text-[10px] font-bold text-slate-400">{formatTime(log.timestamp)}</span>
                  <span className="text-[10px] font-bold text-slate-400">{log.token_count} tokens</span>
                  <span className="text-[10px] font-bold text-slate-400">{log.latency_ms ?? '-'} ms</span>
                </div>
                <pre className="admin-console-code">{stringifyJson({
                  timestamp: log.timestamp,
                  role: log.role,
                  content: log.content,
                  token_count: log.token_count,
                  latency_ms: log.latency_ms,
                  channel: log.channel,
                  provider: log.provider,
                  model: log.model,
                })}</pre>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const ContextColumn: React.FC<{ messages: AdminContextMessage[] }> = ({ messages }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const virtual = useVirtualWindow<AdminContextMessage>(messages, 168);

  return (
    <section className="admin-console-card admin-console-card-context">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="admin-console-title">上下文快照</h3>
          <p className="admin-console-subtitle">顺序展示 system / user / assistant</p>
        </div>
        <span className="admin-console-badge">{messages.length} 条</span>
      </div>

      <div ref={virtual.containerRef} onScroll={virtual.onScroll} className="admin-console-virtual custom-scrollbar mt-4">
        <div style={{ height: virtual.totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${virtual.offsetY}px)` }}>
            {virtual.visibleItems.map((message) => {
              const isExpanded = Boolean(expanded[message.id]);
              return (
                <article key={message.id} className={`admin-console-row border-l-4 ${roleColor(message.role)}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase">{message.role}</span>
                    <span className="text-[10px] font-bold opacity-70">{message.token_count} tokens · {formatTime(message.timestamp)}</span>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-700 dark:text-slate-200">{message.content || '（空消息）'}</p>
                  <button
                    className="mt-2 text-[11px] font-black text-sky-600 hover:text-sky-700 dark:text-sky-300"
                    onClick={() => setExpanded(prev => ({ ...prev, [message.id]: !prev[message.id] }))}
                  >
                    {isExpanded ? '收起 token 序列' : '展开原始 token 序列'}
                  </button>
                  {isExpanded && (
                    <pre className="admin-console-token-box mt-2 whitespace-pre-wrap break-words">{stringifyTokenSequence(message.token_sequence)}</pre>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

const SystemLogColumn: React.FC<{ logs: LogEntry[] }> = ({ logs }) => {
  const [level, setLevel] = useState<'all' | LogEntry['level']>('all');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [collapsed, setCollapsed] = useState(true);

  const filteredLogs = useMemo(() => (
    level === 'all' ? logs : logs.filter(log => log.level === level)
  ), [logs, level]);
  const newestFirstLogs = useMemo(() => [...filteredLogs].reverse(), [filteredLogs]);
  const virtual = useVirtualWindow<LogEntry>(newestFirstLogs, 126);

  const counts = useMemo(() => ({
    all: logs.length,
    info: logs.filter(log => log.level === 'info').length,
    success: logs.filter(log => log.level === 'success').length,
    warn: logs.filter(log => log.level === 'warn').length,
    error: logs.filter(log => log.level === 'error').length,
    debug: logs.filter(log => log.level === 'debug').length,
  }), [logs]);

  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

  return (
    <section className={`admin-console-card admin-console-system-log ${collapsed ? 'admin-console-system-log-collapsed' : ''}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="admin-console-title">系统运行日志</h3>
          <p className="admin-console-subtitle">
            {collapsed
              ? (latestLog
                ? `已折叠，最新日志：${latestLog.message}`
                : '已折叠，当前暂无系统日志。')
              : '同步左下角系统·运行日志，保留原始 level、category、details、suggestion'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!collapsed && ([
            ['all', '全部', counts.all],
            ['info', '信息', counts.info],
            ['success', '成功', counts.success],
            ['warn', '警告', counts.warn],
            ['error', '错误', counts.error],
            ['debug', '调试', counts.debug],
          ] as Array<[typeof level, string, number]>).map(([key, label, count]) => (
            <button
              key={key}
              className={`admin-console-mini-btn ${level === key ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-200' : ''}`}
              onClick={() => setLevel(key)}
              disabled={count === 0 && key !== 'all'}
            >
              {label} {count > 0 ? count : ''}
            </button>
          ))}
          <span className="admin-console-badge">{counts.all} 条</span>
          <button className="admin-console-action" onClick={() => setCollapsed(prev => !prev)}>
            {collapsed ? '展开日志' : '折叠日志'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div ref={virtual.containerRef} onScroll={virtual.onScroll} className="admin-console-virtual custom-scrollbar mt-4 min-h-[220px]">
          <div style={{ height: virtual.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${virtual.offsetY}px)` }}>
              {virtual.visibleItems.map((log, index) => {
                const realIndex = logs.length - 1 - (virtual.startIndex + index);
                const isExpanded = Boolean(expanded[realIndex]);
                const hasDetails = Boolean(log.details || log.suggestion);
                return (
                  <article key={`${realIndex}-${log.timestamp}-${index}`} className={`admin-console-row border-l-4 ${levelColor(log.level)}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${levelColor(log.level)}`}>{log.level}</span>
                      <span className="text-[10px] font-bold opacity-70">{log.timestamp}</span>
                      {log.category && <span className="rounded-full bg-slate-900/5 px-2 py-0.5 text-[10px] font-black opacity-70 dark:bg-white/10">{log.category}</span>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-all text-xs font-bold leading-5 text-slate-700 dark:text-slate-200">{log.message}</p>
                    {log.suggestion && (
                      <p className="mt-2 rounded-xl bg-sky-500/10 px-3 py-2 text-[11px] font-bold leading-5 text-sky-700 dark:text-sky-200">{log.suggestion}</p>
                    )}
                    {hasDetails && (
                      <button
                        className="mt-2 text-[11px] font-black text-sky-600 hover:text-sky-700 dark:text-sky-300"
                        onClick={() => setExpanded(prev => ({ ...prev, [realIndex]: !prev[realIndex] }))}
                      >
                        {isExpanded ? '收起详情' : '展开详情'}
                      </button>
                    )}
                    {isExpanded && log.details && (
                      <pre className="admin-console-token-box mt-2">{typeof log.details === 'string' ? log.details : stringifyJson(log.details)}</pre>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const ParamsColumn: React.FC<{ snapshot: AdminConsoleSnapshot; onRefresh: () => void }> = ({ snapshot, onRefresh }) => {
  const params = snapshot.modelParams;
  const copyParams = async () => {
    if (!params) {
      toast.error('当前暂无模型参数可复制。');
      return;
    }
    try {
      await navigator.clipboard.writeText(stringifyJson(params));
      toast.success('模型参数配置已复制。');
    } catch {
      toast.error('复制失败，请检查浏览器剪贴板权限。');
    }
  };

  const rows = params ? [
    ['provider', params.provider],
    ['model', params.model],
    ['temperature', params.temperature],
    ['top_p', params.top_p],
    ['max_tokens', params.max_tokens],
    ['timeout_seconds', params.timeout_seconds],
    ['base_url', params.base_url],
    ['backend_provider', params.backend_provider || '未启用'],
  ] : [];

  return (
    <section className="admin-console-card admin-console-card-params">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="admin-console-title">模型配置参数</h3>
          <p className="admin-console-subtitle">当前请求使用的推理参数</p>
        </div>
        <button className="admin-console-mini-btn" onClick={onRefresh}>刷新</button>
      </div>

      <div className="admin-console-card-scroll custom-scrollbar mt-4 pr-1">
        <div className="space-y-3">
          {rows.map(([key, value]) => (
            <div key={String(key)} className="rounded-2xl border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-950/40">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{key}</p>
              <p className="mt-1 break-all text-sm font-bold text-slate-800 dark:text-slate-100">{String(value)}</p>
            </div>
          ))}
          {!params && <p className="text-sm font-bold text-slate-400">暂无模型配置数据。</p>}
        </div>
      </div>

      <div className="admin-console-card-footer mt-5">
        <button className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-lg transition hover:scale-[1.02] hover:bg-black active:scale-[0.98] dark:bg-sky-500 dark:hover:bg-sky-400" onClick={copyParams}>
          一键复制参数配置
        </button>

        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/50">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">自动刷新</p>
          <p className="mt-2 text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">面板每 2 秒自动刷新一次，也会响应 AI 请求事件实时更新。最后刷新：{formatTime(snapshot.updatedAt)}</p>
        </div>
      </div>
    </section>
  );
};

export const AdminConsole: React.FC<AdminConsoleProps> = ({ providerConfig }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AdminConsoleSnapshot>(() => getAdminConsoleSnapshot(providerConfig));

  const refresh = () => setSnapshot(getAdminConsoleSnapshot(providerConfig));

  useEffect(() => {
    installAdminFetchInterceptor();
  }, []);

  useEffect(() => {
    const eventName = getAdminConsoleUpdateEventName();
    window.addEventListener(eventName, refresh);
    const timer = window.setInterval(refresh, 2000);
    return () => {
      window.removeEventListener(eventName, refresh);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerConfig]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const handleExport = () => {
    const data = stringifyJson(snapshot);
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-admin-console-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('后台调试数据已导出。');
  };

  const handleClear = () => {
    clearAdminConsoleData();
    refresh();
    toast.success('后台调试日志与上下文已清空。');
  };

  return (
    <>
      <button
        type="button"
        className="admin-console-fab group"
        onClick={() => setIsOpen(true)}
        aria-label="打开后台管理面板"
      >
        <GearIcon className="h-6 w-6" />
        <span className="admin-console-tooltip">后台</span>
      </button>

      {isOpen && createPortal(
        <div className="admin-console-overlay animate-overlayIn" role="dialog" aria-modal="true" aria-label="后台管理面板">
          <div className="admin-console-panel animate-modalIn" onClick={(event) => event.stopPropagation()}>
            <header className="flex flex-col gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-500">Admin Console</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">后台管理面板</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="admin-console-action" onClick={refresh}>手动刷新</button>
                <button className="admin-console-action" onClick={handleClear}>清空数据</button>
                <button className="admin-console-action admin-console-action-primary" onClick={handleExport}>导出数据</button>
                <button className="admin-console-action" onClick={() => setIsOpen(false)}>关闭</button>
              </div>
            </header>

            <div className="admin-console-content">
              <div className="admin-console-top-grid">
                <IoLogColumn logs={snapshot.ioLogs} />
                <ContextColumn messages={snapshot.contextMessages} />
                <ParamsColumn snapshot={snapshot} onRefresh={refresh} />
              </div>
              <SystemLogColumn logs={snapshot.systemLogs} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
