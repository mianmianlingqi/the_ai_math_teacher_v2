
import React, { useState, useEffect, useMemo } from 'react';
import {
  WrongProblem,
  WrongProblemFolder,
  NoteItem,
  NoteFolder,
  QBankItem,
  QBankFolder,
  DEFAULT_FOLDER_ID,
  DEFAULT_NOTE_FOLDER_ID,
  DEFAULT_QBANK_FOLDER_ID,
  SelectedReferences,
  EMPTY_REFERENCES,
} from '@/types';
import { storageService } from '@/services/storage';
import { folderManagerApi, FOLDER_MANAGER_UPDATED_EVENT } from '@/services/api/folderApi';
import { referenceSelectorApi } from '@/services/api/refApi';

// 向后兼容的 re-export（定义已迁移至 @/types 和 @/services/ai/promptBuilder）
export type { SelectedReferences } from '@/types'; // 类型向后兼容 re-export
export { EMPTY_REFERENCES } from '@/types'; // 值向后兼容 re-export
export { buildReferenceContext } from '@/services/ai/promptBuilder'; // 向后兼容 re-export

// ===== 主组件 =====

interface ReferenceSelectorProps {
  selected: SelectedReferences;
  onChange: (refs: SelectedReferences) => void;
}

export const ReferenceSelector: React.FC<ReferenceSelectorProps> = ({ selected, onChange }) => {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'wrong' | 'note' | 'qbank'>('qbank');
  const [searchTerm, setSearchTerm] = useState('');

  // 错题数据
  const [wrongFolders, setWrongFolders] = useState<WrongProblemFolder[]>([]);
  const [wrongProblems, setWrongProblems] = useState<WrongProblem[]>([]);
  const [wrongCurrentFolderId, setWrongCurrentFolderId] = useState<string | undefined>(undefined);

  // 笔记数据
  const [noteFolders, setNoteFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [noteCurrentFolderId, setNoteCurrentFolderId] = useState<string | undefined>(undefined);

  // 题库数据
  const [qbankFolders, setQBankFolders] = useState<QBankFolder[]>([]);
  const [qbankItems, setQBankItems] = useState<QBankItem[]>([]);
  const [qbankCurrentFolderId, setQbankCurrentFolderId] = useState<string | undefined>(undefined);

  const totalSelected = selected.wrongProblemIds.length + selected.noteIds.length + selected.qbankIds.length;

  const switchTab = (nextTab: 'wrong' | 'note' | 'qbank') => {
    setTab(nextTab);
    setSearchTerm('');
    setWrongCurrentFolderId(undefined);
    setNoteCurrentFolderId(undefined);
    setQbankCurrentFolderId(undefined);

    if (nextTab === 'wrong') {
      setWrongProblems(storageService.getWrongProblemsByFolder(DEFAULT_FOLDER_ID));
      setNotes([]);
      setQBankItems([]);
      return;
    }

    if (nextTab === 'note') {
      setNotes(storageService.getNotesByFolder(DEFAULT_NOTE_FOLDER_ID));
      setWrongProblems([]);
      setQBankItems([]);
      return;
    }

    setQBankItems(storageService.getQBankItemsByFolder(DEFAULT_QBANK_FOLDER_ID));
    setWrongProblems([]);
    setNotes([]);
  };

  const reloadFolderData = () => {
    setWrongFolders(folderManagerApi.getFolders('wrong') as WrongProblemFolder[]);
    setNoteFolders(folderManagerApi.getFolders('note') as NoteFolder[]);
    setQBankFolders(folderManagerApi.getFolders('qbank') as QBankFolder[]);
  };

  const reloadActiveItems = () => {
    setWrongProblems(storageService.getWrongProblemsByFolder(wrongCurrentFolderId || DEFAULT_FOLDER_ID));
    setNotes(storageService.getNotesByFolder(noteCurrentFolderId || DEFAULT_NOTE_FOLDER_ID));
    setQBankItems(storageService.getQBankItemsByFolder(qbankCurrentFolderId || DEFAULT_QBANK_FOLDER_ID));
  };

  useEffect(() => {
    if (expanded) {
      reloadFolderData();
      reloadActiveItems();
    }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;

    const handleFolderUpdated = () => {
      reloadFolderData();
      reloadActiveItems();
    };

    const handleStorageChanged = () => {
      reloadFolderData();
      reloadActiveItems();
    };

    window.addEventListener(FOLDER_MANAGER_UPDATED_EVENT, handleFolderUpdated as EventListener);
    window.addEventListener('storage', handleStorageChanged);

    return () => {
      window.removeEventListener(FOLDER_MANAGER_UPDATED_EVENT, handleFolderUpdated as EventListener);
      window.removeEventListener('storage', handleStorageChanged);
    };
  }, [expanded, wrongCurrentFolderId, noteCurrentFolderId, qbankCurrentFolderId]);

  useEffect(() => {
    setWrongProblems(storageService.getWrongProblemsByFolder(wrongCurrentFolderId || DEFAULT_FOLDER_ID));
  }, [wrongCurrentFolderId]);

  useEffect(() => {
    setNotes(storageService.getNotesByFolder(noteCurrentFolderId || DEFAULT_NOTE_FOLDER_ID));
  }, [noteCurrentFolderId]);

  useEffect(() => {
    setQBankItems(storageService.getQBankItemsByFolder(qbankCurrentFolderId || DEFAULT_QBANK_FOLDER_ID));
  }, [qbankCurrentFolderId]);

  const filteredWrongProblems = useMemo(() => {
    if (!searchTerm.trim()) return wrongProblems;
    const q = searchTerm.toLowerCase();
    return wrongProblems.filter(p => p.question.toLowerCase().includes(q) || p.errorType.toLowerCase().includes(q));
  }, [wrongProblems, searchTerm]);

  const filteredNotes = useMemo(() => {
    if (!searchTerm.trim()) return notes;
    const q = searchTerm.toLowerCase();
    return notes.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  }, [notes, searchTerm]);

  const filteredQBankItems = useMemo(() => {
    if (!searchTerm.trim()) return qbankItems;
    const q = searchTerm.toLowerCase();
    return qbankItems.filter(item =>
      item.question.toLowerCase().includes(q)
      || item.answer.toLowerCase().includes(q)
      || item.explanation.toLowerCase().includes(q)
      || item.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }, [qbankItems, searchTerm]);

  const toggleWrongProblem = (id: string) => {
    const ids = selected.wrongProblemIds.includes(id)
      ? selected.wrongProblemIds.filter(x => x !== id)
      : [...selected.wrongProblemIds, id];
    onChange({ ...selected, wrongProblemIds: ids });
  };

  const toggleNote = (id: string) => {
    const ids = selected.noteIds.includes(id)
      ? selected.noteIds.filter(x => x !== id)
      : [...selected.noteIds, id];
    onChange({ ...selected, noteIds: ids });
  };

  const toggleQBank = (id: string) => {
    const ids = selected.qbankIds.includes(id)
      ? selected.qbankIds.filter(x => x !== id)
      : [...selected.qbankIds, id];
    onChange({ ...selected, qbankIds: ids });
  };

  const clearAll = () => {
    onChange(EMPTY_REFERENCES);
  };

  // 截断文本
  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;

  // 简易 LaTeX 预览（去掉 $ 标记）
  const stripLatex = (s: string) => s.replace(/\$\$?/g, '').replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}]/g, '');

  // ===== 通用文件管理器渲染器 =====
  const colorStyles = {
    rose: { bg: 'bg-rose-50', text: 'text-rose-500', border: 'hover:border-rose-200', hoverBg: 'hover:bg-rose-50/30', crumbActive: 'text-rose-600', crumbHover: 'hover:text-rose-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-500', border: 'hover:border-emerald-200', hoverBg: 'hover:bg-emerald-50/30', crumbActive: 'text-emerald-600', crumbHover: 'hover:text-emerald-600' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-500', border: 'hover:border-indigo-200', hoverBg: 'hover:bg-indigo-50/30', crumbActive: 'text-indigo-600', crumbHover: 'hover:text-indigo-600' },
  };

  function renderFileManager<T extends { id: string }>(
    allFolders: { id: string; name: string; parentId?: string; createdAt: number }[],
    currentFolderId: string | undefined,
    setCurrentFolderId: (id: string | undefined) => void,
    items: T[],
    color: 'rose' | 'emerald' | 'indigo',
    countFn: (folderId: string) => number,
    renderItem: (item: any) => React.ReactNode,
    emptyText: string,
  ): React.ReactNode {
    const c = colorStyles[color];
    const { childFolders, breadcrumbFolders, folderRows, showRootRow } = referenceSelectorApi.getFolderInteractionData(
      allFolders,
      currentFolderId,
      countFn,
    );

    // 面包屑
    const breadcrumb = currentFolderId ? (
      <div className="flex items-center gap-1 text-[11px] font-bold mb-2.5 px-0.5 flex-wrap">
        <button onClick={() => referenceSelectorApi.goToRoot(setCurrentFolderId)} className={`text-slate-400 ${c.crumbHover} transition-all flex items-center gap-0.5`} title="返回根目录">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" /></svg>
        </button>
        {breadcrumbFolders.map((folder) => (
          <React.Fragment key={folder.id}>
            <svg className="w-2.5 h-2.5 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <button
              onClick={() => referenceSelectorApi.openFolder(folder.id, setCurrentFolderId)}
              className={`truncate max-w-[70px] ${folder.id === currentFolderId ? c.crumbActive : `text-slate-400 ${c.crumbHover}`} transition-all`}
            >
              {folder.name}
            </button>
          </React.Fragment>
        ))}
      </div>
    ) : null;

    const rootRow = showRootRow ? (
      <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] font-black text-slate-700">
        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" /></svg>
        根目录
      </div>
    ) : null;

    // 文件夹列表
    const folderList = folderRows.length > 0 ? folderRows.map(folder => {
      return (
        <button
          key={folder.id}
          onClick={() => referenceSelectorApi.openFolder(folder.id, setCurrentFolderId)}
          className={`w-full text-left p-3.5 rounded-2xl border border-slate-200 ${c.border} ${c.hoverBg} transition-all flex items-center justify-between group bg-white shadow-sm`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-10 h-10 rounded-xl ${c.bg} ${c.text} flex items-center justify-center flex-shrink-0`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-black text-slate-700 truncate">{folder.name}</div>
              <div className="text-[12px] text-slate-400 font-bold">
                {folder.itemCount} 项{folder.subFolderCount > 0 ? ` · ${folder.subFolderCount} 个子文件夹` : ''}
              </div>
            </div>
          </div>
          <svg className="w-5 h-5 text-slate-300 group-hover:text-slate-400 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      );
    }) : null;

    // 分隔线（仅在文件夹和题目同时存在时）
    const divider = childFolders.length > 0 && items.length > 0 ? (
      <div className="flex items-center gap-2 mt-1.5 mb-0.5 px-0.5">
        <div className="h-px flex-1 bg-slate-100"></div>
        <span className="text-[9px] font-bold text-slate-300">本目录条目</span>
        <div className="h-px flex-1 bg-slate-100"></div>
      </div>
    ) : null;

    // 条目列表
    const itemList = items.length > 0
      ? items.map(item => renderItem(item))
      : (childFolders.length === 0
        ? <p className="text-center text-[10px] text-slate-400 font-medium py-4">{emptyText}</p>
        : null);

    return (
      <>
        {rootRow}
        {breadcrumb}
        {folderList}
        {divider}
        {itemList}
      </>
    );
  }

  return (
    <div className="space-y-3 animate-fadeIn">
      {/* Header toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <label className="block text-[14px] font-black text-slate-500 ml-2 cursor-pointer group-hover:text-sky-500 transition-colors">
          参考资料（题库/错题/笔记）
          {totalSelected > 0 && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-black normal-case tracking-normal">
              已选 {totalSelected} 项
            </span>
          )}
        </label>
        <svg className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden animate-expandDown shadow-sm">
          {/* Tabs */}
          <div className="flex border-b border-slate-100 bg-slate-50/50">
            <button
              onClick={() => switchTab('qbank')}
              className={`flex-1 py-3 text-[14px] font-black transition-all ${
                tab === 'qbank' ? 'text-indigo-500 bg-white border-b-[3px] border-indigo-500' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              题库
            </button>
            <button
              onClick={() => switchTab('wrong')}
              className={`flex-1 py-3 text-[14px] font-black transition-all ${
                tab === 'wrong' ? 'text-rose-500 bg-white border-b-[3px] border-rose-500' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              错题
            </button>
            <button
              onClick={() => switchTab('note')}
              className={`flex-1 py-3 text-[14px] font-black transition-all ${
                tab === 'note' ? 'text-emerald-500 bg-white border-b-[3px] border-emerald-500' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              笔记
            </button>
          </div>

          <div className="p-4 space-y-3">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-[15px] font-bold text-slate-700 outline-none focus:border-sky-300 transition-all placeholder:text-slate-300"
                placeholder="搜索..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            {/* File Manager Content */}
            <div key={tab} className="max-h-72 overflow-y-auto space-y-2.5 custom-scrollbar">
              {tab === 'wrong' && renderFileManager(
                wrongFolders, wrongCurrentFolderId, setWrongCurrentFolderId,
                filteredWrongProblems,
                'rose',
                (fid) => folderManagerApi.getItemCountByFolder('wrong', fid),
                (wp) => {
                  const isChecked = selected.wrongProblemIds.includes(wp.id);
                  return (
                    <label
                      key={wp.id}
                      className={`flex items-start gap-2 p-2 rounded-xl cursor-pointer transition-all ${
                        isChecked ? 'bg-rose-50 border border-rose-200' : 'bg-white border border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <input type="checkbox" checked={isChecked} onChange={() => toggleWrongProblem(wp.id)}
                        className="mt-0.5 rounded text-rose-500 focus:ring-rose-300 w-3.5 h-3.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-slate-700 leading-snug">{truncate(stripLatex(wp.question), 60)}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[9px] font-bold border border-rose-100">{wp.errorType}</span>
                        </div>
                      </div>
                    </label>
                  );
                },
                '暂无错题'
              )}

              {tab === 'note' && renderFileManager(
                noteFolders, noteCurrentFolderId, setNoteCurrentFolderId,
                filteredNotes,
                'emerald',
                (fid) => folderManagerApi.getItemCountByFolder('note', fid),
                (note) => {
                  const isChecked = selected.noteIds.includes(note.id);
                  return (
                    <label
                      key={note.id}
                      className={`flex items-start gap-2 p-2 rounded-xl cursor-pointer transition-all ${
                        isChecked ? 'bg-emerald-50 border border-emerald-200' : 'bg-white border border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <input type="checkbox" checked={isChecked} onChange={() => toggleNote(note.id)}
                        className="mt-0.5 rounded text-emerald-500 focus:ring-emerald-300 w-3.5 h-3.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-slate-700 leading-snug">{note.title}</p>
                        <p className="text-[10px] text-slate-400 font-medium leading-snug mt-0.5 truncate">
                          {truncate(note.content || '(纯图片笔记)', 50)}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5">
                          {note.images.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[9px] font-bold border border-amber-100">{note.images.length} 图</span>
                          )}
                          {note.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[9px] font-bold border border-emerald-100">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </label>
                  );
                },
                '暂无笔记'
              )}

              {tab === 'qbank' && renderFileManager(
                qbankFolders, qbankCurrentFolderId, setQbankCurrentFolderId,
                filteredQBankItems,
                'indigo',
                (fid) => folderManagerApi.getItemCountByFolder('qbank', fid),
                (item) => {
                  const isChecked = selected.qbankIds.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`flex items-start gap-2 p-2 rounded-xl cursor-pointer transition-all ${
                        isChecked ? 'bg-indigo-50 border border-indigo-200' : 'bg-white border border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <input type="checkbox" checked={isChecked} onChange={() => toggleQBank(item.id)}
                        className="mt-0.5 rounded text-indigo-500 focus:ring-indigo-300 w-3.5 h-3.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-slate-700 leading-snug">{truncate(stripLatex(item.question), 60)}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {item.questionType && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[9px] font-bold border border-indigo-100">{item.questionType}</span>
                          )}
                          {item.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 text-[9px] font-bold border border-slate-100">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </label>
                  );
                },
                '暂无题目'
              )}
            </div>

            {/* Selected count & clear */}
            {totalSelected > 0 && (
              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <span className="text-[10px] font-bold text-slate-500">
                  已选 {selected.wrongProblemIds.length > 0 ? `${selected.wrongProblemIds.length} 道错题` : ''}
                  {selected.wrongProblemIds.length > 0 && selected.noteIds.length > 0 ? ' + ' : ''}
                  {selected.noteIds.length > 0 ? `${selected.noteIds.length} 篇笔记` : ''}
                  {(selected.wrongProblemIds.length > 0 || selected.noteIds.length > 0) && selected.qbankIds.length > 0 ? ' + ' : ''}
                  {selected.qbankIds.length > 0 ? `${selected.qbankIds.length} 道题库题目` : ''}
                </span>
                <button
                  onClick={clearAll}
                  className="text-[10px] font-bold text-rose-500 hover:text-rose-700 transition-colors"
                >
                  清除全部
                </button>
              </div>
            )}

            {/* Image warning */}
            {selected.noteIds.length > 0 && (
              <div className="flex items-start gap-1.5 px-2 py-1.5 bg-amber-50 border border-amber-100 rounded-xl">
                <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-[10px] font-medium text-amber-700 leading-relaxed">
                  笔记中的图片不会传给 AI（多数模型不支持图片），仅传入文字内容作为出题参考。
                </p>
              </div>
            )}
            {selected.qbankIds.length > 0 && (
              <div className="flex items-start gap-1.5 px-2 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl">
                <svg className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-[10px] font-medium text-indigo-700 leading-relaxed">
                  题库题目如包含图片，仅会传入文字内容作为出题参考。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
