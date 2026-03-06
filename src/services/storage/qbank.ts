/**
 * qbankStorage.ts
 *
 * 单一职责：题库文件夹 + 题库条目的 CRUD 操作。
 */

import {
  QBankFolder, QBankItem,
  DEFAULT_QBANK_FOLDER, DEFAULT_QBANK_FOLDER_ID,
} from '@/types';
import { QBANK_FOLDERS_KEY, QBANK_ITEMS_KEY, safeReadStorage, safeWriteStorage } from './core';

export const qbankStorageService = {

  // ===== 题库文件夹管理 =====

  getQBankFolders(): QBankFolder[] {
    const folders = safeReadStorage<QBankFolder[]>(QBANK_FOLDERS_KEY, []);
    const defaultFolder = folders.find(f => f.id === DEFAULT_QBANK_FOLDER_ID);
    if (!defaultFolder) {
      folders.unshift(DEFAULT_QBANK_FOLDER);
    } else {
      defaultFolder.name = DEFAULT_QBANK_FOLDER.name;
    }
    return folders;
  },

  addQBankFolder(name: string, parentId?: string): QBankFolder {
    const folders = this.getQBankFolders();
    const newFolder: QBankFolder = {
      id: 'qbf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: name.trim(),
      parentId: parentId || undefined,
      createdAt: Date.now(),
    };
    folders.push(newFolder);
    safeWriteStorage(QBANK_FOLDERS_KEY, folders);
    return newFolder;
  },

  renameQBankFolder(id: string, newName: string) {
    const folders = this.getQBankFolders();
    const folder = folders.find(f => f.id === id);
    if (folder && id !== DEFAULT_QBANK_FOLDER_ID) {
      folder.name = newName.trim();
      safeWriteStorage(QBANK_FOLDERS_KEY, folders);
    }
  },

  removeQBankFolder(id: string) {
    if (id === DEFAULT_QBANK_FOLDER_ID) return;
    const allFolders = this.getQBankFolders();
    const folder = allFolders.find(f => f.id === id);
    const parentId = folder?.parentId || undefined;
    const targetFolderId = parentId || DEFAULT_QBANK_FOLDER_ID;

    allFolders.forEach(f => { if (f.parentId === id) f.parentId = parentId; });

    const items = this.getQBankItems();
    items.forEach(q => { if (q.folderId === id) q.folderId = targetFolderId; });
    safeWriteStorage(QBANK_ITEMS_KEY, items);
    safeWriteStorage(QBANK_FOLDERS_KEY, allFolders.filter(f => f.id !== id));
  },

  // ===== 题库条目管理 =====

  getQBankItems(): QBankItem[] {
    const items = safeReadStorage<QBankItem[]>(QBANK_ITEMS_KEY, []);
    return items.map(q => ({
      ...q,
      folderId: q.folderId || DEFAULT_QBANK_FOLDER_ID,
      tags: q.tags || [],
      images: q.images || [],
      options: q.options || [],
    }));
  },

  getQBankItemsByFolder(folderId: string): QBankItem[] {
    return this.getQBankItems().filter(q => q.folderId === folderId);
  },

  saveQBankItem(item: QBankItem) {
    const items = this.getQBankItems();
    const idx = items.findIndex(q => q.id === item.id);
    if (idx > -1) { items[idx] = item; } else { items.push(item); }
    safeWriteStorage(QBANK_ITEMS_KEY, items);
  },

  removeQBankItem(id: string) {
    safeWriteStorage(QBANK_ITEMS_KEY, this.getQBankItems().filter(q => q.id !== id));
  },

  getQBankFolderStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.getQBankItems().forEach(q => { stats[q.folderId] = (stats[q.folderId] || 0) + 1; });
    return stats;
  },

  getQBankTagsByFolder(folderId: string): string[] {
    const tags = new Set<string>();
    this.getQBankItemsByFolder(folderId).forEach(q => q.tags.forEach(t => tags.add(t)));
    return Array.from(tags);
  },
};
