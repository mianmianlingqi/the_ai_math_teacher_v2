import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { showConfirm } from '@/services/api/confirmService';
import { WrongProblem, WrongProblemFolder, DEFAULT_FOLDER_ID } from '@/types';
import { storageService } from '@/services/storage';
import { folderManagerApi } from '@/services/api/folderApi';
import { ProblemCard } from '@/components/features/problem/ProblemCard';
import { SuitDecorations } from '@/components/common/SuitDecorations';

const SYSTEM_ERROR_FOLDER_NAMES = new Set([
  '计算错误',
  '概念模糊',
  '逻辑不严密',
  '审题不清',
  '技巧缺失',
  '公式误用',
  '负号遗漏',
  '系数遗漏',
]);

export const WrongProblemBook: React.FC = () => {
  const [folders, setFolders] = useState<WrongProblemFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string>(DEFAULT_FOLDER_ID);
  const [activeErrorType, setActiveErrorType] = useState<string | null>(null);
  const [wrongProblems, setWrongProblems] = useState<WrongProblem[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const loadData = () => {
    setFolders(folderManagerApi.getFolders('wrong') as WrongProblemFolder[]);
    setWrongProblems(storageService.getWrongProblems());
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (showNewFolderInput) {
      newFolderInputRef.current?.focus();
    }
  }, [showNewFolderInput]);

  const folderProblems = wrongProblems.filter(p => p.folderId === activeFolderId);
  const folderStats = storageService.getErrorStatsByFolder(activeFolderId);
  const errorTypes = Object.keys(folderStats);
  const globalFolderStats = folderManagerApi.getFolderStats('wrong');
  const childFolders = folderManagerApi.getChildFolders(folders, activeFolderId);
  const breadcrumbPath = folderManagerApi.getFolderPath(folders, activeFolderId).filter(f => f.id !== DEFAULT_FOLDER_ID);

  const displayedProblems = activeErrorType
    ? folderProblems.filter(p => p.errorType === activeErrorType)
    : folderProblems;

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    folderManagerApi.addFolder('wrong', name, activeFolderId);
    setNewFolderName('');
    setShowNewFolderInput(false);
    loadData();
  };

  const handleDeleteFolder = async (id: string): Promise<void> => {
    if (id === DEFAULT_FOLDER_ID) return;
    const folder = folders.find(f => f.id === id);
    const count = globalFolderStats[id] || 0;
    const childCount = folderManagerApi.getChildFolders(folders, id).length;
    const descendants = folderManagerApi.getAllDescendantFolderIds(folders, id);
    let msg = `确定删除文件夹“${folder?.name}”吗？`;
    if (count > 0) msg += `\n其中 ${count} 道错题将被移至上级文件夹。`;
    if (childCount > 0) msg += `\n其中 ${childCount} 个子文件夹将被移至上级。`;
    if (!(await showConfirm(msg))) return;
    folderManagerApi.removeFolder('wrong', id);
    if (activeFolderId === id || descendants.includes(activeFolderId)) {
      const parent = folder?.parentId || DEFAULT_FOLDER_ID;
      setActiveFolderId(parent);
      setActiveErrorType(null);
    }
    loadData();
  };

  const handleStartRename = (folder: WrongProblemFolder) => {
    if (folder.id === DEFAULT_FOLDER_ID) return;
    setRenamingFolderId(folder.id);
    setRenameValue(folder.name);
  };

  const handleRename = () => {
    if (renamingFolderId && renameValue.trim()) {
      folderManagerApi.renameFolder('wrong', renamingFolderId, renameValue.trim());
      setRenamingFolderId(null);
      setRenameValue('');
      loadData();
    }
  };

  return (
    <div className="space-y-6 animate-slideUp">
      {/* Top action bar */}
      <div className="flex justify-between items-center bg-white px-8 py-4 rounded-[1.5rem] border border-slate-200 shadow-sm animate-slideUp hover-float-3d relative overflow-hidden" style={{animationDelay:'0.05s'}} data-help="【新手引导① 错题管理】先进入分类文件夹，再按错误类型筛选，复盘会更聚焦。">
        <SuitDecorations variant="corner" />
        <div className="flex items-center gap-3 relative z-[1]">
          <div className="w-2 h-6 bg-rose-500 rounded-full animate-breathe"></div>
          <h2 className="text-lg font-black text-slate-800">错题管理</h2>
        </div>
      </div>

      {/* Folder area */}
      <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden hover-float-3d relative" data-help="【新手引导② 分类文件夹】这里是错题的文件柜。建议按章节或错误类型建立层级，便于长期追踪薄弱点。">
        <SuitDecorations variant="corner" />
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between relative z-[1]">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="text-sm font-black text-slate-700">分类文件夹</span>
          </div>
          <button
            onClick={() => setShowNewFolderInput(true)}
            data-help="在当前目录新建子文件夹。建议命名清晰（如“导数-计算错误”），便于持续复盘。"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black text-sky-600 bg-sky-50 hover:bg-sky-100 rounded-lg transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-95 mr-14"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
            </svg>
            新建子文件夹
          </button>
        </div>

        {/* 面包屑导航 */}
        <div className="px-6 pt-4 pb-2 flex items-center gap-1.5 flex-wrap text-xs">
          {breadcrumbPath.length > 0 ? (
            <button
              onClick={() => { setActiveFolderId(DEFAULT_FOLDER_ID); setActiveErrorType(null); }}
              data-help="返回根目录并清除当前筛选，适合重新浏览全部错题分类。"
              className="font-bold text-amber-600 hover:text-amber-800 hover:underline transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" /></svg>
              根目录
            </button>
          ) : (
            <span className="font-black text-slate-700 flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" /></svg>
              根目录
            </span>
          )}
          {breadcrumbPath.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              <svg className="w-3 h-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
              {idx === breadcrumbPath.length - 1 ? (
                <span className="font-black text-slate-700">{crumb.name}</span>
              ) : (
                <button
                  onClick={() => { setActiveFolderId(crumb.id); setActiveErrorType(null); }}
                  data-help="点击可跳回该层级文件夹，并清除当前错误类型筛选。"
                  className="font-bold text-amber-600 hover:text-amber-800 hover:underline transition-colors"
                >
                  {crumb.name}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="p-4 flex flex-wrap gap-3">
          {childFolders.map(folder => {
            const count = globalFolderStats[folder.id] || 0;
            const subCount = folderManagerApi.getChildFolders(folders, folder.id).length;
            const isSystemFolder = (!folder.parentId && SYSTEM_ERROR_FOLDER_NAMES.has(folder.name)) || folder.id.startsWith('preset_wrong_folder_');

            return (
              <div
                key={folder.id}
                className={`group relative flex items-center gap-2.5 px-5 py-3 rounded-2xl border-2 cursor-pointer transition-all duration-200 bg-white text-slate-600 ${
                  isSystemFolder
                    ? 'border-amber-300 bg-amber-50/40 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)] hover:border-amber-400'
                    : 'border-slate-100 hover:border-amber-200 hover:bg-amber-50/30'
                }`}
                onClick={() => {
                  setActiveFolderId(folder.id);
                  setActiveErrorType(null);
                }}
              >
                <svg className="w-5 h-5 transition-colors text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>

                <span className="text-sm font-black">{folder.name}</span>
                {isSystemFolder && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200">内置</span>
                )}

                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                    {count}
                  </span>
                  {subCount > 0 && (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-500" title={`${subCount} 个子文件夹`}>
                      <svg className="w-2.5 h-2.5 inline mr-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
                      {subCount}
                    </span>
                  )}
                </div>

              </div>
            );
          })}

          {showNewFolderInput && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50/50 animate-fadeIn">
              <svg className="w-5 h-5 text-sky-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
              <input
                ref={newFolderInputRef}
                className="text-sm font-bold bg-transparent outline-none w-28 placeholder:text-sky-300"
                placeholder="文件夹名称..."
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') { setShowNewFolderInput(false); setNewFolderName(''); }
                }}
              />
              <button
                onClick={handleCreateFolder}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-all shadow-sm active:scale-90"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button
                onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {childFolders.length === 0 && !showNewFolderInput && (
            <div className="text-xs font-medium text-slate-300 py-2 px-4">当前文件夹内无子文件夹</div>
          )}
        </div>
      </div>

      {/* Error type tags */}
      {folderProblems.length > 0 && (
          <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden hover-float-3d relative" data-help="【新手引导③ 错误分类筛选】先进入文件夹，再按错误类型筛选，能快速定位最常犯的错误。">
            <SuitDecorations variant="corner" />
            <div className="px-8 py-4 border-b border-slate-100 flex items-center gap-2">
            <svg className="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span className="text-sm font-black text-slate-700">
              {folders.find(f => f.id === activeFolderId)?.name}  错误分类
            </span>
            <span className="text-[10px] font-bold text-slate-400 ml-1">({folderProblems.length} 道错题)</span>
          </div>

          <div className="p-4 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveErrorType(null)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeErrorType === null
                  ? 'bg-sky-600 text-white shadow-lg shadow-sky-100'
                  : 'bg-slate-50 text-slate-500 hover:bg-sky-50 hover:text-sky-600 border border-slate-100'
              }`}
            >
              全部 ({folderProblems.length})
            </button>

            {errorTypes.map(type => (
              <button
                key={type}
                onClick={() => setActiveErrorType(activeErrorType === type ? null : type)}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  activeErrorType === type
                    ? 'bg-rose-500 text-white shadow-lg shadow-rose-100'
                    : 'bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600 border border-slate-100'
                }`}
              >
                {type} ({folderStats[type]})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {folderProblems.length === 0 && (
        <div className="bg-amber-50 border border-amber-100 p-8 rounded-3xl flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
            <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <h4 className="text-lg font-black text-amber-900 mb-2">
            「{folders.find(f => f.id === activeFolderId)?.name}」文件夹暂无错题
          </h4>
          <p className="text-xs font-bold text-amber-700 max-w-sm leading-relaxed">
            在练习中发现薄弱点时，点击"收入错题本"并选择对应的文件夹和错误分类。您也可以通过顶部「数据」按钮导入备份。
          </p>
        </div>
      )}

      {/* Problem list */}
      {displayedProblems.length > 0 && (
        <div className="space-y-6" data-help="【新手引导④ 错题记录区】这里展示当前目录（或筛选后）的错题。点击卡片可查看解析、修改分类或继续整理。">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-6 bg-rose-500 rounded-full"></div>
            <h3 className="text-lg font-black text-slate-800">
              {activeErrorType
                ? `"${activeErrorType}" 分类下的记录`
                : `${folders.find(f => f.id === activeFolderId)?.name} 中的全部记录`
              }
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-6">
            {displayedProblems.map((p, idx) => (
              <ProblemCard key={p.id} problem={p} index={idx} isSaved={true} onSavedChange={loadData} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};