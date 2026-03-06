/**
 * problemCacheStorage.ts
 *
 * 单一职责：上次生成题目缓存 + 全量数据导入/导出。
 *
 * Why: exportAllData / importData 需要跨越所有域，因此放在最顶层的模块，
 *      其他子域模块均不依赖此文件，避免循环依赖。
 */

import { MathProblem, WrongProblemFolder, NoteFolder, QBankFolder } from '@/types';
import {
  DEFAULT_FOLDER, DEFAULT_FOLDER_ID,
  DEFAULT_NOTE_FOLDER, DEFAULT_NOTE_FOLDER_ID,
  DEFAULT_QBANK_FOLDER, DEFAULT_QBANK_FOLDER_ID,
} from '@/types';
import {
  STORAGE_KEY, CUSTOM_ERRORS_KEY, API_KEYS_STORAGE_KEY,
  PROVIDER_CONFIG_KEY, DUAL_MODEL_CONFIG_KEY, CHAT_CONFIG_KEY, VISION_CONFIG_KEY,
  NOTE_FOLDERS_KEY, NOTES_KEY, QBANK_FOLDERS_KEY, QBANK_ITEMS_KEY,
  LAST_PROBLEMS_KEY, FOLDERS_KEY,
  normalizeFolderCollection, normalizeCustomErrors, safeReadStorage, safeWriteStorage,
} from './core';
import { wrongProblemStorageService } from './wrongProblem';
import { noteStorageService } from './notes';
import { qbankStorageService } from './qbank';
import { settingsStorageService } from './settings';

export const problemCacheStorageService = {

  // ===== 上次生成题目缓存 =====

  getLastProblems(): MathProblem[] {
    return safeReadStorage<MathProblem[]>(LAST_PROBLEMS_KEY, []);
  },

  saveLastProblems(problems: MathProblem[]): void {
    safeWriteStorage(LAST_PROBLEMS_KEY, problems);
  },

  clearLastProblems(): void {
    localStorage.removeItem(LAST_PROBLEMS_KEY);
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
      noteFolders: noteStorageService.getNoteFolders(),
      notes: noteStorageService.getNotes(),
      qbankFolders: qbankStorageService.getQBankFolders(),
      qbankItems: qbankStorageService.getQBankItems(),
      exportedAt: new Date().toISOString(),
      version: '4.1',
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
        safeWriteStorage(PROVIDER_CONFIG_KEY, data.currentConfig);
      }

      // 7. 导入双模型配置（可选）
      if (data.dualModelConfig && typeof data.dualModelConfig === 'object') {
        safeWriteStorage(DUAL_MODEL_CONFIG_KEY, data.dualModelConfig);
      }

      // 8. 导入答疑对话模型配置（可选）
      if (data.chatConfig && typeof data.chatConfig === 'object') {
        safeWriteStorage(CHAT_CONFIG_KEY, data.chatConfig);
      }

      // 9. 导入视觉识别配置（可选）
      if (data.visionConfig && typeof data.visionConfig === 'object') {
        safeWriteStorage(VISION_CONFIG_KEY, data.visionConfig);
      }

      // 10. 导入笔记文件夹（可选）
      if (Array.isArray(data.noteFolders)) {
        safeWriteStorage(NOTE_FOLDERS_KEY, normalizedNoteFolders);
      }

      // 11. 导入笔记条目（可选）
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

      // 12. 导入题库文件夹（可选）
      if (Array.isArray(data.qbankFolders)) {
        safeWriteStorage(QBANK_FOLDERS_KEY, normalizedQBankFolders);
      }

      // 13. 导入题库条目（可选）
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

      const summary = types.length > 0 ? types.join('/') : '配置数据';
      return { success: true, message: `导入成功：${summary} (共 ${importCount} 条)。建议刷新页面以应用。` };
    } catch (e: unknown) {
      console.error(e);
      return { success: false, message: '导入失败，请检查文件格式是否正确' };
    }
  },
};
