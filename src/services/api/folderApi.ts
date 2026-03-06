import {
  WrongProblemFolder,
  NoteFolder,
  QBankFolder,
  DEFAULT_FOLDER_ID,
  DEFAULT_NOTE_FOLDER_ID,
  DEFAULT_QBANK_FOLDER_ID,
} from '@/types';
import {
  storageService,
  getChildFolders,
  getFolderPath,
  getAllDescendantFolderIds,
  flattenFolderTree,
} from '@/services/storage';

export type FolderScope = 'wrong' | 'note' | 'qbank';
export type AnyFolder = WrongProblemFolder | NoteFolder | QBankFolder;
export const FOLDER_MANAGER_UPDATED_EVENT = 'folder-manager:updated';

const ROOT_CONFIG: Record<FolderScope, { id: string; name: string }> = {
  wrong: { id: DEFAULT_FOLDER_ID, name: '根目录' },
  note: { id: DEFAULT_NOTE_FOLDER_ID, name: '根目录' },
  qbank: { id: DEFAULT_QBANK_FOLDER_ID, name: '根目录' },
};

export const folderManagerApi = {
  emitUpdated(scope: FolderScope, action: 'add' | 'rename' | 'remove'): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(FOLDER_MANAGER_UPDATED_EVENT, { detail: { scope, action } }));
  },

  getRootId(scope: FolderScope): string {
    return ROOT_CONFIG[scope].id;
  },

  getRootName(scope: FolderScope): string {
    return ROOT_CONFIG[scope].name;
  },

  getFolders(scope: FolderScope): AnyFolder[] {
    if (scope === 'wrong') return storageService.getFolders();
    if (scope === 'note') return storageService.getNoteFolders();
    return storageService.getQBankFolders();
  },

  addFolder(scope: FolderScope, name: string, parentId?: string): AnyFolder {
    let created: AnyFolder;
    if (scope === 'wrong') created = storageService.addFolder(name, parentId);
    else if (scope === 'note') created = storageService.addNoteFolder(name, parentId);
    else created = storageService.addQBankFolder(name, parentId);
    this.emitUpdated(scope, 'add');
    return created;
  },

  renameFolder(scope: FolderScope, id: string, newName: string): void {
    if (scope === 'wrong') {
      storageService.renameFolder(id, newName);
      this.emitUpdated(scope, 'rename');
      return;
    }
    if (scope === 'note') {
      storageService.renameNoteFolder(id, newName);
      this.emitUpdated(scope, 'rename');
      return;
    }
    storageService.renameQBankFolder(id, newName);
    this.emitUpdated(scope, 'rename');
  },

  removeFolder(scope: FolderScope, id: string): void {
    if (scope === 'wrong') {
      storageService.removeFolder(id);
      this.emitUpdated(scope, 'remove');
      return;
    }
    if (scope === 'note') {
      storageService.removeNoteFolder(id);
      this.emitUpdated(scope, 'remove');
      return;
    }
    storageService.removeQBankFolder(id);
    this.emitUpdated(scope, 'remove');
  },

  getFolderStats(scope: FolderScope): Record<string, number> {
    if (scope === 'wrong') return storageService.getFolderStats();
    if (scope === 'note') return storageService.getNoteFolderStats();
    return storageService.getQBankFolderStats();
  },

  getItemCountByFolder(scope: FolderScope, folderId: string): number {
    if (scope === 'wrong') return storageService.getWrongProblemsByFolder(folderId).length;
    if (scope === 'note') return storageService.getNotesByFolder(folderId).length;
    return storageService.getQBankItemsByFolder(folderId).length;
  },

  getChildFolders,
  getFolderPath,
  getAllDescendantFolderIds,
  flattenFolderTree,
};
