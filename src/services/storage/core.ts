/**
 * _storageCore.ts
 *
 * 单一职责：存放所有 localStorage key 常量 + 文件夹树形结构通用工具函数。
 *
 * Why: 此文件被 wrongProblemStorage / noteStorage / qbankStorage 等子模块共同依赖，
 *      独立出来避免子模块之间形成循环引用，同时确保 key 名称只在一处定义。
 *
 * 注意：本文件不依赖任何其他自定义模块，只依赖 ../types。
 */

import {
  DEFAULT_FOLDER_ID,
  DEFAULT_NOTE_FOLDER_ID,
  DEFAULT_QBANK_FOLDER_ID,
} from '@/types';

// ===== localStorage Key 常量 =====

export const STORAGE_KEY           = 'ai_math_wrong_problems';
export const CUSTOM_ERRORS_KEY     = 'ai_math_custom_errors';
export const PROVIDER_CONFIG_KEY   = 'ai_math_provider_config';
export const API_KEYS_STORAGE_KEY  = 'ai_math_api_keys';
export const DUAL_MODEL_CONFIG_KEY = 'ai_math_dual_model_config';
export const FOLDERS_KEY           = 'ai_math_wrong_folders';
export const CHAT_CONFIG_KEY       = 'ai_math_chat_config';
export const VISION_CONFIG_KEY     = 'ai_math_vision_config';
export const NOTE_FOLDERS_KEY      = 'ai_math_note_folders';
export const NOTES_KEY             = 'ai_math_notes';
export const QBANK_FOLDERS_KEY     = 'ai_math_qbank_folders';
export const QBANK_ITEMS_KEY       = 'ai_math_qbank_items';
export const LAST_PROBLEMS_KEY     = 'ai_math_last_problems';

export const STORAGE_DATA_CHANGED_EVENT = 'storage:data-changed';

function notifyStorageChanged(key: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STORAGE_DATA_CHANGED_EVENT, { detail: { key } }));
}

// ===== 错题本预设文件夹 =====

export const ROOT_PRESET_ERROR_FOLDERS = [
  '计算错误', '概念模糊', '逻辑不严密', '审题不清',
  '技巧缺失', '公式误用', '负号遗漏', '系数遗漏',
];
export const ROOT_PRESET_ERROR_FOLDER_NAME_SET = new Set(ROOT_PRESET_ERROR_FOLDERS);

// ===== 文件夹树形结构通用工具 =====

export interface FolderLike {
  id: string;
  name: string;
  parentId?: string;
  createdAt: number;
}

/** 三大默认根文件夹 ID 集合，用于边界判断 */
export const ROOT_FOLDER_IDS = new Set([
  DEFAULT_FOLDER_ID,
  DEFAULT_NOTE_FOLDER_ID,
  DEFAULT_QBANK_FOLDER_ID,
]);

/**
 * 规范化文件夹集合：去重、修复孤儿节点、确保默认根文件夹存在。
 *
 * @param rawFolders    - localStorage 中读取的原始数组
 * @param defaultFolder - 对应业务域的默认根文件夹对象
 * @param defaultId     - 对应业务域的默认根文件夹 ID
 */
export function normalizeFolderCollection<T extends FolderLike>(
  rawFolders: T[],
  defaultFolder: T,
  defaultId: string,
): T[] {
  const byId = new Map<string, T>();

  rawFolders.forEach(folder => {
    if (!folder || typeof folder.id !== 'string') return;
    const id = folder.id.trim();
    if (!id || byId.has(id)) return;
    const parentId =
      typeof folder.parentId === 'string' && folder.parentId.trim()
        ? folder.parentId.trim()
        : undefined;
    const name =
      typeof folder.name === 'string' && folder.name.trim()
        ? folder.name.trim()
        : '未命名文件夹';
    byId.set(id, { ...folder, id, name, parentId });
  });

  if (!byId.has(defaultId)) {
    byId.set(defaultId, { ...defaultFolder, parentId: undefined } as T);
  } else {
    const root = byId.get(defaultId)!;
    byId.set(defaultId, { ...root, name: defaultFolder.name, parentId: undefined, createdAt: 0 });
  }

  const validIds = new Set(byId.keys());
  byId.forEach((folder, id) => {
    if (id === defaultId) { folder.parentId = undefined; return; }
    if (folder.parentId === defaultId) { folder.parentId = undefined; return; }
    if (folder.parentId && (!validIds.has(folder.parentId) || folder.parentId === id)) {
      folder.parentId = undefined;
    }
  });

  return Array.from(byId.values());
}

/**
 * 规范化自定义错误类型存储（兼容旧版数组格式）。
 *
 * @param rawCustomErrors - localStorage 中读取的原始值
 * @param validFolderIds  - 当前有效的文件夹 ID 集合（用于过滤孤儿数据）
 */
export function normalizeCustomErrors(
  rawCustomErrors: unknown,
  validFolderIds: Set<string>,
): Record<string, string[]> {
  if (Array.isArray(rawCustomErrors)) {
    const list = rawCustomErrors
      .filter(t => typeof t === 'string')
      .map(t => t.trim())
      .filter(Boolean);
    return { [DEFAULT_FOLDER_ID]: Array.from(new Set(list)) };
  }
  if (!rawCustomErrors || typeof rawCustomErrors !== 'object') return {};

  const normalized: Record<string, string[]> = {};
  Object.entries(rawCustomErrors as Record<string, unknown>).forEach(([folderId, value]) => {
    if (!validFolderIds.has(folderId) || !Array.isArray(value)) return;
    const list = value.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean);
    if (list.length > 0) normalized[folderId] = Array.from(new Set(list));
  });
  return normalized;
}

// ===== 文件夹树形操作帮助函数（纯函数，供外部直接调用）=====

/**
 * 获取指定父文件夹的直接子文件夹。
 * @param folders  - 完整文件夹列表
 * @param parentId - 父文件夹 ID（undefined 表示顶层）
 */
export function getChildFolders<T extends FolderLike>(
  folders: T[],
  parentId: string | undefined,
): T[] {
  if (!parentId) {
    return folders.filter(
      f => (!f.parentId || ROOT_FOLDER_IDS.has(f.parentId)) && !ROOT_FOLDER_IDS.has(f.id),
    );
  }
  if (ROOT_FOLDER_IDS.has(parentId)) {
    return folders.filter(f => (!f.parentId || f.parentId === parentId) && !ROOT_FOLDER_IDS.has(f.id));
  }
  return folders.filter(f => f.parentId === parentId && !ROOT_FOLDER_IDS.has(f.id));
}

/**
 * 获取从根到目标文件夹的路径（面包屑）。
 * @param folders  - 完整文件夹列表
 * @param folderId - 目标文件夹 ID
 */
export function getFolderPath<T extends FolderLike>(folders: T[], folderId: string): T[] {
  const path: T[] = [];
  let current = folders.find(f => f.id === folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
  }
  return path;
}

/**
 * 递归获取所有后代文件夹 ID（用于删除时清理子树）。
 * @param folders  - 完整文件夹列表
 * @param folderId - 起始文件夹 ID
 */
export function getAllDescendantFolderIds<T extends FolderLike>(
  folders: T[],
  folderId: string,
): string[] {
  const descendants: string[] = [];
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = folders.filter(f => f.parentId === current);
    for (const child of children) {
      descendants.push(child.id);
      queue.push(child.id);
    }
  }
  return descendants;
}

/**
 * 将嵌套文件夹树平铺为带深度的数组（用于下拉选择器等 UI 渲染）。
 * @param folders - 完整文件夹列表
 */
export function flattenFolderTree<T extends FolderLike>(
  folders: T[],
): { folder: T; depth: number }[] {
  const result: { folder: T; depth: number }[] = [];
  const buildList = (parentId: string | undefined, depth: number) => {
    const children = getChildFolders(folders, parentId);
    for (const child of children) {
      result.push({ folder: child, depth });
      buildList(child.id, depth + 1);
    }
  };
  buildList(undefined, 0);
  return result;
}

// ===== 安全 localStorage 工具函数 =====

/**
 * 安全读取 localStorage（防止数据损坏导致 JSON.parse 抛出异常）。
 * @param key      - localStorage key
 * @param fallback - 解析失败时的默认值
 */
export function safeReadStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // 数据损坏：自动清除避免持续影响，返回兜底值
    localStorage.removeItem(key);
    notifyStorageChanged(key);
    return fallback;
  }
}

/**
 * 安全写入 localStorage（防止 JSON.stringify 异常或存储空间不足）。
 * @param key  - localStorage key
 * @param data - 要持久化的数据
 * @returns    - true 表示写入成功，false 表示失败
 */
export function safeWriteStorage<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    notifyStorageChanged(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全删除 localStorage，并广播数据变更事件。
 */
export function safeRemoveStorage(key: string): boolean {
  try {
    localStorage.removeItem(key);
    notifyStorageChanged(key);
    return true;
  } catch {
    return false;
  }
}
