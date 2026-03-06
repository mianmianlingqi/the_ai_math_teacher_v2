
import React, { useRef, useEffect, useState } from 'react';
import { LogEntry } from '@/types';

interface LoggerProps {
  logs: LogEntry[];
  onClear?: () => void;
}

const LEVEL_CONFIG = {
  success: {
    border: 'border-emerald-500',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    badge: 'bg-emerald-500/20 text-emerald-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    ),
    label: '成功',
  },
  info: {
    border: 'border-sky-500',
    text: 'text-sky-400',
    bg: 'bg-sky-500/10',
    badge: 'bg-sky-500/20 text-sky-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    label: 'INFO',
  },
  warn: {
    border: 'border-amber-500',
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    badge: 'bg-amber-500/20 text-amber-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    label: '警告',
  },
  error: {
    border: 'border-rose-500',
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    badge: 'bg-rose-500/20 text-rose-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    label: '错误',
  },
  debug: {
    border: 'border-slate-500',
    text: 'text-slate-400',
    bg: 'bg-slate-500/10',
    badge: 'bg-slate-500/20 text-slate-500',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
    label: 'DEBUG',
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  network: '网络',
  parse: '解析',
  config: '配置',
  model: '模型',
  system: '系统',
};

export const Logger: React.FC<LoggerProps> = ({ logs, onClear }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isCollapsed]);

  // 有新的 error 时自动展开日志面板
  useEffect(() => {
    if (logs.length > 0 && logs[logs.length - 1].level === 'error') {
      setIsCollapsed(false);
    }
  }, [logs]);

  const errorCount = logs.filter(l => l.level === 'error').length;
  const warnCount = logs.filter(l => l.level === 'warn').length;
  const successCount = logs.filter(l => l.level === 'success').length;

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(l => l.level === filter);

  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;

  return (
    <div className={`bg-slate-900 border border-slate-700 shadow-2xl rounded-3xl overflow-hidden transition-all duration-500 ease-in-out ${isCollapsed ? 'h-[60px]' : 'h-[420px]'}`}>
      {/* 标题栏 */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-6 h-[60px] flex justify-between items-center hover:bg-slate-800 transition-colors border-b border-slate-800"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${
            errorCount > 0 ? 'bg-rose-500 animate-pulse' :
            logs.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'
          }`}></div>
          <span className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] shrink-0">系统运行日志</span>
          {/* 折叠时显示最后一条日志摘要 */}
          {isCollapsed && lastLog && (
            <span className={`text-[10px] truncate ml-2 ${LEVEL_CONFIG[lastLog.level]?.text || 'text-slate-400'}`}>
              {lastLog.message.slice(0, 60)}{lastLog.message.length > 60 ? '...' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {errorCount > 0 && (
            <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-[9px] font-black rounded-md">
              {errorCount} 错误
            </span>
          )}
          {warnCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] font-black rounded-md">
              {warnCount} 警告
            </span>
          )}
          {successCount > 0 && (
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[9px] font-black rounded-md">
              {successCount} 成功
            </span>
          )}
          {logs.length > 0 && errorCount === 0 && warnCount === 0 && successCount === 0 && (
            <span className="px-2 py-0.5 bg-sky-500/20 text-sky-400 text-[9px] font-black rounded-md">
              {logs.length} 条
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform duration-500 ${isCollapsed ? '' : 'rotate-180'}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* 筛选栏 + 操作栏 */}
      {!isCollapsed && (
        <div className="px-6 py-2 flex items-center justify-between border-b border-slate-800/50 bg-slate-900/80">
          <div className="flex items-center gap-1.5">
            {[
              { key: 'all', label: '全部', count: logs.length },
              { key: 'error', label: '错误', count: errorCount },
              { key: 'warn', label: '警告', count: warnCount },
              { key: 'success', label: '成功', count: successCount },
            ].map(f => (
              <button
                key={f.key}
                onClick={(e) => { e.stopPropagation(); setFilter(f.key); }}
                className={`px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all ${
                  filter === f.key
                    ? 'bg-sky-600/30 text-sky-300'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                } ${f.count === 0 && f.key !== 'all' ? 'opacity-30 cursor-not-allowed' : ''}`}
                disabled={f.count === 0 && f.key !== 'all'}
              >
                {f.label}{f.count > 0 ? ` (${f.count})` : ''}
              </button>
            ))}
          </div>
          {onClear && logs.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="text-[9px] text-slate-600 hover:text-rose-400 font-bold px-2 py-1 rounded-lg hover:bg-slate-800 transition-all"
              title="清空日志"
            >
              清空
            </button>
          )}
        </div>
      )}

      {/* 日志内容区 */}
      <div
        ref={scrollRef}
        className={`px-4 py-3 font-mono text-[11px] overflow-y-auto custom-scrollbar-dark select-text ${!isCollapsed && logs.length > 0 ? 'h-[calc(100%-60px-36px)]' : 'h-[calc(100%-60px)]'}`}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 space-y-2 opacity-50">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="italic">{filter === 'all' ? '等待指令输入...' : '无相关记录'}</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredLogs.map((log, i) => {
              const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info;
              const realIndex = logs.indexOf(log);
              const isExpanded = expandedIndex === realIndex;
              const hasExtra = log.details || log.suggestion;

              return (
                <div
                  key={realIndex}
                  className={`rounded-xl transition-all duration-200 animate-logSlideIn ${
                    isExpanded ? cfg.bg + ' ring-1 ring-white/5' : 'hover:bg-white/[0.02]'
                  }`}
                  style={{animationDelay: `${Math.min(i * 0.03, 0.3)}s`}}
                >
                  {/* 主行 */}
                  <div
                    className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer border-l-2 ${cfg.border}`}
                    onClick={() => hasExtra && setExpandedIndex(isExpanded ? null : realIndex)}
                  >
                    <span className="text-slate-600 shrink-0 select-none text-[10px] mt-0.5">[{log.timestamp}]</span>
                    <span className={`shrink-0 mt-0.5 ${cfg.text}`}>{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                        {log.category && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-500">
                            {CATEGORY_LABELS[log.category] || log.category}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300 mt-1 leading-relaxed break-all">{log.message}</p>
                      {/* 内联修复建议（不需要展开就能看到） */}
                      {log.suggestion && (
                        <p className="mt-1.5 text-[10px] text-sky-400/80 flex items-start gap-1.5">
                          <svg className="w-3 h-3 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>💡 {log.suggestion}</span>
                        </p>
                      )}
                    </div>
                    {/* 展开指示器 */}
                    {log.details && (
                      <svg
                        className={`w-3.5 h-3.5 text-slate-600 shrink-0 mt-1 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </div>
                  {/* 展开的详情区 */}
                  {isExpanded && log.details && (
                    <div className="px-3 pb-3 ml-[88px] animate-expandDown">
                      <div className="bg-black/40 rounded-xl p-3 border border-white/5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">详细信息</span>
                          <button
                            className="text-[9px] text-slate-600 hover:text-sky-400 font-bold transition-colors"
                            onClick={() => {
                              const text = typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2);
                              navigator.clipboard.writeText(text);
                            }}
                          >
                            复制
                          </button>
                        </div>
                        <pre className="text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto custom-scrollbar-dark">
                          {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar-dark::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}} />
    </div>
  );
};
