/**
 * storageService.ts
 *
 * 薄编排层  聚合所有子域 service，对外提供统一的 storageService 对象。
 *
 * Why: 保持对外 API 不变（storageService.xxx()），同时把 810 行上帝 Service
 *      拆成 6 个各司其职的模块，方便维护与单独测试。
 *
 * 依赖方向：
 *   storageService (this file)
 *      problemCacheStorage   exportAllData / importData / cache
 *      wrongProblemStorage   错题 + 错题文件夹
 *      noteStorage           笔记 + 笔记文件夹
 *      qbankStorage          题库 + 题库文件夹
 *      settingsStorage       AI 配置 / API Key
 *      _storageCore          常量 + 树工具（无业务依赖）
 */

// 工具函数作为具名导出，供 ChatPanel / folderManagerApi 直接 import
export {
  getChildFolders,
  getFolderPath,
  getAllDescendantFolderIds,
  flattenFolderTree,
} from './core';

import { getChildFolders, getFolderPath, getAllDescendantFolderIds, flattenFolderTree } from './core';
import { wrongProblemStorageService } from './wrongProblem';
import { noteStorageService } from './notes';
import { qbankStorageService } from './qbank';
import { settingsStorageService } from './settings';
import { problemCacheStorageService } from './cache';

export const storageService = {
  // 树工具（保持 storageService.getChildFolders() 用法兼容）
  getChildFolders,
  getFolderPath,
  getAllDescendantFolderIds,
  flattenFolderTree,

  // 错题本
  ...wrongProblemStorageService,

  // 笔记本
  ...noteStorageService,

  // 题库
  ...qbankStorageService,

  // AI / 模型配置
  ...settingsStorageService,

  // 上次题目缓存 + 全量导入/导出
  ...problemCacheStorageService,
};
