
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NoteItem, NoteFolder, DEFAULT_NOTE_FOLDER_ID } from '@/types';
import { storageService } from '@/services/storage';
import { folderManagerApi } from '@/services/api/folderApi';
import { SuitDecorations } from '@/components/common/SuitDecorations';

// ===== 笔记编辑器子组件 =====

interface NoteEditorProps {
  note: NoteItem | null;           // null = 新建
  folderId: string;
  folders: NoteFolder[];
  onSave: (note: NoteItem) => void;
  onCancel: () => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ note, folderId, folders, onSave, onCancel }) => {
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [images, setImages] = useState<string[]>(note?.images || []);
  const [tags, setTags] = useState<string[]>(note?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [targetFolderId, setTargetFolderId] = useState(note?.folderId || folderId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleAddImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file: File) => {
      if (!file.type.startsWith('image/')) return;
      // 限制单张 2MB
      if (file.size > 2 * 1024 * 1024) {
        alert(`图片"${file.name}"超过2MB，已跳过。建议压缩后再上传。`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        if (base64) {
          setImages(prev => [...prev, base64]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleRemoveImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags(prev => [...prev, t]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  };

  const handleSave = () => {
    const now = Date.now();
    const saved: NoteItem = {
      id: note?.id || ('note_' + now + '_' + Math.random().toString(36).slice(2, 8)),
      title: title.trim() || '无标题笔记',
      content,
      images,
      tags,
      folderId: targetFolderId,
      createdAt: note?.createdAt || now,
      updatedAt: now,
    };
    onSave(saved);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) continue;
        if (file.size > 2 * 1024 * 1024) {
          alert('粘贴的图片超过2MB，请压缩后重试。');
          continue;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64 = ev.target?.result as string;
          if (base64) setImages(prev => [...prev, base64]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Title */}
      <div className="space-y-2">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">笔记标题</label>
        <input
          ref={titleRef}
          type="text"
          className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 focus:bg-white transition-all placeholder:text-slate-300"
          placeholder="输入笔记标题..."
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      {/* Folder selector */}
      <div className="space-y-2">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">所属文件夹</label>
        <select
          className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 focus:bg-white transition-all appearance-none cursor-pointer"
          value={targetFolderId}
          onChange={e => setTargetFolderId(e.target.value)}
        >
          {folderManagerApi.flattenFolderTree(folders).map(({ folder: f, depth }) => (
            <option key={f.id} value={f.id}>{'　'.repeat(depth)}{depth > 0 ? '└ ' : ''}{f.name}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="space-y-2">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">笔记内容</label>
        <textarea
          className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-sm font-medium text-slate-700 outline-none focus:border-emerald-400 focus:bg-white transition-all resize-none placeholder:text-slate-300 leading-relaxed"
          placeholder="在此输入笔记内容...&#10;支持 LaTeX 数学公式：$f(x) = x^2$&#10;支持粘贴图片 (Ctrl+V)"
          rows={8}
          value={content}
          onChange={e => setContent(e.target.value)}
          onPaste={handlePaste}
        />
      </div>

      {/* Images */}
      <div className="space-y-2">
        <div className="flex items-center justify-between ml-1 mr-1">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
            图片附件 ({images.length})
          </label>
          <button
            onClick={handleAddImage}
            className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            添加图片
          </button>
        </div>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" multiple className="hidden" />

        {images.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {images.map((img, idx) => (
              <div key={idx} className="relative group w-24 h-24 rounded-xl overflow-hidden border-2 border-slate-100 bg-slate-50">
                <img src={img} alt={`附件${idx + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => handleRemoveImage(idx)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-300 font-medium ml-1">支持粘贴 (Ctrl+V)、拖拽或点击添加，单张限 2MB</p>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">标签</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-100">
              {tag}
              <button onClick={() => handleRemoveTag(tag)} className="hover:text-rose-500 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 bg-slate-50/50 border-2 border-slate-100 rounded-xl px-4 py-2.5 text-xs font-medium text-slate-700 outline-none focus:border-emerald-400 focus:bg-white transition-all placeholder:text-slate-300"
            placeholder="输入标签后回车..."
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
          />
          <button
            onClick={handleAddTag}
            disabled={!tagInput.trim()}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100 transition-all disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onCancel}
          className="flex-1 py-3.5 rounded-2xl text-sm font-black text-slate-500 bg-slate-50 hover:bg-slate-100 transition-all border-2 border-slate-100"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-3.5 rounded-2xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100"
        >
          {note ? '保存修改' : '创建笔记'}
        </button>
      </div>
    </div>
  );
};


// ===== 笔记卡片（查看模式） =====

interface NoteCardProps {
  note: NoteItem;
  onEdit: () => void;
  onDelete: () => void;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, onEdit, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const renderMathContent = useCallback((text: string) => {
    if (!text) return '';
    const katex = (window as any).katex;
    if (!katex) return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    let processed = text.replace(/\\\[([\s\S]+?)\\\]/g, '$$$$$1$$$$');
    processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, '$$$1$$');

    const parts = processed.split(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g);
    return parts.map(part => {
      try {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          return `<span class="katex-display">${katex.renderToString(part.slice(2, -2).trim(), { displayMode: true, throwOnError: false })}</span>`;
        }
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          return katex.renderToString(part.slice(1, -1).trim(), { throwOnError: false });
        }
      } catch { /* fallback */ }
      return part
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br/>');
    }).join('');
  }, []);

  const isLong = note.content.length > 200;
  const displayContent = (!expanded && isLong) ? note.content.slice(0, 200) + '...' : note.content;
  const dateStr = new Date(note.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden hover-float-3d relative">
        <SuitDecorations variant="corner" />
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h4 className="text-base font-black text-slate-800 truncate">{note.title}</h4>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">{dateStr}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 ml-3">
              <button
                onClick={onEdit}
                className="w-8 h-8 rounded-xl hover:bg-emerald-50 flex items-center justify-center text-slate-400 hover:text-emerald-600 transition-all"
                title="编辑"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => { if (confirm(`确定删除笔记"${note.title}"吗？`)) onDelete(); }}
                className="w-8 h-8 rounded-xl hover:bg-rose-50 flex items-center justify-center text-slate-400 hover:text-rose-600 transition-all"
                title="删除"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tags */}
          {note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {note.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 text-[10px] font-bold border border-emerald-100">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Content */}
          {note.content && (
            <div
              className="text-sm text-slate-700 font-medium leading-relaxed mb-3"
              dangerouslySetInnerHTML={{ __html: renderMathContent(displayContent) }}
            />
          )}
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              {expanded ? '收起 ▲' : '展开全部 ▼'}
            </button>
          )}

          {/* Images */}
          {note.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {note.images.map((img, idx) => (
                <div
                  key={idx}
                  className="w-20 h-20 rounded-xl overflow-hidden border border-slate-100 cursor-pointer hover:ring-2 hover:ring-emerald-300 transition-all"
                  onClick={() => setPreviewImage(img)}
                >
                  <img src={img} alt={`图片${idx + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Image preview modal */}
      {previewImage && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img src={previewImage} alt="预览" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center text-slate-600 hover:text-rose-600 transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};


// ===== 主笔记本组件 =====

export const Notebook: React.FC = () => {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string>(DEFAULT_NOTE_FOLDER_ID);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editingNote, setEditingNote] = useState<NoteItem | null | 'new'>(null); // null = no editor, 'new' = new note, NoteItem = edit
  const [searchTerm, setSearchTerm] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const loadData = () => {
    setFolders(folderManagerApi.getFolders('note') as NoteFolder[]);
    setNotes(storageService.getNotes());
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (showNewFolderInput) newFolderInputRef.current?.focus();
  }, [showNewFolderInput]);

  const folderNotes = notes.filter(n => n.folderId === activeFolderId);
  const folderTags = storageService.getNoteTagsByFolder(activeFolderId);
  const globalFolderStats = folderManagerApi.getFolderStats('note');
  const childFolders = folderManagerApi.getChildFolders(folders, activeFolderId);
  const breadcrumbPath = folderManagerApi.getFolderPath(folders, activeFolderId).filter(f => f.id !== DEFAULT_NOTE_FOLDER_ID);

  let displayedNotes = activeTag
    ? folderNotes.filter(n => n.tags.includes(activeTag))
    : folderNotes;

  if (searchTerm.trim()) {
    const q = searchTerm.toLowerCase();
    displayedNotes = displayedNotes.filter(n =>
      n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    );
  }

  // Sort by updatedAt descending
  displayedNotes = [...displayedNotes].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    folderManagerApi.addFolder('note', name, activeFolderId);
    setNewFolderName('');
    setShowNewFolderInput(false);
    loadData();
  };

  const handleDeleteFolder = (id: string) => {
    if (id === DEFAULT_NOTE_FOLDER_ID) return;
    const folder = folders.find(f => f.id === id);
    const count = globalFolderStats[id] || 0;
    const childCount = folderManagerApi.getChildFolders(folders, id).length;
    const descendants = folderManagerApi.getAllDescendantFolderIds(folders, id);
    let msg = `确定删除文件夹"${folder?.name}"吗？`;
    if (count > 0) msg += `\n其中 ${count} 篇笔记将被移至上级文件夹。`;
    if (childCount > 0) msg += `\n其中 ${childCount} 个子文件夹将被移至上级。`;
    if (!confirm(msg)) return;
    folderManagerApi.removeFolder('note', id);
    if (activeFolderId === id || descendants.includes(activeFolderId)) {
      const parent = folder?.parentId || DEFAULT_NOTE_FOLDER_ID;
      setActiveFolderId(parent);
      setActiveTag(null);
    }
    loadData();
  };

  const handleStartRename = (folder: NoteFolder) => {
    if (folder.id === DEFAULT_NOTE_FOLDER_ID) return;
    setRenamingFolderId(folder.id);
    setRenameValue(folder.name);
  };

  const handleRename = () => {
    if (renamingFolderId && renameValue.trim()) {
      folderManagerApi.renameFolder('note', renamingFolderId, renameValue.trim());
      setRenamingFolderId(null);
      setRenameValue('');
      loadData();
    }
  };

  const handleSaveNote = (note: NoteItem) => {
    storageService.saveNote(note);
    setEditingNote(null);
    loadData();
  };

  const handleDeleteNote = (id: string) => {
    storageService.removeNote(id);
    loadData();
  };

  // ===== 渲染 =====

  // 如果正在编辑笔记，显示编辑器
  if (editingNote !== null) {
    return (
      <div className="space-y-6 animate-slideUp">
        <div className="flex justify-between items-center bg-white px-8 py-4 rounded-[1.5rem] border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-2 h-6 bg-emerald-500 rounded-full animate-breathe"></div>
            <h2 className="text-lg font-black text-slate-800">{editingNote === 'new' ? '新建笔记' : '编辑笔记'}</h2>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-8">
          <NoteEditor
            note={editingNote === 'new' ? null : editingNote}
            folderId={activeFolderId}
            folders={folders}
            onSave={handleSaveNote}
            onCancel={() => setEditingNote(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slideUp">
      {/* Top action bar */}
      <div className="flex justify-between items-center bg-white px-8 py-4 rounded-[1.5rem] border border-slate-200 shadow-sm animate-slideUp hover-float-3d relative overflow-hidden" style={{animationDelay:'0.05s'}} data-help="【新手引导① 学习笔记】先新建笔记记录方法与反思，再按分类与标签整理，复习时更高效。">
        <SuitDecorations variant="corner" />
        <div className="flex items-center gap-3 relative z-[1]">
          <div className="w-2 h-6 bg-emerald-500 rounded-full animate-breathe"></div>
          <h2 className="text-lg font-black text-slate-800">学习笔记</h2>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setEditingNote('new')}
            data-help="点击新建笔记，支持文字、图片和 LaTeX 公式，建议一题一记或一知识点一记。"
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-lg shadow-emerald-100 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 mr-14"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            新建笔记
          </button>
        </div>
      </div>

      {/* Folder area */}
      <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden hover-float-3d relative" data-help="【新手引导② 笔记分类】这里是笔记的文件柜。建议按章节或专题建立层级，长期积累更易检索。">
        <SuitDecorations variant="corner" />
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between relative z-[1]">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="text-sm font-black text-slate-700">笔记分类</span>
          </div>
          <button
            onClick={() => setShowNewFolderInput(true)}
            data-help="在当前目录下新建子文件夹。命名尽量具体（如“导数题型总结”），后续查找更快。"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-all mr-14"
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
              onClick={() => { setActiveFolderId(DEFAULT_NOTE_FOLDER_ID); setActiveTag(null); setSearchTerm(''); }}
              data-help="返回根目录并清除当前筛选，重新查看全部笔记。"
              className="font-bold text-emerald-600 hover:text-emerald-800 hover:underline transition-colors flex items-center gap-1"
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
                  onClick={() => { setActiveFolderId(crumb.id); setActiveTag(null); setSearchTerm(''); }}
                  data-help="点击可跳回该层级文件夹，并清除当前筛选。"
                  className="font-bold text-emerald-600 hover:text-emerald-800 hover:underline transition-colors"
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
            const isRenaming = renamingFolderId === folder.id;

            return (
              <div
                key={folder.id}
                className="group relative flex items-center gap-2.5 px-5 py-3 rounded-2xl border-2 cursor-pointer transition-all duration-200 bg-white border-slate-100 text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/30"
                onClick={() => {
                  if (!isRenaming) {
                    setActiveFolderId(folder.id);
                    setActiveTag(null);
                    setSearchTerm('');
                  }
                }}
              >
                <svg className="w-5 h-5 transition-colors text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>

                {isRenaming ? (
                  <input
                    autoFocus
                    className="text-sm font-bold bg-transparent outline-none border-b-2 border-emerald-400 w-24"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenamingFolderId(null); }}
                    onBlur={handleRename}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span className="text-sm font-black">{folder.name}</span>
                )}

                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                    {count}
                  </span>
                  {subCount > 0 && (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-500" title={`${subCount} 个子文件夹`}>
                      <svg className="w-2.5 h-2.5 inline mr-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
                      {subCount}
                    </span>
                  )}
                </div>

                {folder.id !== DEFAULT_NOTE_FOLDER_ID && !isRenaming && (
                  <div className="flex items-center gap-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStartRename(folder); }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg text-emerald-400 hover:bg-emerald-100 hover:text-emerald-600 transition-all"
                      title="重命名"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg text-emerald-400 hover:bg-rose-100 hover:text-rose-600 transition-all"
                      title="删除文件夹"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {showNewFolderInput && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 animate-fadeIn">
              <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
              <input
                ref={newFolderInputRef}
                className="text-sm font-bold bg-transparent outline-none w-28 placeholder:text-emerald-300"
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
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm active:scale-90"
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

      {/* Search + tag filter row */}
      {folderNotes.length > 0 && (
        <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden hover-float-3d relative animate-slideUp" style={{animationDelay:'0.1s'}} data-help="【新手引导③ 搜索与标签】先用搜索快速定位，再按标签筛选，可高效复习同类内容。">
          <SuitDecorations variant="corner" />
          <div className="px-8 py-4 border-b border-slate-100 flex items-center gap-3 relative z-[1]">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              className="flex-1 text-sm font-medium text-slate-700 outline-none bg-transparent placeholder:text-slate-300 transition-all focus:text-slate-900"
              placeholder="搜索笔记标题或内容..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {folderTags.length > 0 && (
            <div className="p-4 flex flex-wrap gap-2 relative z-[1]">
              <button
                onClick={() => setActiveTag(null)}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  activeTag === null
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100'
                    : 'bg-slate-50 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 border border-slate-100'
                }`}
              >
                全部 ({folderNotes.length})
              </button>
              {folderTags.map(tag => {
                const count = folderNotes.filter(n => n.tags.includes(tag)).length;
                return (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                      activeTag === tag
                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100'
                        : 'bg-slate-50 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 border border-slate-100'
                    }`}
                  >
                    {tag} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {folderNotes.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-3xl flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
            <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <h4 className="text-lg font-black text-emerald-900 mb-2">
            「{folders.find(f => f.id === activeFolderId)?.name}」 文件夹暂无笔记
          </h4>
          <p className="text-xs font-bold text-emerald-700 max-w-sm leading-relaxed">
            点击右上角「新建笔记」开始记录学习心得、公式整理、解题技巧等。支持插入图片和 LaTeX 公式。
          </p>
        </div>
      )}

      {/* Note list */}
      {displayedNotes.length > 0 && (
        <div className="space-y-6" data-help="【新手引导④ 笔记列表】这里展示当前目录（或筛选后）的笔记，可编辑、删除或查看图片附件。">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-6 bg-emerald-500 rounded-full"></div>
            <h3 className="text-lg font-black text-slate-800">
              {activeTag
                ? `"${activeTag}" 标签下的笔记`
                : `${folders.find(f => f.id === activeFolderId)?.name} 中的全部笔记`
              }
            </h3>
            <span className="text-[10px] font-bold text-slate-400 ml-1">({displayedNotes.length} 篇)</span>
          </div>
          <div className="grid grid-cols-1 gap-6">
            {displayedNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                onEdit={() => setEditingNote(note)}
                onDelete={() => handleDeleteNote(note.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* No search results */}
      {folderNotes.length > 0 && displayedNotes.length === 0 && (
        <div className="text-center py-12 text-slate-400 font-bold text-sm">
          没有找到匹配的笔记
        </div>
      )}
    </div>
  );
};
