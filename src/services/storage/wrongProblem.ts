/**
 * wrongProblemStorage.ts
 *
 * 单一职责：错题本文件夹 + 错题条目的 CRUD 操作。
 */

import {
  WrongProblem, WrongProblemFolder,
  DEFAULT_ERROR_TYPES, DEFAULT_FOLDER, DEFAULT_FOLDER_ID,
} from '@/types';
import {
  STORAGE_KEY, CUSTOM_ERRORS_KEY, FOLDERS_KEY,
  ROOT_PRESET_ERROR_FOLDERS, ROOT_PRESET_ERROR_FOLDER_NAME_SET,
  normalizeFolderCollection, safeReadStorage, safeWriteStorage,
} from './core';

// ===== 内部工具 =====

function isProtectedWrongFolder(folder: WrongProblemFolder | undefined): boolean {
  if (!folder) return false;
  if (folder.id.startsWith('preset_wrong_folder_')) return true;
  return !folder.parentId && ROOT_PRESET_ERROR_FOLDER_NAME_SET.has(folder.name.trim());
}

// ===== 错题文件夹管理 =====

export const wrongProblemStorageService = {

  getFolders(): WrongProblemFolder[] {
    const rawFolders = safeReadStorage<WrongProblemFolder[]>(FOLDERS_KEY, []);
    const folders = normalizeFolderCollection(rawFolders, DEFAULT_FOLDER, DEFAULT_FOLDER_ID);

    const rootFolderNameSet = new Set(
      folders
        .filter(f => f.id !== DEFAULT_FOLDER_ID && !f.parentId)
        .map(f => f.name.trim()),
    );

    let changed = folders.length !== rawFolders.length;
    ROOT_PRESET_ERROR_FOLDERS.forEach((name, index) => {
      if (rootFolderNameSet.has(name)) return;
      folders.push({ id: `preset_wrong_folder_${index + 1}`, name, createdAt: 0 });
      rootFolderNameSet.add(name);
      changed = true;
    });

    if (changed) safeWriteStorage(FOLDERS_KEY, folders);
    return folders;
  },

  addFolder(name: string, parentId?: string): WrongProblemFolder {
    const folders = this.getFolders();
    const newFolder: WrongProblemFolder = {
      id: 'folder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: name.trim(),
      parentId: parentId || undefined,
      createdAt: Date.now(),
    };
    folders.push(newFolder);
    safeWriteStorage(FOLDERS_KEY, folders);
    return newFolder;
  },

  renameFolder(id: string, newName: string) {
    const folders = this.getFolders();
    const folder = folders.find(f => f.id === id);
    if (folder && id !== DEFAULT_FOLDER_ID && !isProtectedWrongFolder(folder)) {
      folder.name = newName.trim();
      safeWriteStorage(FOLDERS_KEY, folders);
    }
  },

  removeFolder(id: string) {
    if (id === DEFAULT_FOLDER_ID) return;
    const folders = this.getFolders();
    const folder = folders.find(f => f.id === id);
    if (isProtectedWrongFolder(folder)) return;
    const parentId = folder?.parentId || undefined;
    const targetFolderId = parentId || DEFAULT_FOLDER_ID;

    folders.forEach(f => { if (f.parentId === id) f.parentId = parentId; });

    const problems = this.getWrongProblems();
    problems.forEach(p => { if (p.folderId === id) p.folderId = targetFolderId; });
    safeWriteStorage(STORAGE_KEY, problems);
    safeWriteStorage(FOLDERS_KEY, folders.filter(f => f.id !== id));
  },

  // ===== 错题条目管理 =====

  getWrongProblems(): WrongProblem[] {
    const problems = safeReadStorage<WrongProblem[]>(STORAGE_KEY, []);
    return problems.map(p => ({ ...p, folderId: p.folderId || DEFAULT_FOLDER_ID }));
  },

  getWrongProblemsByFolder(folderId: string): WrongProblem[] {
    return this.getWrongProblems().filter(p => p.folderId === folderId);
  },

  addWrongProblem(problem: WrongProblem) {
    const problems = this.getWrongProblems();
    const idx = problems.findIndex(p => p.id === problem.id);
    if (idx > -1) { problems[idx] = problem; } else { problems.push(problem); }
    safeWriteStorage(STORAGE_KEY, problems);
  },

  removeWrongProblem(id: string) {
    safeWriteStorage(STORAGE_KEY, this.getWrongProblems().filter(p => p.id !== id));
  },

  moveProblemToFolder(problemId: string, folderId: string) {
    const problems = this.getWrongProblems();
    const problem = problems.find(p => p.id === problemId);
    if (problem) {
      problem.folderId = folderId;
      safeWriteStorage(STORAGE_KEY, problems);
    }
  },

  getCustomErrorTypes(folderId?: string): string[] {
    const allCustom = safeReadStorage<Record<string, string[]>>(CUSTOM_ERRORS_KEY, {});
    if (Array.isArray(allCustom)) {
      const migrated: Record<string, string[]> = { [DEFAULT_FOLDER_ID]: allCustom as unknown as string[] };
      safeWriteStorage(CUSTOM_ERRORS_KEY, migrated);
      const folderCustom = folderId ? (migrated[folderId] || []) : (allCustom as unknown as string[]);
      return Array.from(new Set([...DEFAULT_ERROR_TYPES, ...folderCustom]));
    }
    const folderCustom = folderId ? (allCustom[folderId] || []) : Object.values(allCustom).flat();
    return Array.from(new Set([...DEFAULT_ERROR_TYPES, ...folderCustom]));
  },

  addCustomErrorType(type: string, folderId: string = DEFAULT_FOLDER_ID) {
    let allCustom = safeReadStorage<Record<string, string[]>>(CUSTOM_ERRORS_KEY, {});
    if (Array.isArray(allCustom)) allCustom = { [DEFAULT_FOLDER_ID]: allCustom as unknown as string[] };
    if (!allCustom[folderId]) allCustom[folderId] = [];
    if (!DEFAULT_ERROR_TYPES.includes(type) && !allCustom[folderId].includes(type)) {
      allCustom[folderId].push(type);
      safeWriteStorage(CUSTOM_ERRORS_KEY, allCustom);
    }
  },

  getErrorStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.getWrongProblems().forEach(p => { stats[p.errorType] = (stats[p.errorType] || 0) + 1; });
    return stats;
  },

  getErrorStatsByFolder(folderId: string): Record<string, number> {
    const stats: Record<string, number> = {};
    this.getWrongProblemsByFolder(folderId).forEach(p => {
      stats[p.errorType] = (stats[p.errorType] || 0) + 1;
    });
    return stats;
  },

  getFolderStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.getWrongProblems().forEach(p => { stats[p.folderId] = (stats[p.folderId] || 0) + 1; });
    return stats;
  },
};
