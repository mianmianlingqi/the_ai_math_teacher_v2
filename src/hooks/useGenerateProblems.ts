/**
 * useGenerateProblems.ts
 *
 * 单一职责：绑定出题编排层（generateProblems）到 React UI 状态。
 *
 * v2.0：仅做 UI 状态绑定 + 网关预热 + 参考资料构建，所有生成逻辑由 services/generation/ 承担。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GenerateConfig, LogEntry, MathProblem, SelectedReferences } from '@/types';
import { UnifiedAIService } from '@/services/ai/aiService';
import { storageService } from '@/services/storage';
import { buildReferenceContext } from '@/services/ai/promptBuilder';
import { generateProblems } from '@/services/generation/generateProblems';
import { wakeUpBackend, isBackendEnabled } from '@/services/api/backendApi';

export const CUSTOM_CHAPTER_KEY = '自定义其他';

export interface UseGenerateProblemsOptions {
  config: GenerateConfig;
  customChapter: string;
  selectedKnowledgePoint: string;
  selectedRefs: SelectedReferences;
  aiServiceRef: React.MutableRefObject<UnifiedAIService>;
  parallelMode?: boolean;
  resetKey?: number;
}

export interface UseGenerateProblemsResult {
  problems: MathProblem[];
  setProblems: React.Dispatch<React.SetStateAction<MathProblem[]>>;
  logs: LogEntry[];
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
  addLog: (log: LogEntry) => void;
  loading: boolean;
  progress: { completed: number; success: number; total: number };
  handleGenerate: () => Promise<void>;
}

export function useGenerateProblems(options: UseGenerateProblemsOptions): UseGenerateProblemsResult {
  const { config, customChapter, selectedKnowledgePoint, selectedRefs, aiServiceRef, resetKey } = options;

  const [problems, setProblems] = useState<MathProblem[]>(() => storageService.getLastProblems());
  const [logs, setLogsState] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, success: 0, total: 0 });

  const setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>> = useCallback((updater) => {
    setLogsState(prev => typeof updater === 'function' ? (updater as any)(prev) : updater);
  }, []);

  const addLog = useCallback((log: LogEntry) => {
    setLogsState(prev => [...prev, log]);
  }, []);

  // 数据导入后重新同步
  useEffect(() => {
    if (resetKey === undefined || resetKey === 0) return;
    setProblems(storageService.getLastProblems());
  }, [resetKey]);

  const handleGenerate = async () => {
    setLoading(true);
    setProblems([]);
    storageService.clearLastProblems();
    setProgress({ completed: 0, success: 0, total: config.count });

    try {
      // 解析章节名
      const chapterName = config.chapter === CUSTOM_CHAPTER_KEY
        ? customChapter.trim() || '综合性/未分类章节'
        : config.chapter;

      // 构建知识点前缀
      const knowledgePrefix = selectedKnowledgePoint
        ? `【重点考察知识点：${selectedKnowledgePoint}】`
        : '';

      // 构建参考资料上下文
      let referenceContext = '';
      if (selectedRefs.wrongProblemIds.length > 0 || selectedRefs.noteIds.length > 0 || selectedRefs.qbankIds.length > 0) {
        const allWrong = storageService.getWrongProblems();
        const allNotes = storageService.getNotes();
        const allQBank = storageService.getQBankItems();
        referenceContext = buildReferenceContext(
          allWrong.filter(w => selectedRefs.wrongProblemIds.includes(w.id)),
          allNotes.filter(n => selectedRefs.noteIds.includes(n.id)),
          allQBank.filter(q => selectedRefs.qbankIds.includes(q.id)),
        );
      }

      // 拼装完整配置
      const fullConfig: GenerateConfig = {
        ...config,
        chapter: chapterName,
        topic: knowledgePrefix + (config.topic || ''),
        referenceContext: referenceContext || undefined,
      };

      // 网关预热（如果启用）
      const activeConfig = aiServiceRef.current.getConfig();
      if (activeConfig.backendProvider && isBackendEnabled()) {
        addLog({ timestamp: new Date().toLocaleTimeString(), level: 'info', message: '正在检查本地网关服务状态...' });
        await wakeUpBackend(6, (attempt) => {
          addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: `本地网关尚未就绪，第 ${attempt} 次等待...` });
        });
      }

      // 调用编排层
      const result = await generateProblems(fullConfig, aiServiceRef.current, {
        onLog: addLog,
        onProgress: (completed, total) => setProgress({ completed, success: completed, total }),
        onProblemReady: (problem) => setProblems(prev => {
          const next = [...prev, problem];
          storageService.saveLastProblems(next);
          return next;
        }),
      });

      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'success', message: `全部完成：成功生成 ${result.length} 道题目。` });
    } catch (err: any) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: `生成流程中断：${err?.message || '未知错误'}` });
    } finally {
      setLoading(false);
    }
  };

  return { problems, setProblems, logs, setLogs, addLog, loading, progress, handleGenerate };
}
