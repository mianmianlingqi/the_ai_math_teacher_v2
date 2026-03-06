
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChatMessage, AIProviderConfig, MathProblem, WrongProblem, WrongProblemFolder, QBankFolder, QBankItem, NoteItem, NoteFolder, DEFAULT_NOTE_FOLDER_ID } from '@/types';
import { streamChat } from '@/services/ai/chatService';
import { storageService, getChildFolders, getFolderPath } from '@/services/storage';
import { folderManagerApi } from '@/services/api/folderApi';
import { referenceSelectorApi } from '@/services/api/refApi';
import { DEFAULT_PROVIDER_CONFIG } from '@/constants';
import { extractPdfText } from '@/services/api/pdfApi';

const MAX_PENDING_FILES = 3;
const MAX_TEXT_CHARS = 12000;
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;

const TEXT_FILE_EXTENSIONS = [
  'txt', 'md', 'markdown', 'rst', 'text', 'log', 'ini', 'cfg', 'conf', 'toml', 'yaml', 'yml', 'env',
  'json', 'jsonl', 'json5', 'xml', 'csv', 'tsv', 'sql', 'graphql', 'gql',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte',
  'py', 'pyi', 'ipynb', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'go', 'rs', 'swift',
  'c', 'h', 'hpp', 'hh', 'cpp', 'cc', 'cxx', 'cs', 'vb', 'm', 'mm',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'tex', 'sty', 'cls',
  'dockerfile', 'makefile', 'mk',
  'gitignore', 'gitattributes', 'editorconfig',
  'lock', 'properties', 'gradle', 'npmrc', 'pnpmfile', 'plist',
];

const FILE_ACCEPT_EXTENSIONS = [
  ...TEXT_FILE_EXTENSIONS.map(ext => `.${ext}`),
  '.pdf',
  '.doc',
  '.docx',
].join(',');

const WORD_FILE_EXTENSION_REGEX = /\.(doc|docx|wps)$/i;
const PDF_FILE_EXTENSION_REGEX = /\.pdf$/i;

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB`;
};

const getFileExtension = (name: string): string => {
  const normalized = (name || '').toLowerCase().trim();
  if (!normalized) return '';
  const base = normalized.split('/').pop() || normalized;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return base;
  }
  return base.slice(dot + 1);
};

const hasManyReplacementChars = (text: string): boolean => {
  if (!text) return false;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  return replacementCount / Math.max(1, text.length) > 0.002;
};

const readTextWithEncodingFallback = async (
  file: File,
  maxChars: number,
): Promise<{ text: string; encoding: string; truncated: boolean }> => {
  const bytes = new Uint8Array(await file.arrayBuffer());

  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  let bestText = utf8Text;
  let bestEncoding = 'UTF-8';

  if (hasManyReplacementChars(utf8Text)) {
    try {
      const gbkText = new TextDecoder('gbk', { fatal: false }).decode(bytes);
      const utf8Bad = (utf8Text.match(/\uFFFD/g) || []).length;
      const gbkBad = (gbkText.match(/\uFFFD/g) || []).length;
      if (gbkBad < utf8Bad) {
        bestText = gbkText;
        bestEncoding = 'GBK';
      }
    } catch {
      // 浏览器可能不支持 gbk decoder，保留 UTF-8 结果
    }
  }

  const truncated = bestText.length > maxChars;
  return {
    text: truncated ? bestText.slice(0, maxChars) : bestText,
    encoding: bestEncoding,
    truncated,
  };
};

const readFileAsDataURL = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
};

const readFileAsBase64 = async (file: File): Promise<string> => {
  const dataUrl = await readFileAsDataURL(file);
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
};

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** 当前页面上的题目 */
  currentProblems: MathProblem[];
  /** 答疑模型配置 */
  chatProvider: AIProviderConfig;
  /** 视觉识别模型配置（用于图片答疑） */
  visionProvider?: AIProviderConfig;
  onOpenSettings: () => void;
}

// ===== 题目选择器子组件 =====

interface ProblemSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (problem: { question: string; answer: string; explanation: string; source: string }) => void;
  currentProblems: MathProblem[];
}

const ProblemSelector: React.FC<ProblemSelectorProps> = ({ isOpen, onClose, onSelect, currentProblems }) => {
  const [tab, setTab] = useState<'current' | 'wrong' | 'qbank'>('current');
  const [searchTerm, setSearchTerm] = useState('');

  // 错题本状态
  const [wrongFolders, setWrongFolders] = useState<WrongProblemFolder[]>([]);
  const [wrongCurrentFolderId, setWrongCurrentFolderId] = useState<string | undefined>(undefined);
  const [wrongProblems, setWrongProblems] = useState<WrongProblem[]>([]);

  // 题库状态
  const [qbankFolders, setQbankFolders] = useState<QBankFolder[]>([]);
  const [qbankCurrentFolderId, setQbankCurrentFolderId] = useState<string | undefined>(undefined);
  const [qbankItems, setQbankItems] = useState<QBankItem[]>([]);

  const switchTab = (nextTab: 'current' | 'wrong' | 'qbank') => {
    setTab(nextTab);
    setSearchTerm('');

    if (nextTab === 'current') {
      setWrongCurrentFolderId(undefined);
      setQbankCurrentFolderId(undefined);
      setWrongProblems([]);
      setQbankItems([]);
      return;
    }

    if (nextTab === 'wrong') {
      setWrongCurrentFolderId(undefined);
      setQbankCurrentFolderId(undefined);
      setQbankItems([]);
      return;
    }

    setQbankCurrentFolderId(undefined);
    setWrongCurrentFolderId(undefined);
    setWrongProblems([]);
  };

  useEffect(() => {
    if (isOpen) {
      setWrongFolders(storageService.getFolders());
      setQbankFolders(storageService.getQBankFolders());
      setWrongCurrentFolderId(undefined);
      setQbankCurrentFolderId(undefined);
      setSearchTerm('');
    }
  }, [isOpen]);

  // 加载错题
  useEffect(() => {
    if (wrongCurrentFolderId) {
      setWrongProblems(storageService.getWrongProblemsByFolder(wrongCurrentFolderId));
    } else {
      setWrongProblems([]);
    }
  }, [wrongCurrentFolderId]);

  // 加载题库题目
  useEffect(() => {
    if (qbankCurrentFolderId) {
      setQbankItems(storageService.getQBankItemsByFolder(qbankCurrentFolderId));
    } else {
      setQbankItems([]);
    }
  }, [qbankCurrentFolderId]);

  if (!isOpen) return null;

  const renderMathText = (text: string) => {
    if (!text) return '';
    const katex = (window as any).katex;
    if (!katex) return text;
    let processed = text.replace(/\\\[([\s\S]+?)\\\]/g, '$$$$$1$$$$');
    processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, '$$$1$$');
    return processed.replace(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g, (match) => {
      try {
        if (match.startsWith('$$') && match.endsWith('$$')) {
          return katex.renderToString(match.slice(2, -2).trim(), { displayMode: true, throwOnError: false });
        }
        return katex.renderToString(match.slice(1, -1).trim(), { throwOnError: false });
      } catch { return match; }
    });
  };

  const filteredCurrentProblems = currentProblems.filter(p =>
    !searchTerm || p.question.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredWrongProblems = wrongProblems.filter(p =>
    !searchTerm || p.question.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredQbankItems = qbankItems.filter(p =>
    !searchTerm || p.question.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ===== 文件管理器面包屑组件 =====
  const Breadcrumb = ({ folders, currentFolderId, onNavigate, color }: {
    folders: { id: string; name: string; parentId?: string; createdAt: number }[];
    currentFolderId: string | undefined;
    onNavigate: (id: string | undefined) => void;
    color: 'rose' | 'emerald';
  }) => {
    if (!currentFolderId) return null;
    const path = getFolderPath(folders, currentFolderId);
    const colorMap = {
      rose: { text: 'text-rose-600', hover: 'hover:text-rose-600' },
      emerald: { text: 'text-emerald-600', hover: 'hover:text-emerald-600' },
    };
    const c = colorMap[color];
    return (
      <div className="flex items-center gap-1 text-xs font-bold mb-3 px-1 flex-wrap">
        <button onClick={() => onNavigate(undefined)} className={`text-slate-400 ${c.hover} transition-all flex items-center gap-1`} title="返回根目录">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" /></svg>
        </button>
        {path.map((folder) => (
          <React.Fragment key={folder.id}>
            <svg className="w-3 h-3 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <button
              onClick={() => onNavigate(folder.id)}
              className={`truncate max-w-[80px] ${folder.id === currentFolderId ? c.text : `text-slate-400 ${c.hover}`} transition-all`}
            >
              {folder.name}
            </button>
          </React.Fragment>
        ))}
      </div>
    );
  };

  // ===== 文件管理器 - 文件夹列表渲染 =====
  const renderFolderList = (
    allFolders: { id: string; name: string; parentId?: string; createdAt: number }[],
    currentFolderId: string | undefined,
    onNavigate: (id: string) => void,
    color: 'rose' | 'emerald',
    countFn: (folderId: string) => number
  ) => {
    const childFolders = getChildFolders(allFolders, currentFolderId);
    if (childFolders.length === 0) return null;
    const colorMap = {
      rose: { bg: 'bg-rose-50', text: 'text-rose-500', border: 'hover:border-rose-200', hoverBg: 'hover:bg-rose-50/30' },
      emerald: { bg: 'bg-emerald-50', text: 'text-emerald-500', border: 'hover:border-emerald-200', hoverBg: 'hover:bg-emerald-50/30' },
    };
    const c = colorMap[color];
    return (
      <>
        {childFolders.map(folder => {
          const count = countFn(folder.id);
          const subFolderCount = getChildFolders(allFolders, folder.id).length;
          return (
            <button
              key={folder.id}
              onClick={() => onNavigate(folder.id)}
              className={`w-full text-left p-3.5 rounded-xl border border-slate-100 ${c.border} ${c.hoverBg} transition-all flex items-center justify-between group`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-lg ${c.bg} ${c.text} flex items-center justify-center flex-shrink-0`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-700 truncate">{folder.name}</div>
                  <div className="text-[10px] text-slate-400 font-medium">
                    {count} 道题{subFolderCount > 0 ? ` · ${subFolderCount} 个子文件夹` : ''}
                  </div>
                </div>
              </div>
              <svg className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          );
        })}
      </>
    );
  };

  // ===== 文件管理器视图（错题本） =====
  const renderWrongFileManager = () => {
    const childFolders = getChildFolders(wrongFolders, wrongCurrentFolderId);
    const wrongInteractionData = referenceSelectorApi.getFolderInteractionData(
      wrongFolders,
      wrongCurrentFolderId,
      (fid) => folderManagerApi.getItemCountByFolder('wrong', fid),
    );
    const wrongRootId = folderManagerApi.getRootId('wrong');
    const currentWrongFolderName = wrongCurrentFolderId
      ? (wrongFolders.find(f => f.id === wrongCurrentFolderId)?.name || '当前目录')
      : '根目录';
    const wrongBreadcrumbFolders = wrongInteractionData.breadcrumbFolders.filter(folder => folder.id !== wrongRootId);

    if (!wrongCurrentFolderId && wrongInteractionData.folderRows.length === 0) {
      return <div className="text-center py-8 text-slate-400 text-xs font-bold">错题本为空</div>;
    }

    return (
      <>
        {wrongCurrentFolderId && (
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 px-1 flex-wrap mb-2">
            <button
              onClick={() => referenceSelectorApi.goToRoot(setWrongCurrentFolderId)}
              className="text-slate-400 hover:text-rose-500 transition-colors"
            >
              根目录
            </button>
            {wrongBreadcrumbFolders.map((folder) => (
              <React.Fragment key={folder.id}>
                <svg className="w-2.5 h-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <button
                  onClick={() => referenceSelectorApi.openFolder(folder.id, setWrongCurrentFolderId)}
                  className={`truncate max-w-[90px] ${folder.id === wrongCurrentFolderId ? 'text-rose-600' : 'text-slate-400 hover:text-rose-500'} transition-colors`}
                >
                  {folder.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="space-y-2 mb-2">
          <div className="flex items-center gap-2 p-2.5 rounded-xl border border-rose-200 bg-rose-50/30">
            <button
              onClick={() => { if (wrongCurrentFolderId) referenceSelectorApi.goToRoot(setWrongCurrentFolderId); }}
              className="flex-1 text-left min-w-0"
            >
              <div className="text-[12px] font-black text-slate-700 truncate">{currentWrongFolderName}</div>
              <div className="text-[10px] text-slate-400 font-bold">当前目录</div>
            </button>
            <button
              onClick={() => {}}
              className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-rose-300 bg-rose-500 text-white"
            >
              当前
            </button>
          </div>

          {wrongInteractionData.folderRows.length > 0 ? wrongInteractionData.folderRows.map((folder) => (
            <div key={folder.id} className="relative ml-5 w-[calc(100%-1.25rem)] flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-rose-50/30 transition-all">
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-slate-300">↳</div>
              <button
                onClick={() => referenceSelectorApi.openFolder(folder.id, setWrongCurrentFolderId)}
                className="flex-1 text-left min-w-0"
              >
                <div className="text-[12px] font-black text-slate-700 truncate">{folder.name}</div>
                <div className="text-[10px] text-slate-400 font-bold">
                  {folder.itemCount} 道题{folder.subFolderCount > 0 ? ` · ${folder.subFolderCount} 个子文件夹` : ''}
                </div>
              </button>
              <button
                onClick={() => referenceSelectorApi.openFolder(folder.id, setWrongCurrentFolderId)}
                className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all"
              >
                进入
              </button>
            </div>
          )) : (
            <p className="text-center text-[10px] text-slate-400 font-medium py-3">暂无子文件夹</p>
          )}
        </div>

        {/* 当前文件夹的题目 */}
        {wrongCurrentFolderId && (
          <>
            {childFolders.length > 0 && filteredWrongProblems.length > 0 && (
              <div className="flex items-center gap-2 mt-3 mb-1 px-1">
                <div className="h-px flex-1 bg-slate-100"></div>
                <span className="text-[10px] font-bold text-slate-300">本文件夹题目</span>
                <div className="h-px flex-1 bg-slate-100"></div>
              </div>
            )}
            {filteredWrongProblems.length === 0 && childFolders.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs font-bold">该文件夹暂无错题</div>
            ) : (
              filteredWrongProblems.map((p) => {
                const pathFolders = getFolderPath(wrongFolders, p.folderId);
                const pathStr = pathFolders.map(f => f.name).join('/');
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelect({
                      question: p.question,
                      answer: p.answer,
                      explanation: p.explanation,
                      source: `错题本/${pathStr}/${p.errorType}`
                    })}
                    className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-rose-200 hover:bg-rose-50/30 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-500 text-[10px] font-bold flex-shrink-0">{p.errorType}</span>
                      <span className="text-[10px] font-bold text-slate-400">{p.questionType}</span>
                    </div>
                    <div
                      className="text-xs text-slate-700 font-medium line-clamp-2 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMathText(p.question.slice(0, 120) + (p.question.length > 120 ? '...' : '')) }}
                    />
                  </button>
                );
              })
            )}
          </>
        )}
      </>
    );
  };

  // ===== 文件管理器视图（题库） =====
  const renderQbankFileManager = () => {
    const childFolders = getChildFolders(qbankFolders, qbankCurrentFolderId);
    const qbankInteractionData = referenceSelectorApi.getFolderInteractionData(
      qbankFolders,
      qbankCurrentFolderId,
      (fid) => folderManagerApi.getItemCountByFolder('qbank', fid),
    );
    const qbankRootId = folderManagerApi.getRootId('qbank');
    const currentQbankFolderName = qbankCurrentFolderId
      ? (qbankFolders.find(f => f.id === qbankCurrentFolderId)?.name || '当前目录')
      : '根目录';
    const qbankBreadcrumbFolders = qbankInteractionData.breadcrumbFolders.filter(folder => folder.id !== qbankRootId);

    if (!qbankCurrentFolderId && qbankInteractionData.folderRows.length === 0) {
      return <div className="text-center py-8 text-slate-400 text-xs font-bold">题库为空</div>;
    }

    return (
      <>
        {qbankCurrentFolderId && (
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 px-1 flex-wrap mb-2">
            <button
              onClick={() => referenceSelectorApi.goToRoot(setQbankCurrentFolderId)}
              className="text-slate-400 hover:text-emerald-500 transition-colors"
            >
              根目录
            </button>
            {qbankBreadcrumbFolders.map((folder) => (
              <React.Fragment key={folder.id}>
                <svg className="w-2.5 h-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <button
                  onClick={() => referenceSelectorApi.openFolder(folder.id, setQbankCurrentFolderId)}
                  className={`truncate max-w-[90px] ${folder.id === qbankCurrentFolderId ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-500'} transition-colors`}
                >
                  {folder.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="space-y-2 mb-2">
          <div className="flex items-center gap-2 p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/30">
            <button
              onClick={() => { if (qbankCurrentFolderId) referenceSelectorApi.goToRoot(setQbankCurrentFolderId); }}
              className="flex-1 text-left min-w-0"
            >
              <div className="text-[12px] font-black text-slate-700 truncate">{currentQbankFolderName}</div>
              <div className="text-[10px] text-slate-400 font-bold">当前目录</div>
            </button>
            <button
              onClick={() => {}}
              className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-emerald-300 bg-emerald-500 text-white"
            >
              当前
            </button>
          </div>

          {qbankInteractionData.folderRows.length > 0 ? qbankInteractionData.folderRows.map((folder) => (
            <div key={folder.id} className="relative ml-5 w-[calc(100%-1.25rem)] flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-emerald-50/30 transition-all">
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-slate-300">↳</div>
              <button
                onClick={() => referenceSelectorApi.openFolder(folder.id, setQbankCurrentFolderId)}
                className="flex-1 text-left min-w-0"
              >
                <div className="text-[12px] font-black text-slate-700 truncate">{folder.name}</div>
                <div className="text-[10px] text-slate-400 font-bold">
                  {folder.itemCount} 道题{folder.subFolderCount > 0 ? ` · ${folder.subFolderCount} 个子文件夹` : ''}
                </div>
              </button>
              <button
                onClick={() => referenceSelectorApi.openFolder(folder.id, setQbankCurrentFolderId)}
                className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all"
              >
                进入
              </button>
            </div>
          )) : (
            <p className="text-center text-[10px] text-slate-400 font-medium py-3">暂无子文件夹</p>
          )}
        </div>

        {/* 当前文件夹的题目 */}
        {qbankCurrentFolderId && (
          <>
            {childFolders.length > 0 && filteredQbankItems.length > 0 && (
              <div className="flex items-center gap-2 mt-3 mb-1 px-1">
                <div className="h-px flex-1 bg-slate-100"></div>
                <span className="text-[10px] font-bold text-slate-300">本文件夹题目</span>
                <div className="h-px flex-1 bg-slate-100"></div>
              </div>
            )}
            {filteredQbankItems.length === 0 && childFolders.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs font-bold">该文件夹暂无题目</div>
            ) : (
              filteredQbankItems.map((item) => {
                const pathFolders = getFolderPath(qbankFolders, item.folderId);
                const pathStr = pathFolders.map(f => f.name).join('/');
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect({
                      question: item.question,
                      answer: item.answer,
                      explanation: item.explanation,
                      source: `题库/${pathStr}`
                    })}
                    className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {item.questionType && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 text-[10px] font-bold flex-shrink-0">{item.questionType}</span>
                      )}
                      {item.difficulty && (
                        <span className="text-[10px] font-bold text-slate-400">{item.difficulty}</span>
                      )}
                      {item.tags.length > 0 && (
                        <span className="text-[10px] font-bold text-slate-300 truncate">{item.tags.slice(0, 2).join(' · ')}</span>
                      )}
                    </div>
                    <div
                      className="text-xs text-slate-700 font-medium line-clamp-2 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMathText(item.question.slice(0, 120) + (item.question.length > 120 ? '...' : '')) }}
                    />
                  </button>
                );
              })
            )}
          </>
        )}
      </>
    );
  };

  return (
    <div className="absolute inset-0 z-20 bg-white flex flex-col animate-fadeIn rounded-[2rem]">
      {/* Header */}
      <div className="p-4 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black text-sm text-slate-800">选择题目</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 搜索 */}
        <input
          type="text"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-medium text-slate-700 outline-none focus:border-indigo-400 focus:bg-white transition-all mb-3 placeholder:text-slate-300"
          placeholder="搜索题目关键词..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        {/* Tab - 三个标签 */}
        <div className="flex gap-1 p-1 bg-slate-100/50 rounded-xl">
          <button
            onClick={() => switchTab('current')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'current' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            当前页 ({currentProblems.length})
          </button>
          <button
            onClick={() => switchTab('wrong')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'wrong' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            错题本
          </button>
          <button
            onClick={() => switchTab('qbank')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${tab === 'qbank' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            题库
          </button>
        </div>
      </div>

      {/* Body */}
      <div key={tab} className="flex-1 overflow-y-auto p-4 pt-2 space-y-2 custom-scrollbar">
        {tab === 'current' ? (
          filteredCurrentProblems.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs font-bold">
              {currentProblems.length === 0 ? '当前页面暂无题目，请先生成题目' : '无匹配结果'}
            </div>
          ) : (
            filteredCurrentProblems.map((p, idx) => (
              <button
                key={p.id}
                onClick={() => onSelect({
                  question: p.question,
                  answer: p.answer,
                  explanation: p.explanation,
                  source: `当前页 #${idx + 1}`
                })}
                className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-600 text-[10px] font-black flex items-center justify-center flex-shrink-0">
                    {idx + 1}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">{p.questionType} · {p.difficulty}</span>
                </div>
                <div
                  className="text-xs text-slate-700 font-medium line-clamp-2 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderMathText(p.question.slice(0, 120) + (p.question.length > 120 ? '...' : '')) }}
                />
              </button>
            ))
          )
        ) : tab === 'wrong' ? (
          renderWrongFileManager()
        ) : (
          renderQbankFileManager()
        )}
      </div>
    </div>
  );
};


// ===== 收录到笔记对话框子组件 =====

interface SaveToNoteDialogProps {
  assistantMsg: ChatMessage;
  prevUserMsg: ChatMessage | null;
  folders: NoteFolder[];
  onSave: (folderId: string, title: string, tags: string[]) => void;
  onCancel: () => void;
}

const SaveToNoteDialog: React.FC<SaveToNoteDialogProps> = ({ assistantMsg, prevUserMsg, folders, onSave, onCancel }) => {
  const defaultTitle = ((prevUserMsg?.content || assistantMsg.content).trim().replace(/\s+/g, ' ')).slice(0, 40) || 'AI答疑记录';
  const [title, setTitle] = useState(defaultTitle);
  const [folderId, setFolderId] = useState(DEFAULT_NOTE_FOLDER_ID);
  const [noteFolders, setNoteFolders] = useState<NoteFolder[]>(folders);
  const [noteCurrentFolderId, setNoteCurrentFolderId] = useState<string | undefined>(undefined);
  const [newNoteFolderName, setNewNoteFolderName] = useState('');
  const [tags, setTags] = useState<string[]>(['AI答疑']);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    setNoteFolders(folders);
  }, [folders]);

  const noteInteractionData = referenceSelectorApi.getFolderInteractionData(
    noteFolders,
    noteCurrentFolderId,
    (fid) => folderManagerApi.getItemCountByFolder('note', fid),
  );
  const currentNoteFolderTargetId = noteCurrentFolderId || DEFAULT_NOTE_FOLDER_ID;
  const breadcrumbFolders = noteInteractionData.breadcrumbFolders.filter(folder => folder.id !== DEFAULT_NOTE_FOLDER_ID);

  const currentNoteFolderName = noteCurrentFolderId
    ? (noteFolders.find(f => f.id === noteCurrentFolderId)?.name || '当前目录')
    : '根目录';

  const handleCreateNoteSubFolder = () => {
    const name = newNoteFolderName.trim();
    if (!name) return;
    const parentId = noteCurrentFolderId || DEFAULT_NOTE_FOLDER_ID;
    const created = folderManagerApi.addFolder('note', name, parentId) as NoteFolder;
    const updatedFolders = storageService.getNoteFolders();
    setNoteFolders(updatedFolders);
    setNoteCurrentFolderId(created.id);
    setFolderId(created.id);
    setNewNoteFolderName('');
  };

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="w-[min(360px,92vw)] bg-white border border-slate-200 rounded-[2rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] overflow-hidden animate-popIn ring-1 ring-black/5" onClick={e => e.stopPropagation()}>
        <div className="p-5 bg-slate-50/80 border-b border-slate-100">
          <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            收录到笔记
          </h3>
          <p className="text-[11px] text-slate-400 font-bold mt-1 leading-relaxed">填写标题、选择文件夹并设置标签后即可保存。</p>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">笔记标题</label>
            <input
              type="text"
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-[13px] font-bold text-slate-700 outline-none focus:border-emerald-300 transition-all"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">保存到文件夹</label>

            {noteCurrentFolderId && (
              <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 px-1 flex-wrap mb-2">
                <button
                  onClick={() => referenceSelectorApi.goToRoot(setNoteCurrentFolderId)}
                  className="text-slate-400 hover:text-emerald-500 transition-colors"
                >
                  根目录
                </button>
                {breadcrumbFolders.map((folder) => (
                  <React.Fragment key={folder.id}>
                    <svg className="w-2.5 h-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    <button
                      onClick={() => referenceSelectorApi.openFolder(folder.id, setNoteCurrentFolderId)}
                      className={`truncate max-w-[90px] ${folder.id === noteCurrentFolderId ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-500'} transition-colors`}
                    >
                      {folder.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 p-1.5 rounded-2xl border border-emerald-100 bg-emerald-50/40 mb-2">
              <input
                type="text"
                value={newNoteFolderName}
                onChange={(e) => setNewNoteFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateNoteSubFolder()}
                placeholder={`在${currentNoteFolderName}下新建子文件夹...`}
                className="flex-1 bg-white border border-emerald-100 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 outline-none focus:border-emerald-300"
              />
              <button
                onClick={handleCreateNoteSubFolder}
                className="px-3 py-2 text-[11px] font-black rounded-xl border border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-all"
              >
                新建
              </button>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
              <div className={`flex items-center gap-2 p-2.5 rounded-xl border ${folderId === currentNoteFolderTargetId ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}>
                <button
                  onClick={() => { if (noteCurrentFolderId) referenceSelectorApi.goToRoot(setNoteCurrentFolderId); }}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-[12px] font-black text-slate-700 truncate">{currentNoteFolderName}</div>
                  <div className="text-[10px] text-slate-400 font-bold">当前目录</div>
                </button>
                <button
                  onClick={() => setFolderId(currentNoteFolderTargetId)}
                  className={`px-3 py-1.5 text-[11px] font-black rounded-xl border transition-all ${folderId === currentNoteFolderTargetId ? 'border-emerald-300 bg-emerald-500 text-white' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                >
                  {folderId === currentNoteFolderTargetId ? '已选' : '选择'}
                </button>
              </div>

              {noteInteractionData.folderRows.length > 0 ? noteInteractionData.folderRows.map((folder) => (
                <div key={folder.id} className={`relative ml-5 w-[calc(100%-1.25rem)] flex items-center gap-2 p-2.5 rounded-xl border transition-all ${folderId === folder.id ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white hover:bg-emerald-50/30'}`}>
                  <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-slate-300">↳</div>
                  <button
                    onClick={() => referenceSelectorApi.openFolder(folder.id, setNoteCurrentFolderId)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-[12px] font-black text-slate-700 truncate">{folder.name}</div>
                    <div className="text-[10px] text-slate-400 font-bold">
                      {folder.itemCount} 项{folder.subFolderCount > 0 ? ` · ${folder.subFolderCount} 个子文件夹` : ''}
                    </div>
                  </button>
                  <button
                    onClick={() => setFolderId(folder.id)}
                    className={`px-3 py-1.5 text-[11px] font-black rounded-xl border transition-all ${folderId === folder.id ? 'border-emerald-300 bg-emerald-500 text-white' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                  >
                    {folderId === folder.id ? '已选' : '选择'}
                  </button>
                </div>
              )) : (
                <p className="text-center text-[10px] text-slate-400 font-medium py-3">暂无子文件夹</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">标签</label>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
              {tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-600 text-[11px] font-bold border border-emerald-100">
                  {tag}
                  <button onClick={() => setTags(prev => prev.filter(t => t !== tag))} className="hover:text-emerald-800 leading-none text-base">×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 outline-none focus:border-emerald-300 transition-all placeholder:text-slate-300"
                placeholder="添加标签后按回车..."
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
              />
              <button onClick={handleAddTag} className="px-3 py-2 text-[11px] font-black rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all">添加</button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl text-sm font-black text-slate-500 bg-slate-50 hover:bg-slate-100 transition-all border border-slate-200"
            >
              取消
            </button>
            <button
              onClick={() => onSave(folderId, title.trim() || 'AI答疑记录', tags)}
              className="flex-1 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
            >
              确认收录
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};


// ===== 主 ChatPanel =====

export const ChatPanel: React.FC<ChatPanelProps> = ({ isOpen, onClose, currentProblems, chatProvider, visionProvider, onOpenSettings }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showProblemSelector, setShowProblemSelector] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState<ChatMessage['referencedProblem'] | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<NonNullable<ChatMessage['fileAttachments']>>([]);
  const [savedNoteIds, setSavedNoteIds] = useState<Record<string, boolean>>({});
  const [saveDialogTarget, setSaveDialogTarget] = useState<{ msg: ChatMessage; index: number } | null>(null);
  const [noteFolders, setNoteFolders] = useState<NoteFolder[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
    if (isOpen) {
      // 加载笔记文件夹
      setNoteFolders(storageService.getNoteFolders());
      // 从已存储笔记中恢复「已收录」状态
      const notes = storageService.getNotes();
      const ids: Record<string, boolean> = {};
      notes.forEach(note => {
        if (note.sourceMessageId) ids[note.sourceMessageId] = true;
      });
      setSavedNoteIds(prev => ({ ...prev, ...ids }));
    }
  }, [isOpen]);

  const isConfigured = chatProvider.apiKey || chatProvider.id === 'ollama';
  const isVisionConfigured = !!(visionProvider && (visionProvider.apiKey || visionProvider.id === 'ollama'));

  const showToast = useCallback((message: string, ms: number = 2800) => {
    setToast(message);
    setTimeout(() => setToast(null), ms);
  }, []);

  const isLikelyTextFile = useCallback((file: File): boolean => {
    const fileType = (file.type || '').toLowerCase();
    if (fileType.startsWith('text/')) return true;
    const ext = getFileExtension(file.name);
    return TEXT_FILE_EXTENSIONS.includes(ext);
  }, []);

  const attachImageFile = useCallback(async (file: File) => {
    if (!isVisionConfigured) {
      showToast('未配置视觉模型，无法上传图片。');
      return;
    }
    try {
      const dataUrl = await readFileAsDataURL(file);
      setPendingImage(dataUrl);
    } catch {
      showToast('图片读取失败，请重试。');
    }
  }, [isVisionConfigured, showToast]);

  const processPickedFiles = useCallback(async (picked: File[]) => {
    if (!picked.length) return;

    const remainSlots = Math.max(0, MAX_PENDING_FILES - pendingFiles.length);
    if (remainSlots <= 0) {
      showToast(`最多上传 ${MAX_PENDING_FILES} 个文件`);
      return;
    }

    const files = picked.slice(0, remainSlots);
    const nextAttachments: NonNullable<ChatMessage['fileAttachments']> = [];

    let skippedByType = 0;
    let skippedBySize = 0;
    let skippedWord = 0;
    let skippedEmpty = 0;
    let skippedScanPdf = 0;
    let skippedReadError = 0;

    for (const file of files) {
      const fileName = file.name || '未命名文件';
      const fileType = file.type || 'application/octet-stream';

      if (file.size <= 0) {
        skippedEmpty++;
        continue;
      }

      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        skippedBySize++;
        continue;
      }

      const isPdf = fileType === 'application/pdf' || PDF_FILE_EXTENSION_REGEX.test(fileName);
      const isWord = WORD_FILE_EXTENSION_REGEX.test(fileName)
        || fileType.includes('wordprocessingml')
        || fileType.includes('msword');

      if (isWord) {
        skippedWord++;
        continue;
      }

      if (!isPdf && !isLikelyTextFile(file)) {
        skippedByType++;
        continue;
      }

      try {
        if (isPdf) {
          let markdownText = '';
          let truncated = false;

          try {
            const base64Data = await readFileAsBase64(file);
            const response = await fetch('/api/convert-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: fileName, dataBase64: base64Data }),
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data?.success || !data?.markdown) {
              throw new Error(data?.error || 'markitdown 转换失败');
            }

            markdownText = String(data.markdown || '');
          } catch (err: any) {
            showToast(`MarkItDown 转换失败，已尝试本地解析：${err?.message || '未知错误'}`, 3200);
          }

          if (!markdownText) {
            const pdf = await extractPdfText(file, MAX_TEXT_CHARS);
            if (pdf.scannedLike) {
              skippedScanPdf++;
              continue;
            }
            markdownText = pdf.text;
            truncated = pdf.truncated;
          } else if (markdownText.length > MAX_TEXT_CHARS) {
            markdownText = markdownText.slice(0, MAX_TEXT_CHARS);
            truncated = true;
          }

          nextAttachments.push({
            name: fileName,
            type: fileType,
            size: file.size,
            encoding: 'MarkItDown',
            textContent: markdownText,
            truncated,
          });

          showToast(`${fileName} 已转换为 Markdown${truncated ? '（已截断）' : ''}`, 2400);
          continue;
        }

        const decoded = await readTextWithEncodingFallback(file, MAX_TEXT_CHARS);
        if (!decoded.text.trim()) {
          skippedReadError++;
          continue;
        }

        nextAttachments.push({
          name: fileName,
          type: fileType,
          size: file.size,
          encoding: decoded.encoding,
          textContent: decoded.text,
          truncated: decoded.truncated,
        });
      } catch {
        skippedReadError++;
      }
    }

    if (nextAttachments.length > 0) {
      setPendingFiles(prev => [...prev, ...nextAttachments]);
    }

    if (skippedWord > 0) {
      showToast(`有 ${skippedWord} 个 Word 文件无法直接提取文本，请复制内容或截图上传。`, 3400);
    }
    if (skippedScanPdf > 0) {
      showToast(`有 ${skippedScanPdf} 个 PDF 疑似扫描件，建议截图后走图片答疑。`, 3400);
    }
    if (skippedByType > 0) {
      showToast(`有 ${skippedByType} 个文件类型不支持，已跳过。`);
    }
    if (skippedBySize > 0) {
      showToast(`有 ${skippedBySize} 个文件超过 5MB（实际大小已检测），已跳过。`, 3200);
    }
    if (skippedEmpty > 0) {
      showToast(`有 ${skippedEmpty} 个空文件，已跳过。`);
    }
    if (skippedReadError > 0) {
      showToast(`有 ${skippedReadError} 个文件读取失败或内容为空。`, 3200);
    }
    if (picked.length > remainSlots) {
      showToast(`最多上传 ${MAX_PENDING_FILES} 个文件，超出部分已忽略。`);
    }
  }, [isLikelyTextFile, pendingFiles.length, showToast]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void attachImageFile(file);
    // 清空 input 值，允许重复上传同一文件
    e.target.value = '';
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked: File[] = e.target.files ? Array.from(e.target.files) : [];
    await processPickedFiles(picked);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const dropped: File[] = e.dataTransfer?.files ? Array.from(e.dataTransfer.files as FileList) : [];
    if (dropped.length === 0) return;

    const imageFiles = dropped.filter(f => (f.type || '').startsWith('image/'));
    const otherFiles = dropped.filter(f => !(f.type || '').startsWith('image/'));

    if (imageFiles.length > 0) {
      if (!isVisionConfigured) {
        showToast('检测到图片，但视觉模型未配置，已忽略图片。');
      } else {
        await attachImageFile(imageFiles[0]);
        if (imageFiles.length > 1) {
          showToast('一次仅附加 1 张图片，其余图片已忽略。');
        }
      }
    }

    if (otherFiles.length > 0) {
      await processPickedFiles(otherFiles);
    }
  };

  const renderMathContent = useCallback((text: string) => {
    if (!text) return '';
    const katex = (window as any).katex;
    if (!katex) return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

    let processed = text.replace(/\\\[([\s\S]+?)\\\]/g, '$$$$$1$$$$');
    processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, '$$$1$$');

    // Split into code blocks and non-code blocks
    const codeBlockRegex = /(```[\s\S]*?```)/g;
    const segments = processed.split(codeBlockRegex);

    return segments.map(segment => {
      if (segment.startsWith('```') && segment.endsWith('```')) {
        const inner = segment.slice(3, -3);
        const firstNewline = inner.indexOf('\n');
        const code = firstNewline > -1 ? inner.slice(firstNewline + 1) : inner;
        return `<pre class="bg-slate-100 rounded-xl p-3 my-2 overflow-x-auto text-xs"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
      }

      // Process math and markdown in non-code segments
      const parts = segment.split(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g);
      return parts.map(part => {
        try {
          if (part.startsWith('$$') && part.endsWith('$$')) {
            return `<span class="katex-display">${katex.renderToString(part.slice(2, -2).trim(), { displayMode: true, throwOnError: false })}</span>`;
          }
          if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
            return katex.renderToString(part.slice(1, -1).trim(), { throwOnError: false });
          }
        } catch { /* fallback */ }
        // Basic Markdown: bold, italic, headers
        return part
          .replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/^### (.+)$/gm, '<h4 class="font-bold text-sm mt-3 mb-1">$1</h4>')
          .replace(/^## (.+)$/gm, '<h3 class="font-bold text-base mt-3 mb-1">$1</h3>')
          .replace(/^# (.+)$/gm, '<h2 class="font-bold text-lg mt-3 mb-1">$1</h2>')
          .replace(/\n/g, '<br/>');
      }).join('');
    }).join('');
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();

    if ((!text && !pendingImage && pendingFiles.length === 0) || isStreaming) return;

    let finalContent = text;
    if (!finalContent) {
      if (pendingImage && pendingFiles.length > 0) finalContent = '请结合我上传的图片和文件内容进行分析';
      else if (pendingImage) finalContent = '请分析这张图片';
      else finalContent = '请根据我上传的文件进行讲解';
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: finalContent,
      timestamp: Date.now(),
      referencedProblem: selectedProblem || undefined,
      image: pendingImage || undefined,
      fileAttachments: pendingFiles.length > 0 ? pendingFiles : undefined,
      fileAttachment: pendingFiles.length > 0 ? pendingFiles[0] : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSelectedProblem(null);
    setPendingImage(null);
    setPendingFiles([]);
    setIsStreaming(true);

    // 有图片时优先用视觉模型
    const activeProvider = (userMsg.image && isVisionConfigured && visionProvider)
      ? visionProvider
      : chatProvider;
    const activeModelLabel = `${activeProvider.name} · ${activeProvider.model}`;

    // Create placeholder assistant message
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      modelLabel: activeModelLabel,
    };
    setMessages(prev => [...prev, assistantMsg]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await streamChat(
        activeProvider,
        [...messages, userMsg],
        {
          onToken: (token) => {
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, content: m.content + token } : m)
            );
          },
          onDone: () => {
            setIsStreaming(false);
            abortRef.current = null;
          },
          onError: (error) => {
            setMessages(prev =>
              prev.map(m => m.id === assistantId
                ? { ...m, content: m.content || `⚠️ 错误：${error}` }
                : m
              )
            );
            setIsStreaming(false);
            abortRef.current = null;
          },
        },
        abort.signal
      );
    } catch {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, pendingImage, pendingFiles, isStreaming, selectedProblem, messages, chatProvider, visionProvider, isVisionConfigured]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleClear = () => {
    if (isStreaming) handleStop();
    setMessages([]);
    setSelectedProblem(null);
    setPendingImage(null);
    setPendingFiles([]);
    setSavedNoteIds({});
    setSaveDialogTarget(null);
  };

  const handleSaveToNote = useCallback((assistantMsg: ChatMessage, index: number) => {
    if (savedNoteIds[assistantMsg.id]) return;
    if (!assistantMsg.content.trim()) return;
    setSaveDialogTarget({ msg: assistantMsg, index });
  }, [savedNoteIds]);

  const handleConfirmSave = useCallback((folderId: string, title: string, tags: string[]) => {
    if (!saveDialogTarget) return;
    const { msg: assistantMsg, index } = saveDialogTarget;
    const prevUser = [...messages].slice(0, index).reverse().find(m => m.role === 'user');
    const contentParts: string[] = [];

    if (prevUser) {
      contentParts.push(`【问题】${prevUser.content || '图片问题'}`);
      if (prevUser.referencedProblem) {
        contentParts.push(`【引用题目】${prevUser.referencedProblem.source}`);
      }
      if (prevUser.image) contentParts.push('【图片】见附件');
      const noteFiles = prevUser.fileAttachments && prevUser.fileAttachments.length > 0
        ? prevUser.fileAttachments
        : (prevUser.fileAttachment ? [prevUser.fileAttachment] : []);
      if (noteFiles.length > 0) {
        contentParts.push(`【文件】${noteFiles.map(f => f.name).join('、')}`);
      }
    }
    contentParts.push('【AI回答】');
    contentParts.push(assistantMsg.content);

    const newNote: NoteItem = {
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      title,
      content: contentParts.join('\n'),
      images: prevUser?.image ? [prevUser.image] : [],
      folderId,
      tags,
      sourceMessageId: assistantMsg.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    storageService.saveNote(newNote);
    const latestFolders = storageService.getNoteFolders();
    setNoteFolders(latestFolders);
    setSavedNoteIds(prev => ({ ...prev, [assistantMsg.id]: true }));
    setSaveDialogTarget(null);

    // 显示 Toast
    const folder = latestFolders.find(f => f.id === folderId);
    const folderName = folder ? folder.name : '根目录';
    setToast(`已收录到「${folderName}」`);
    setTimeout(() => setToast(null), 2800);
  }, [saveDialogTarget, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center sm:justify-end">
      {/* 收录到笔记对话框 */}
      {saveDialogTarget && (
        <SaveToNoteDialog
          assistantMsg={saveDialogTarget.msg}
          prevUserMsg={[...messages].slice(0, saveDialogTarget.index).reverse().find(m => m.role === 'user') ?? null}
          folders={noteFolders}
          onSave={handleConfirmSave}
          onCancel={() => setSaveDialogTarget(null)}
        />
      )}

      {/* Toast 通知 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] px-5 py-3 bg-slate-800 text-white text-[13px] font-bold rounded-2xl shadow-xl flex items-center gap-2 animate-popIn">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          {toast}
        </div>
      )}

      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-overlayIn" onClick={onClose}></div>

      {/* Panel */}
      <div className="relative w-full sm:w-[480px] h-[85vh] sm:h-[90vh] sm:mr-6 bg-white rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col overflow-hidden animate-slideUp" style={{animationDuration:'0.4s'}}>

        {/* Problem Selector Overlay */}
        <ProblemSelector
          isOpen={showProblemSelector}
          onClose={() => setShowProblemSelector(false)}
          onSelect={(problem) => {
            setSelectedProblem(problem);
            setShowProblemSelector(false);
            inputRef.current?.focus();
          }}
          currentProblems={currentProblems}
        />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center text-white shadow-lg transition-transform duration-300 hover:scale-110 hover:rotate-6">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">ai对话助手</h2>
              <p className="text-[10px] text-slate-400 font-bold">
                {isConfigured ? `${chatProvider.name} · ${chatProvider.model}` : '未配置模型'}
                {isVisionConfigured && visionProvider && (
                  <span className="ml-1.5 text-violet-400">· 视觉 {visionProvider.model}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleClear}
              className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all"
              title="清空对话"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">
          {!isConfigured && (
            <div className="mx-auto max-w-xs text-center py-12">
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-400 mx-auto mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              </div>
              <h3 className="font-black text-slate-700 text-sm mb-2">尚未配置答疑模型</h3>
              <p className="text-xs text-slate-400 font-medium mb-4">请前往设置页面配置答疑对话使用的 AI 模型和 API Key。</p>
              <button
                onClick={onOpenSettings}
                className="px-6 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 transition-all shadow-lg"
              >
                前往设置
              </button>
            </div>
          )}

          {isConfigured && messages.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-300 mx-auto mb-4 animate-float">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              </div>
              <h3 className="font-black text-slate-700 text-sm mb-2 animate-fadeIn" style={{animationDelay:'0.1s'}}>有什么数学问题？</h3>
              <p className="text-xs text-slate-400 font-medium mb-6 animate-fadeIn" style={{animationDelay:'0.2s'}}>可以选择题目提问，也可以直接询问知识点</p>
              <div className="flex flex-wrap justify-center gap-2">
                {['这道题怎么做？', '帮我讲解一下这个知识点', '为什么我的方法是错的？', '类似的题还有哪些？'].map((hint, i) => (
                  <button
                    key={hint}
                    onClick={() => setInput(hint)}
                    className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] font-medium text-slate-500 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 hover:scale-105 hover:-translate-y-0.5 transition-all animate-fadeIn active:scale-95"
                    style={{animationDelay:`${0.3 + i * 0.05}s`}}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, index) => (
            <div key={msg.id} className={`flex flex-col animate-messageIn ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className="max-w-[85%]">
                {/* 引用题目标签 */}
                {msg.role === 'user' && msg.referencedProblem && (
                  <div className="mb-1 flex justify-end">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-[10px] font-bold text-indigo-600 border border-indigo-100">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                      {msg.referencedProblem.source}
                    </span>
                  </div>
                )}
                {/* 用户上传的图片 */}
                {msg.role === 'user' && msg.image && (
                  <div className="mb-1 flex justify-end">
                    <img src={msg.image} alt="用户上传" className="max-w-[200px] max-h-[160px] rounded-xl border border-indigo-200 object-cover" />
                  </div>
                )}
                {msg.role === 'user' && ((msg.fileAttachments && msg.fileAttachments.length > 0) || msg.fileAttachment) && (
                  <div className="mb-1 flex justify-end">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 text-[10px] font-bold text-violet-600 border border-violet-100 max-w-[230px] truncate">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828a4 4 0 00-5.656-5.656L5.757 10.757a6 6 0 108.486 8.486L20.5 13" /></svg>
                      {(() => {
                        const files = msg.fileAttachments && msg.fileAttachments.length > 0
                          ? msg.fileAttachments
                          : (msg.fileAttachment ? [msg.fileAttachment] : []);
                        if (files.length <= 1) return files[0]?.name || '文件';
                        return `${files[0].name} 等 ${files.length} 个文件`;
                      })()}
                    </span>
                  </div>
                )}
                <div
                  className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed transition-all duration-300 ${msg.role === 'user'
                      ? 'bg-indigo-600 text-white font-medium rounded-br-md hover:bg-indigo-700'
                      : 'bg-slate-100 text-slate-800 font-medium rounded-bl-md hover:bg-slate-50'
                    }`}
                >
                  {msg.role === 'assistant' && msg.modelLabel && (
                    <div className="mb-2 text-[10px] font-bold text-violet-500">模型：{msg.modelLabel}</div>
                  )}
                  {msg.role === 'assistant' ? (
                    <div
                      className="chat-content prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: renderMathContent(msg.content) || (isStreaming ? '<span class="inline-block w-2 h-4 bg-slate-400 animate-pulse rounded-sm"></span>' : '') }}
                    />
                  ) : (
                    <div>{msg.content}</div>
                  )}
                </div>
              </div>
              {/* 收录到笔记按钮（仅 AI 消息且内容非空） */}
              {msg.role === 'assistant' && msg.content.trim() && (
                <div className="mt-1.5 ml-1">
                  {savedNoteIds[msg.id] ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[11px] font-bold border border-emerald-100">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      已收录
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSaveToNote(msg, index)}
                      disabled={isStreaming && index === messages.length - 1}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 text-[11px] font-bold border border-transparent hover:border-emerald-100 transition-all disabled:opacity-40"
                      title="收录到笔记"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      收录到笔记
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {isConfigured && (
          <div className="flex-shrink-0 border-t border-slate-100 p-4">
            {/* Selected problem badge */}
            {selectedProblem && (
              <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-xl border border-indigo-100 animate-fadeIn">
                <svg className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                <span className="text-[11px] font-bold text-indigo-700 flex-1 truncate">{selectedProblem.source}</span>
                <button
                  onClick={() => setSelectedProblem(null)}
                  className="w-5 h-5 rounded-md hover:bg-indigo-100 flex items-center justify-center text-indigo-400 hover:text-indigo-600 transition-all flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Image preview */}
            {pendingImage && (
              <div className="mb-2 flex items-start gap-2 animate-fadeIn">
                <div className="relative group">
                  <img src={pendingImage} alt="待发送图片" className="max-h-24 max-w-[160px] rounded-xl border border-violet-200 object-cover" />
                  <button
                    onClick={() => setPendingImage(null)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-all shadow"
                    title="移除图片"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <span className="text-[10px] font-bold text-violet-500 mt-1">图片已就绪，输入问题后发送</span>
              </div>
            )}

            {pendingFiles.length > 0 && (
              <div className="mb-2 flex items-start gap-2 animate-fadeIn">
                <div className="space-y-1.5 max-w-[300px] w-full">
                  {pendingFiles.map((file, idx) => (
                    <div key={`${file.name}_${idx}`} className="relative group px-3 py-2 rounded-xl border border-violet-200 bg-violet-50">
                      <div className="text-[11px] font-bold text-violet-700 truncate">{file.name}</div>
                      <div className="text-[10px] text-violet-400 mt-0.5">
                        {formatFileSize(file.size)}
                        {file.encoding ? ` · ${file.encoding}` : ''}
                        {file.textContent ? ' · 已提取文本' : ' · 仅附加文件信息'}
                        {file.truncated ? ' · 已截断' : ''}
                      </div>
                      <button
                        onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-all shadow"
                        title="移除文件"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
                <span className="text-[10px] font-bold text-violet-500 mt-1">已附加 {pendingFiles.length}/{MAX_PENDING_FILES} 个文件，发送后会作为提问上下文</span>
              </div>
            )}

            {!isVisionConfigured && (
              <div className="mb-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-medium text-slate-400">
                未配置视觉模型，相机功能不可用；不上传图片时将默认使用答疑模型。
              </div>
            )}

            <div
              className={`relative rounded-2xl transition-all ${isDragOver ? 'ring-2 ring-violet-300 bg-violet-50/40' : ''}`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {isDragOver && (
                <div className="absolute -top-9 left-0 right-0 text-center text-[11px] font-black text-violet-600 animate-fadeIn">
                  松开鼠标即可上传文件（图片会走视觉答疑）
                </div>
              )}

            <div className="flex gap-2">
              {/* 隐藏的文件选择 */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={FILE_ACCEPT_EXTENSIONS}
                className="hidden"
                onChange={handleFileUpload}
              />
              {/* 选题按钮 */}
              <button
                onClick={() => setShowProblemSelector(true)}
                disabled={isStreaming}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition-all disabled:opacity-50"
                title="选择题目"
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
              </button>
              {/* 上传文件按钮 */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                className={`flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-all disabled:opacity-50 ${
                  pendingFiles.length > 0
                    ? 'bg-violet-50 border-violet-300 text-violet-600'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-violet-600 hover:bg-violet-50 hover:border-violet-200'
                }`}
                title={`上传文件作为上下文（最多 ${MAX_PENDING_FILES} 个）`}
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828a4 4 0 00-5.656-5.656L5.757 10.757a6 6 0 108.486 8.486L20.5 13" /></svg>
              </button>

              {/* 上传图片按钮 */}
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={isStreaming || !isVisionConfigured}
                className={`flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center transition-all disabled:opacity-50 ${
                  !isVisionConfigured
                    ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
                    :
                  pendingImage
                    ? 'bg-violet-50 border-violet-300 text-violet-600'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-violet-600 hover:bg-violet-50 hover:border-violet-200'
                }`}
                title={isVisionConfigured ? '上传图片答疑' : '未配置视觉模型，无法上传图片'}
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>

              {/* Input */}
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-12 text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 focus:bg-white transition-all resize-none placeholder:text-slate-300"
                  placeholder={pendingImage ? "描述图片中的问题..." : pendingFiles.length > 0 ? "描述你希望我如何处理这些文件..." : selectedProblem ? "关于这道题，你想问什么？" : "输入你的数学问题..."}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // Auto-resize
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming}
                />
              </div>

              {/* Send / Stop */}
              {isStreaming ? (
                <button
                  onClick={handleStop}
                  className="flex-shrink-0 w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-all shadow-lg hover:scale-105 active:scale-95 animate-popIn"
                  title="停止生成"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && !pendingImage && pendingFiles.length === 0}
                  className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                    (input.trim() || pendingImage || pendingFiles.length > 0)
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg'
                      : 'bg-slate-100 text-slate-300'
                  }`}
                  title="发送"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-7 7m7-7l7 7" /></svg>
                </button>
              )}
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
