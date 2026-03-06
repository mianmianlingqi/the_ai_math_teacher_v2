/**
 * noteStorage.ts
 *
 * 单一职责：笔记本文件夹 + 笔记条目的 CRUD 操作。
 */

import {
  NoteFolder, NoteItem,
  DEFAULT_NOTE_FOLDER, DEFAULT_NOTE_FOLDER_ID,
} from '@/types';
import { NOTE_FOLDERS_KEY, NOTES_KEY, safeReadStorage, safeWriteStorage } from './core';

export const noteStorageService = {

  // ===== 笔记文件夹管理 =====

  getNoteFolders(): NoteFolder[] {
    const folders = safeReadStorage<NoteFolder[]>(NOTE_FOLDERS_KEY, []);
    const defaultFolder = folders.find(f => f.id === DEFAULT_NOTE_FOLDER_ID);
    if (!defaultFolder) {
      folders.unshift(DEFAULT_NOTE_FOLDER);
    } else {
      defaultFolder.name = DEFAULT_NOTE_FOLDER.name;
    }
    return folders;
  },

  addNoteFolder(name: string, parentId?: string): NoteFolder {
    const folders = this.getNoteFolders();
    const newFolder: NoteFolder = {
      id: 'nfolder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: name.trim(),
      parentId: parentId || undefined,
      createdAt: Date.now(),
    };
    folders.push(newFolder);
    safeWriteStorage(NOTE_FOLDERS_KEY, folders);
    return newFolder;
  },

  renameNoteFolder(id: string, newName: string) {
    const folders = this.getNoteFolders();
    const folder = folders.find(f => f.id === id);
    if (folder && id !== DEFAULT_NOTE_FOLDER_ID) {
      folder.name = newName.trim();
      safeWriteStorage(NOTE_FOLDERS_KEY, folders);
    }
  },

  removeNoteFolder(id: string) {
    if (id === DEFAULT_NOTE_FOLDER_ID) return;
    const allFolders = this.getNoteFolders();
    const folder = allFolders.find(f => f.id === id);
    const parentId = folder?.parentId || undefined;
    const targetFolderId = parentId || DEFAULT_NOTE_FOLDER_ID;

    allFolders.forEach(f => { if (f.parentId === id) f.parentId = parentId; });

    const notes = this.getNotes();
    notes.forEach(n => { if (n.folderId === id) n.folderId = targetFolderId; });
    safeWriteStorage(NOTES_KEY, notes);
    safeWriteStorage(NOTE_FOLDERS_KEY, allFolders.filter(f => f.id !== id));
  },

  // ===== 笔记条目管理 =====

  getNotes(): NoteItem[] {
    const notes = safeReadStorage<NoteItem[]>(NOTES_KEY, []);
    return notes.map(n => ({
      ...n,
      folderId: n.folderId || DEFAULT_NOTE_FOLDER_ID,
      tags: n.tags || [],
      images: n.images || [],
    }));
  },

  getNotesByFolder(folderId: string): NoteItem[] {
    return this.getNotes().filter(n => n.folderId === folderId);
  },

  saveNote(note: NoteItem) {
    const notes = this.getNotes();
    const idx = notes.findIndex(n => n.id === note.id);
    if (idx > -1) { notes[idx] = note; } else { notes.push(note); }
    safeWriteStorage(NOTES_KEY, notes);
  },

  removeNote(id: string) {
    safeWriteStorage(NOTES_KEY, this.getNotes().filter(n => n.id !== id));
  },

  getNoteFolderStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.getNotes().forEach(n => { stats[n.folderId] = (stats[n.folderId] || 0) + 1; });
    return stats;
  },

  getNoteTagsByFolder(folderId: string): string[] {
    const tags = new Set<string>();
    this.getNotesByFolder(folderId).forEach(n => n.tags.forEach(t => tags.add(t)));
    return Array.from(tags);
  },
};
