/**
 * useGenerateProblems.ts
 *
 * 单一职责：封装完整的出题生成业务逻辑，包含并行/串行模式、重试、去重拦截和进度日志。
 *
 * Why: 原 App.tsx 中 handleGenerate 函数含近 100 行嵌套逻辑（inclucing generateOne 内层函数），
 *      与 UI 状态强耦合导致难以测试。提取到此 hook 后，测试可直接 mock aiServiceRef，
 *      完全绕过 UI 渲染，极大降低集成测试难度。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GenerateConfig, LogEntry, MathProblem } from '@/types';
import { UnifiedAIService } from '@/services/ai/aiService';
import { storageService } from '@/services/storage';
import { checkProblemNearDuplicate, DEFAULT_DIVERSITY_GUARD_OPTIONS } from '@/services/storage/diversity';
import { SelectedReferences } from '@/types';
import { buildReferenceContext } from '@/services/ai/promptBuilder';
import { SYLLABUS_CHAPTERS } from '@/constants';
import { wakeUpBackend, isBackendEnabled } from '@/services/api/backendApi';

// ===== 常量 =====

/** 自定义章节的占位 Key，与 App.tsx 侧保持一致 */
export const CUSTOM_CHAPTER_KEY = '自定义其他';

/** 单题最大重试次数 */
const MAX_RETRIES = 2;

// ===== 类型定义 =====

export interface UseGenerateProblemsOptions {
  config: GenerateConfig;
  customChapter: string;
  selectedKnowledgePoint: string;
  selectedRefs: SelectedReferences;
  aiServiceRef: React.MutableRefObject<UnifiedAIService>;
  parallelMode: boolean;
  /**
   * 每次递增时，hook 会从 storage 重新读取上次保存的题目列表。
   * Why: 数据导入后 localStorage 已更新，但 React 内存状态仍为旧值，
   *      通过此 key 驱动 useEffect 重新同步，避免强制刷新页面。
   */
  resetKey?: number;
}

export interface UseGenerateProblemsResult {
  problems: MathProblem[];
  setProblems: React.Dispatch<React.SetStateAction<MathProblem[]>>;
  logs: LogEntry[];
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
  addLog: (log: LogEntry) => void;
  loading: boolean;
  handleGenerate: () => Promise<void>;
}

// ===== Hook 实现 =====

/**
 * 管理题目列表、日志及生成流程。
 *
 * @param options - 配置参数、AI 服务引用和并行模式开关
 * @returns 题目列表状态、日志状态和触发生成的方法
 */
export function useGenerateProblems(options: UseGenerateProblemsOptions): UseGenerateProblemsResult {
  const { config, customChapter, selectedKnowledgePoint, selectedRefs, aiServiceRef, parallelMode, resetKey } = options;

  const [problems, setProblems] = useState<MathProblem[]>(() => storageService.getLastProblems());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const addLog = useCallback((log: LogEntry) => {
    setLogs(prev => [...prev, log]);
  }, []);

  // 当 data:imported 事件触发后，App 层递增 resetKey，此处重新从 storage 同步题目
  useEffect(() => {
    if (resetKey === undefined || resetKey === 0) return;
    setProblems(storageService.getLastProblems());
  }, [resetKey]);

  /**
   * 触发题目生成。
   *
   * 数据流：
   * 1. 读取配置 → 构建参考上下文（错题/笔记/题库）
   * 2. 根据 parallelMode 选择并行 or 串行分发 generateOne
   * 3. generateOne 内含重试（MAX_RETRIES）+ 去重拦截（checkProblemNearDuplicate）
   * 4. 每道题命中后立刻 setProblems 追加，实现"先完成先显出"效果
   * 5. 全部完成后写入 storageService 持久化
   */
  const handleGenerate = async () => {
    setLoading(true);
    setProblems([]);
    storageService.clearLastProblems();

    // Why: try/finally 确保无论成功、中途抛出还是网络失败，loading 状态都能归零，
    //      避免界面永久卡在「生成中」。
    try {

    // 1. 解析章节名（自定义章节取 input 值）
    const chapterName =
      config.chapter === CUSTOM_CHAPTER_KEY
        ? customChapter.trim() || '综合性/未分类章节'
        : config.chapter;

    const knowledgePrefix = selectedKnowledgePoint
      ? `【重点考察知识点：${selectedKnowledgePoint}】`
      : '';

    // 2. 构建来自错题/笔记/题库的参考资料上下文
    let referenceContext = '';
    if (
      selectedRefs.wrongProblemIds.length > 0 ||
      selectedRefs.noteIds.length > 0 ||
      selectedRefs.qbankIds.length > 0
    ) {
      const allWrong = storageService.getWrongProblems();
      const allNotes = storageService.getNotes();
      const allQBank = storageService.getQBankItems();
      const pickedWrong = allWrong.filter(w => selectedRefs.wrongProblemIds.includes(w.id));
      const pickedNotes = allNotes.filter(n => selectedRefs.noteIds.includes(n.id));
      const pickedQBank = allQBank.filter(q => selectedRefs.qbankIds.includes(q.id));
      referenceContext = buildReferenceContext(pickedWrong, pickedNotes, pickedQBank);
    }

    const totalCount = config.count;
    let completedCount = 0;
    let successCount = 0;
    let generationTargetReached = false;

    // 批次内已接受题目的共享池，用于并行模式的跨请求去重
    const acceptedProblemsInBatch: MathProblem[] = [];

    const markGenerationTargetReached = () => {
      if (generationTargetReached || successCount < totalCount) return;
      generationTargetReached = true;
      setLoading(false);
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: `已达到目标数量 ${totalCount} 道，停止展示后续“构思中”占位并收敛生成状态。`,
      });
    };

    addLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'info',
      message: parallelMode
        ? `正在并行生成 ${totalCount} 道题目（所有请求同时发出，先完成先显示）...`
        : `正在逐题生成 ${totalCount} 道题目（每题基于前题去重）...`,
    });

    // 若使用本地网关供应商，提前 Ping /health 检查网关可用性。
    // Why: 网关进程刚启动时可能尚未完成监听，先预热再请求可降低首次失败率。
    const activeConfig = aiServiceRef.current.getConfig();
    if (activeConfig.backendProvider && isBackendEnabled()) {
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: '正在检查本地网关服务状态...',
      });
      let wakeAttemptCount = 0;
      const isAwake = await wakeUpBackend(6, (attempt) => {
        wakeAttemptCount = attempt;
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'warn',
          message: `本地网关尚未就绪，第 ${attempt} 次等待（最多 30 秒）...`,
        });
      });
      if (!isAwake) {
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'warn',
          message: '本地网关连接超时，将继续尝试（如持续失败请检查 VITE_BACKEND_URL、VITE_ENABLE_REMOTE_BACKEND 与网关进程状态）。',
        });
      } else if (wakeAttemptCount > 0) {
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'info',
          message: '本地网关已就绪，开始生成题目。',
        });
      }
    }

    /**
     * 生成单道题目，含重试和去重拦截。
     *
     * @param index            - 题目序号（仅用于日志展示）
     * @param existingProblems - 串行模式下已生成的题目，用于构造去重比对池
     * @returns 通过去重校验的题目数组（一般为 1 道，失败则为空数组）
     */
    const generateOne = async (
      index: number,
      existingProblems: MathProblem[] = []
    ): Promise<MathProblem[]> => {
      if (generationTargetReached || successCount >= totalCount) {
        return [];
      }

      const singleConfig: GenerateConfig = {
        ...config,
        chapter: chapterName,
        topic: knowledgePrefix + (config.topic || ''),
        referenceContext: referenceContext || undefined,
        count: 1,
      };

      // 记录已提前展示的题干 id，用于替换或移除占位。
      // Why: 题干生成完毕即显示，解析完成后用完整题目替换；
      //      若重试或去重失败则移除占位，保持 UI 状态一致。
      let earlyShownStemIds: string[] = [];

      const onStemsReady = (stems: MathProblem[]) => {
        if (generationTargetReached || successCount >= totalCount) {
          return;
        }
        earlyShownStemIds = stems.map(s => s.id);
        setProblems(prev => [
          ...prev,
          ...stems.map(s => ({
            ...s,
            answer: '',
            explanation: '解析生成中...',
            isExplanationStreaming: true,
          })),
        ]);
      };

      /**
       * 流式解析回调：每个 token 到达时更新对应题目的 explanation 字段。
       *
       * Why: 解析阶段流式输出替代骨架屏，用户实时看到推导过程逐字展现。
       *      采用累积拼接策略，每次 token 到达追加到 streamBuffer，
       *      再将 buffer 内容写入所有已展示题干的 explanation 中。
       */
      let streamBuffer = '';

      const onExplanationStream = (token: string) => {
        streamBuffer += token;
        const currentBuffer = streamBuffer;
        setProblems(prev =>
          prev.map(p =>
            earlyShownStemIds.includes(p.id)
              ? { ...p, explanation: currentBuffer, isExplanationStreaming: true }
              : p
          )
        );
      };

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (generationTargetReached || successCount >= totalCount) {
          if (earlyShownStemIds.length > 0) {
            setProblems(prev => prev.filter(p => !earlyShownStemIds.includes(p.id)));
            earlyShownStemIds = [];
          }
          return [];
        }

        try {
          // 合并串行已有+批次接受，构建完整比对池
          const comparisonPool = [...existingProblems, ...acceptedProblemsInBatch];

          // 每次重试重置流式缓冲区
          streamBuffer = '';

          const rawResult = await aiServiceRef.current.generateProblems(
            singleConfig,
            addLog,
            comparisonPool,
            onStemsReady,
            onExplanationStream
          );

          if (generationTargetReached || successCount >= totalCount) {
            if (earlyShownStemIds.length > 0) {
              setProblems(prev => prev.filter(p => !earlyShownStemIds.includes(p.id)));
              earlyShownStemIds = [];
            }
            return [];
          }

          // 模型偶尔会返回多道，截断只取 1 道
          const result = rawResult.slice(0, 1);

          const filtered = result.filter(problem => {
            const diversityCheck = checkProblemNearDuplicate(
              problem,
              comparisonPool,
              DEFAULT_DIVERSITY_GUARD_OPTIONS
            );
            if (!diversityCheck.isDuplicate) return true;

            addLog({
              timestamp: new Date().toLocaleTimeString(),
              level: 'warn',
              message: `第 ${index + 1} 号题目命中近重复拦截（相似度 ${(diversityCheck.score * 100).toFixed(1)}%），触发重试。`,
              details: diversityCheck.matchedQuestion
                ? `相似题：${diversityCheck.matchedQuestion.slice(0, 80)}${diversityCheck.matchedQuestion.length > 80 ? '...' : ''}`
                : undefined,
            });
            return false;
          });

          const completedProblems = filtered.map(problem => ({
            ...problem,
            isExplanationStreaming: false,
          }));

          if (completedProblems.length === 0) {
            // 去重失败：移除已提前展示的題干占位
            if (earlyShownStemIds.length > 0) {
              setProblems(prev => prev.filter(p => !earlyShownStemIds.includes(p.id)));
              earlyShownStemIds = [];
            }
            throw new Error('生成结果与已有题目过于相似，已触发自动重试。');
          }

          completedCount++;
          successCount++;
          acceptedProblemsInBatch.push(...completedProblems);
          markGenerationTargetReached();

          // 用含解析的完整题目替换占位；若题干未提前展示（如网络失败重试后成功），则直接追加
          setProblems(prev => {
            let updated: MathProblem[];
            if (earlyShownStemIds.length > 0) {
              // 替换占位：按 id 查找并更新
              updated = prev.map(p => {
                const full = completedProblems.find(f => f.id === p.id);
                return full ?? p;
              });
            } else {
              updated = [...prev, ...completedProblems];
            }
            storageService.saveLastProblems(updated);
            return updated;
          });

          addLog({
            timestamp: new Date().toLocaleTimeString(),
            level: 'success',
            message: `[进度 ${completedCount}/${totalCount}] 第 ${index + 1} 号题目已生成${attempt > 0 ? `（第 ${attempt + 1} 次尝试）` : ''}。`,
          });

          return completedProblems;
        } catch (error: any) {
          // 本次 attempt 失败：若题干已提前展示，先从 UI 移除占位，然后重试
          if (earlyShownStemIds.length > 0) {
            setProblems(prev => prev.filter(p => !earlyShownStemIds.includes(p.id)));
            earlyShownStemIds = [];
          }
          if (attempt < MAX_RETRIES) {
            if (generationTargetReached || successCount >= totalCount) {
              return [];
            }
            // Railway 后端休眠恢复需要 10-30 秒，Failed to fetch 时等待更长再重试。
            // Why: 立刻重试对「连接拒绝」无效，必须给 Railway 足够的启动时间。
            const isFetchError = error.message === 'Failed to fetch'
              || error.message?.includes('NetworkError')
              || error.message?.includes('Failed to fetch');
            addLog({
              timestamp: new Date().toLocaleTimeString(),
              level: 'warn',
              message: `第 ${index + 1} 号题目第 ${attempt + 1} 次失败，正在重试（剩余 ${MAX_RETRIES - attempt} 次）...`,
              details: error.message,
            });
            if (isFetchError) {
              await new Promise(r => setTimeout(r, 8000));
            }
          } else {
            completedCount++;
            addLog({
              timestamp: new Date().toLocaleTimeString(),
              level: 'error',
              message: `[进度 ${completedCount}/${totalCount}] 第 ${index + 1} 号题目经 ${MAX_RETRIES + 1} 次尝试仍失败，已跳过。`,
              details: error.message,
            });
          }
        }
      }
      return [];
    };

    // 3. 并行模式：所有请求同时发出，先完成先追加
    if (parallelMode) {
      const promises = Array.from({ length: totalCount }, (_, i) => generateOne(i));
      await Promise.allSettled(promises);
    } else {
      // 串行模式：逐题生成，将已有题目传入下一次请求做去重
      const allGenerated: MathProblem[] = [];
      for (let i = 0; i < totalCount; i++) {
        if (generationTargetReached || successCount >= totalCount) {
          break;
        }
        addLog({
          timestamp: new Date().toLocaleTimeString(),
          level: 'info',
          message: `[进度 ${i + 1}/${totalCount}] 正在生成第 ${i + 1} 道题目...`,
        });
        const result = await generateOne(i, allGenerated);
        allGenerated.push(...result);
      }
    }

    addLog({
      timestamp: new Date().toLocaleTimeString(),
      level: 'success',
      message: `全部完成：共成功生成 ${successCount}/${totalCount} 道题目。`,
    });

    } catch (err: any) {
      // 捕获 generateOne 之外的意外抛出（理论上极罕见）
      addLog({
        timestamp: new Date().toLocaleTimeString(),
        level: 'error',
        message: `生成流程意外中断，步骤[调度任务]，原因[${err?.message ?? '未知错误'}]。Hint: 请刷新页面后重试，或检查网络连接。`,
        category: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return { problems, setProblems, logs, setLogs, addLog, loading, handleGenerate };
}
