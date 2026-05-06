/**
 * problemCacheStorage.ts
 *
 * 单一职责：上次生成题目缓存 + 全量数据导入/导出。
 *
 * Why: exportAllData / importData 需要跨越所有域，因此放在最顶层的模块，
 *      其他子域模块均不依赖此文件，避免循环依赖。
 */

import { MathProblem, WrongProblemFolder, NoteFolder, QBankFolder, AIProviderConfig } from '@/types';
import {
  DEFAULT_FOLDER, DEFAULT_FOLDER_ID,
  DEFAULT_NOTE_FOLDER, DEFAULT_NOTE_FOLDER_ID,
  DEFAULT_QBANK_FOLDER, DEFAULT_QBANK_FOLDER_ID,
} from '@/types';
import { DEFAULT_PROVIDER_CONFIG } from '@/constants';
import {
  STORAGE_KEY, CUSTOM_ERRORS_KEY, API_KEYS_STORAGE_KEY,
  PROVIDER_CONFIG_KEY, DUAL_MODEL_CONFIG_KEY, CHAT_CONFIG_KEY, VISION_CONFIG_KEY,
  NOTE_FOLDERS_KEY, NOTES_KEY, QBANK_FOLDERS_KEY, QBANK_ITEMS_KEY,
  LAST_PROBLEMS_KEY, FOLDERS_KEY, EXAM_PAPERS_KEY, ACTIVE_EXAM_PAPER_KEY, APP_UI_SETTINGS_KEY,
  normalizeFolderCollection, normalizeCustomErrors, safeReadStorage, safeRemoveStorage, safeWriteStorage,
} from './core';
import { wrongProblemStorageService } from './wrongProblem';
import { noteStorageService } from './notes';
import { qbankStorageService } from './qbank';
import { paperStorageService } from './papers';
import { settingsStorageService } from './settings';

// ===== AIProviderConfig 字段补全工具函数 =====

/**
 * 补全 AIProviderConfig 字段，确保所有必需字段存在。
 * 用于导入时恢复自定义供应商配置，防止字段缺失导致设置面板显示异常。
 *
 * @param config - 从备份中读取的 provider 配置对象
 * @returns 补全后的 AIProviderConfig 对象
 */
function normalizeProviderConfig(config: unknown): AIProviderConfig {
  if (!config || typeof config !== 'object') {
    return { ...DEFAULT_PROVIDER_CONFIG };
  }

  const c = config as Record<string, unknown>;

  return {
    id: typeof c.id === 'string' ? c.id : DEFAULT_PROVIDER_CONFIG.id,
    name: typeof c.name === 'string' ? c.name : DEFAULT_PROVIDER_CONFIG.name,
    baseURL: typeof c.baseURL === 'string' ? c.baseURL : DEFAULT_PROVIDER_CONFIG.baseURL,
    apiKey: typeof c.apiKey === 'string' ? c.apiKey : '',
    model: typeof c.model === 'string' ? c.model : DEFAULT_PROVIDER_CONFIG.model,
    maxTokens: typeof c.maxTokens === 'number' ? c.maxTokens : DEFAULT_PROVIDER_CONFIG.maxTokens,
    temperature: typeof c.temperature === 'number' ? c.temperature : DEFAULT_PROVIDER_CONFIG.temperature,
    timeout: typeof c.timeout === 'number' ? c.timeout : (DEFAULT_PROVIDER_CONFIG.timeout ?? 300),
    backendProvider: typeof c.backendProvider === 'string' ? c.backendProvider : undefined,
  };
}

export const problemCacheStorageService = {

  // ===== 上次生成题目缓存 =====

  getLastProblems(): MathProblem[] {
    return safeReadStorage<MathProblem[]>(LAST_PROBLEMS_KEY, []);
  },

  saveLastProblems(problems: MathProblem[]): void {
    safeWriteStorage(LAST_PROBLEMS_KEY, problems);
  },

  clearLastProblems(): void {
    safeRemoveStorage(LAST_PROBLEMS_KEY);
  },

  // ===== 全量数据导出 =====

  /**
   * 将所有本地数据序列化为 JSON 字符串，供用户下载备份。
   *
   * Why: 需要聚合所有域的数据，作为跨域聚合层，统一在此处调用各子域 service。
   *
   * @returns 格式化后的 JSON 字符串
   */
  exportAllData(): string {
    const data = {
      wrongProblems: wrongProblemStorageService.getWrongProblems(),
      folders: wrongProblemStorageService.getFolders(),
      customErrors: safeReadStorage<Record<string, unknown>>(CUSTOM_ERRORS_KEY, {}),
      providerConfigs: safeReadStorage<Record<string, unknown>>(API_KEYS_STORAGE_KEY, {}),
      currentConfig: settingsStorageService.getProviderConfig(),
      dualModelConfig: settingsStorageService.getDualModelConfig(),
      chatConfig: settingsStorageService.getChatConfig(),
      visionConfig: settingsStorageService.getVisionConfig(),
      appUiSettings: settingsStorageService.getAppUiSettings(),
      noteFolders: noteStorageService.getNoteFolders(),
      notes: noteStorageService.getNotes(),
      qbankFolders: qbankStorageService.getQBankFolders(),
      qbankItems: qbankStorageService.getQBankItems(),
      examPapers: paperStorageService.getExamPapers(),
      activeExamPaperId: safeReadStorage<string | null>(ACTIVE_EXAM_PAPER_KEY, null),
      lastProblems: this.getLastProblems(),
      exportedAt: new Date().toISOString(),
      version: '4.4',
    };
    return JSON.stringify(data, null, 2);
  },

  // ===== 全量数据导入 =====

  /**
   * 解析 JSON 备份文件并写入 localStorage，支持部分导入与旧版本兼容。
   *
   * Why: 直接操作 localStorage 而非调用子域 service，是为了保证导入操作的原子性——
   *      一次性批量写入，避免中途调用 getXxx() 读取到尚未写入的脏数据。
   *
   * @param jsonString - 用户上传的备份 JSON 字符串
   * @returns 导入结果：{ success, message }
   */
  importData(jsonString: string): { success: boolean; message: string } {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse(jsonString) as Record<string, any>;
      let importCount = 0;
      const types: string[] = [];

      // 1. 规范化文件夹集合（确保默认文件夹存在）
      const normalizedWrongFolders: WrongProblemFolder[] = Array.isArray(data.folders)
        ? normalizeFolderCollection<WrongProblemFolder>(data.folders, DEFAULT_FOLDER, DEFAULT_FOLDER_ID)
        : wrongProblemStorageService.getFolders();
      const wrongFolderIds = new Set(normalizedWrongFolders.map(f => f.id));

      const normalizedNoteFolders: NoteFolder[] = Array.isArray(data.noteFolders)
        ? normalizeFolderCollection<NoteFolder>(data.noteFolders, DEFAULT_NOTE_FOLDER, DEFAULT_NOTE_FOLDER_ID)
        : noteStorageService.getNoteFolders();
      const noteFolderIds = new Set(normalizedNoteFolders.map(f => f.id));

      const normalizedQBankFolders: QBankFolder[] = Array.isArray(data.qbankFolders)
        ? normalizeFolderCollection<QBankFolder>(data.qbankFolders, DEFAULT_QBANK_FOLDER, DEFAULT_QBANK_FOLDER_ID)
        : qbankStorageService.getQBankFolders();
      const qbankFolderIds = new Set(normalizedQBankFolders.map(f => f.id));

      // 2. 导入错题（可选）
      if (Array.isArray(data.wrongProblems)) {
        const problems = data.wrongProblems.map((p: { folderId?: string } & Record<string, unknown>) => ({
          ...p,
          folderId: p.folderId && wrongFolderIds.has(p.folderId) ? p.folderId : DEFAULT_FOLDER_ID,
        }));
        safeWriteStorage(STORAGE_KEY, problems);
        types.push('错题');
        importCount += problems.length;
      }

      // 3. 导入错题文件夹（可选）
      if (Array.isArray(data.folders)) {
        safeWriteStorage(FOLDERS_KEY, normalizedWrongFolders);
      }

      // 4. 导入自定义错误类型（可选，兼容旧数组格式和新对象格式）
      if (data.customErrors) {
        const normalizedCustomErrors = normalizeCustomErrors(data.customErrors, wrongFolderIds);
        safeWriteStorage(CUSTOM_ERRORS_KEY, normalizedCustomErrors);
      }

      // 5. 导入各供应商 API 密钥（可选）
      if (data.providerConfigs && typeof data.providerConfigs === 'object') {
        safeWriteStorage(API_KEYS_STORAGE_KEY, data.providerConfigs);
      }

      // 6. 导入当前模型配置（可选）
      if (data.currentConfig && typeof data.currentConfig === 'object') {
        const normalizedConfig = normalizeProviderConfig(data.currentConfig);
        safeWriteStorage(PROVIDER_CONFIG_KEY, normalizedConfig);
      }

      // 7. 导入双模型配置（可选）
      if (data.dualModelConfig && typeof data.dualModelConfig === 'object') {
        const normalizedDualConfig = {
          ...data.dualModelConfig,
          provider: data.dualModelConfig.provider
            ? normalizeProviderConfig(data.dualModelConfig.provider)
            : null,
        };
        safeWriteStorage(DUAL_MODEL_CONFIG_KEY, normalizedDualConfig);
      }

      // 8. 导入答疑对话模型配置（可选）
      if (data.chatConfig && typeof data.chatConfig === 'object') {
        const normalizedChatConfig = {
          ...data.chatConfig,
          provider: data.chatConfig.provider
            ? normalizeProviderConfig(data.chatConfig.provider)
            : null,
        };
        safeWriteStorage(CHAT_CONFIG_KEY, normalizedChatConfig);
      }

      // 9. 导入视觉识别配置（可选）
      if (data.visionConfig && typeof data.visionConfig === 'object') {
        const normalizedVisionConfig = {
          ...data.visionConfig,
          provider: data.visionConfig.provider
            ? normalizeProviderConfig(data.visionConfig.provider)
            : null,
        };
        safeWriteStorage(VISION_CONFIG_KEY, normalizedVisionConfig);
      }

      // 10. 导入应用界面设置（可选）
      if (data.appUiSettings && typeof data.appUiSettings === 'object') {
        safeWriteStorage(APP_UI_SETTINGS_KEY, data.appUiSettings);
      }

      // 11. 导入笔记文件夹（可选）
      if (Array.isArray(data.noteFolders)) {
        safeWriteStorage(NOTE_FOLDERS_KEY, normalizedNoteFolders);
      }

      // 12. 导入笔记条目（可选）
      if (Array.isArray(data.notes)) {
        const notes = data.notes.map((n: { folderId?: string; tags?: unknown; images?: unknown } & Record<string, unknown>) => ({
          ...n,
          folderId: n.folderId && noteFolderIds.has(n.folderId) ? n.folderId : DEFAULT_NOTE_FOLDER_ID,
          tags: Array.isArray(n.tags) ? n.tags : [],
          images: Array.isArray(n.images) ? n.images : [],
        }));
        safeWriteStorage(NOTES_KEY, notes);
        types.push('笔记');
        importCount += notes.length;
      }

      // 13. 导入题库文件夹（可选）
      if (Array.isArray(data.qbankFolders)) {
        safeWriteStorage(QBANK_FOLDERS_KEY, normalizedQBankFolders);
      }

      // 14. 导入题库条目（可选）
      if (Array.isArray(data.qbankItems)) {
        const qbankItems = data.qbankItems.map((q: { folderId?: string; tags?: unknown; images?: unknown; options?: unknown } & Record<string, unknown>) => ({
          ...q,
          folderId: q.folderId && qbankFolderIds.has(q.folderId) ? q.folderId : DEFAULT_QBANK_FOLDER_ID,
          tags: Array.isArray(q.tags) ? q.tags : [],
          images: Array.isArray(q.images) ? q.images : [],
          options: Array.isArray(q.options) ? q.options : [],
        }));
        safeWriteStorage(QBANK_ITEMS_KEY, qbankItems);
        types.push('题库');
        importCount += qbankItems.length;
      }

      // 15. 导入试卷草稿（可选）
      if (Array.isArray(data.examPapers)) {
        const examPapers = paperStorageService.normalizeExamPapers(data.examPapers);
        safeWriteStorage(EXAM_PAPERS_KEY, examPapers);
        if (
          typeof data.activeExamPaperId === 'string' &&
          examPapers.some(paper => paper.id === data.activeExamPaperId)
        ) {
          safeWriteStorage(ACTIVE_EXAM_PAPER_KEY, data.activeExamPaperId);
        } else if (examPapers[0]) {
          safeWriteStorage(ACTIVE_EXAM_PAPER_KEY, examPapers[0].id);
        } else {
          safeRemoveStorage(ACTIVE_EXAM_PAPER_KEY);
        }
        types.push('试卷');
        importCount += examPapers.length;
      }

      // 16. 导入最近一次生成题目缓存（可选）
      if (Array.isArray(data.lastProblems)) {
        safeWriteStorage(LAST_PROBLEMS_KEY, data.lastProblems);
      } else {
        safeRemoveStorage(LAST_PROBLEMS_KEY);
      }

      const summary = types.length > 0 ? types.join('/') : '配置数据';
      return { success: true, message: `导入成功：${summary} (共 ${importCount} 条)。建议刷新页面以应用。` };
    } catch (e: unknown) {
      console.error(e);
      return { success: false, message: '导入失败，请检查文件格式是否正确' };
    }
  },
};
