
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { createPortal } from 'react-dom';
import { SuitDecorations } from '@/components/common/SuitDecorations';
import { MathProblem, WrongProblem, WrongProblemFolder, QBankFolder, DEFAULT_FOLDER_ID, DEFAULT_QBANK_FOLDER_ID } from '@/types';
import { storageService } from '@/services/storage';
import { qbankCollectionApi } from '@/services/api/qbankApi';
import { folderManagerApi } from '@/services/api/folderApi';
import { referenceSelectorApi } from '@/services/api/refApi';

/**
 * 从模型输出中分离 <think>...</think> 块和主解答内容。
 *
 * Why: DeepSeek 推理模型会在输出头部包含大量自我推导（<think>...\</think>\n\n最终答案），
 *      直接展示会射乱版面。把思考过程折叠或隐藏对用户更友好。
 *
 * @param text - 原始 explanation 字符串
 * @returns thinkContent 思考过程文本、mainContent 主解答内容、isThinkComplete 思考是否已结束
 */
function parseExplanation(text: string): {
  thinkContent: string;
  mainContent: string;
  isThinkComplete: boolean;
} {
  // 1. 完整的 <think>...</think> 块（模型已结束思考）
  const completeMatch = text.match(/^<think>([\s\S]*?)<\/think>\s*/);
  if (completeMatch) {
    return {
      thinkContent: completeMatch[1].trim(),
      mainContent: text.slice(completeMatch[0].length),
      isThinkComplete: true,
    };
  }
  // 2. 未闭合的 <think>（流式输出中，模型还在思考）
  const partialMatch = text.match(/^<think>([\s\S]*)/);
  if (partialMatch) {
    return {
      thinkContent: partialMatch[1],
      mainContent: '',
      isThinkComplete: false,
    };
  }
  // 3. 无 <think> 块（模型直接答题）
  return { thinkContent: '', mainContent: text, isThinkComplete: true };
}

interface ProblemCardProps {
  problem: MathProblem;
  index: number;
  isSaved?: boolean;
  onSavedChange?: () => void;
}

export const ProblemCard: React.FC<ProblemCardProps> = ({ problem, index, isSaved: initialIsSaved = false, onSavedChange }) => {
  const [showSolution, setShowSolution] = useState(false);

  // 判断当前是否处于流式解析中。
  // Why: answer 为空并不代表解析未完成，必须使用独立状态位避免误伤收录按钮。
  const isExplanationPlaceholder = problem.explanation === '解析生成中...' || problem.explanation === '解析生成中，请稍候...';
  const isStreaming = Boolean(problem.isExplanationStreaming);
  const isExplanationReady = !isExplanationPlaceholder && !isStreaming && problem.explanation.length > 0;

  // 解析占位期间或流式输出期间自动展开解析区域；
  // 解析完成后保持当前展开状态（不强制收起）。
  // Why: 移除强制展开逻辑，默认折叠，用户点击按鈕后才展开解析区域。

  // <think> 块的展开/折叠状态
  // <think> 块默认折叠，用户手动点击展开/收起。
  const [showThink, setShowThink] = useState(false);
  const { thinkContent, mainContent, isThinkComplete } = parseExplanation(problem.explanation);
  const shouldUseThinkAsExplanation = !isStreaming && isThinkComplete && !mainContent && thinkContent.length > 0;

  const [showErrorSelector, setShowErrorSelector] = useState(false);
  const [showBankSelector, setShowBankSelector] = useState(false);
  const [isSaved, setIsSaved] = useState(initialIsSaved);
  const [isBankSaved, setIsBankSaved] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [newWrongFolderName, setNewWrongFolderName] = useState('');
  const [folders, setFolders] = useState<WrongProblemFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(DEFAULT_FOLDER_ID);
  const [wrongCurrentFolderId, setWrongCurrentFolderId] = useState<string | undefined>(undefined);
  const [qbankFolders, setQBankFolders] = useState<QBankFolder[]>([]);
  const [qbankCurrentFolderId, setQbankCurrentFolderId] = useState<string | undefined>(undefined);
  const [newQbankFolderName, setNewQbankFolderName] = useState('');

  useEffect(() => {
    setFolders(storageService.getFolders());
    setQBankFolders(qbankCollectionApi.getFolders());
    // 检查是否在题库中
    if (qbankCollectionApi.hasSameQuestion(problem.question)) {
      setIsBankSaved(true);
    }
  }, [problem.question]); // check when problem changes

  const renderMathContent = (text: string) => {
    if (!text) return "";
    const katex = (window as any).katex;
    if (!katex) return text;

    // 预处理：将常见的 LaTeX 块级/行内定界符统一转换为 $ 和 $$ 方便后续正则处理
    // 处理 \[ ... \] -> $$ ... $$
    let processedText = text.replace(/\\\[([\s\S]+?)\\\]/g, '$$$$$1$$$$');
    // 处理 \( ... \) -> $ ... $
    processedText = processedText.replace(/\\\(([\s\S]+?)\\\)/g, '$$$1$$');

    // 正则匹配 $$...$$ 和 $...$
    // 注意：先匹配双美元符号，再匹配单美元符号
    const parts = processedText.split(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g);
    
    return parts.map((part) => {
      try {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const content = part.slice(2, -2).trim();
          return `<span class="katex-display">${katex.renderToString(content, { displayMode: true, throwOnError: false })}</span>`;
        } else if (part.startsWith('$') && part.endsWith('$')) {
          const content = part.slice(1, -1).trim();
          return katex.renderToString(content, { displayMode: false, throwOnError: false });
        }
        return part;
      } catch (e) { 
        console.error("KaTeX error:", e);
        return part; 
      }
    }).join('');
  };

  const handleSaveWrong = (type: string) => {
    const wrongProblem: WrongProblem = {
      ...problem,
      addedAt: Date.now(),
      errorType: type,
      folderId: selectedFolderId
    };
    storageService.addWrongProblem(wrongProblem);
    setIsSaved(true);
    setShowErrorSelector(false);
    onSavedChange?.();
  };

  const handleAddCustom = () => {
    if (!customInput.trim()) return;
    storageService.addCustomErrorType(customInput.trim(), selectedFolderId);
    handleSaveWrong(customInput.trim());
    setCustomInput('');
  };

  const handleCollectWrongToFolder = (folderId: string, folderName: string) => {
    const errorType = folderName === '根目录' ? '未分类' : folderName;
    const wrongProblem: WrongProblem = {
      ...problem,
      addedAt: Date.now(),
      errorType,
      folderId,
    };
    storageService.addWrongProblem(wrongProblem);
    setIsSaved(true);
    setShowErrorSelector(false);
    onSavedChange?.();
  };

  const handleCreateWrongSubFolder = () => {
    const name = newWrongFolderName.trim();
    if (!name) return;
    const parentId = wrongCurrentFolderId || DEFAULT_FOLDER_ID;
    const created = folderManagerApi.addFolder('wrong', name, parentId) as WrongProblemFolder;
    const updatedFolders = storageService.getFolders();
    setFolders(updatedFolders);
    setWrongCurrentFolderId(created.id);
    setSelectedFolderId(created.id);
    setNewWrongFolderName('');
  };

  const handleRemove = () => {
    storageService.removeWrongProblem(problem.id);
    setIsSaved(false);
    onSavedChange?.();
  };

  const handleSaveToBank = (folderId: string) => {
      const result = qbankCollectionApi.saveProblemToQBank(problem, folderId);
      if (result.saved || result.duplicated) {
        setIsBankSaved(true);
      }
      setShowBankSelector(false);
  };

  const handleRemoveFromBank = () => {
    const removed = qbankCollectionApi.removeProblemFromQBank(problem.question);
    if (removed) {
      setIsBankSaved(false);
      toast.success('已取消收藏。');
    } else {
      toast.error('未找到对应的收藏题目。');
    }
  };

  const handleCreateQbankSubFolder = () => {
    const name = newQbankFolderName.trim();
    if (!name) return;
    const parentId = qbankCurrentFolderId || DEFAULT_QBANK_FOLDER_ID;
    const created = folderManagerApi.addFolder('qbank', name, parentId) as QBankFolder;
    const updatedQbankFolders = qbankCollectionApi.getFolders();
    setQBankFolders(updatedQbankFolders);
    setQbankCurrentFolderId(created.id);
    setNewQbankFolderName('');
  };

  const qbankInteractionData = referenceSelectorApi.getFolderInteractionData(
    qbankFolders,
    qbankCurrentFolderId,
    (fid) => folderManagerApi.getItemCountByFolder('qbank', fid),
  );

  const currentQbankFolderId = qbankCurrentFolderId || DEFAULT_QBANK_FOLDER_ID;
  const currentQbankFolderName = qbankCurrentFolderId
    ? (qbankFolders.find(f => f.id === qbankCurrentFolderId)?.name || '当前目录')
    : '根目录';

  const wrongInteractionData = referenceSelectorApi.getFolderInteractionData(
    folders,
    wrongCurrentFolderId,
    (fid) => folderManagerApi.getItemCountByFolder('wrong', fid),
  );

  const currentWrongFolderId = wrongCurrentFolderId || DEFAULT_FOLDER_ID;
  const currentWrongFolderName = wrongCurrentFolderId
    ? (folders.find(f => f.id === wrongCurrentFolderId)?.name || '当前目录')
    : '根目录';

  const handleOptionClick = () => {
    if (!showSolution) {
      setShowSolution(true);
    }
  };

  const renderGlobalModal = (node: React.ReactNode) => {
    if (typeof document === 'undefined') return null;
    return createPortal(node, document.body);
  };

  return (
    <div className={`group bg-white rounded-[2rem] border transition-all duration-500 relative hover-float-3d ${
      (showErrorSelector || showBankSelector) ? 'z-[9999] overflow-visible' : 'z-10 overflow-hidden'
    } ${isSaved ? 'border-rose-100 shadow-rose-50' : 'border-slate-200 shadow-sm'} hover:shadow-xl mb-8`}>
      <SuitDecorations variant="scatter" />
      <div className="p-8">
        {/* Header Section */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm transition-all duration-500 ${isSaved ? 'bg-rose-600 text-white shadow-lg shadow-rose-100 animate-popIn' : 'bg-slate-100 text-slate-400 group-hover:bg-sky-50 group-hover:text-sky-400 group-hover:scale-110 group-hover:rotate-3'}`}>
              {index + 1}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{problem.syllabus}</span>
                <span className="w-1 h-1 rounded-full bg-slate-200"></span>
                <span className={`text-[10px] font-black uppercase ${problem.difficulty === '较难' ? 'text-rose-500' : 'text-emerald-500'}`}>{problem.difficulty}</span>
              </div>
              {isSaved && <p className="text-[9px] font-bold text-rose-400 uppercase tracking-tight mt-0.5">记录于错题本</p>}
            </div>
          </div>
          
          <div className="flex gap-2">
             <span className="px-3 py-1 bg-slate-50 border border-slate-100 rounded-full text-[10px] font-bold text-slate-500 uppercase">{problem.questionType}</span>
          </div>
        </div>

        {/* Content Section */}
        <div className="mb-10 px-2 overflow-hidden">
          <div 
            className="text-xl text-slate-800 leading-relaxed math-font select-all" 
            dangerouslySetInnerHTML={{ __html: renderMathContent(problem.question) }} 
          />
        </div>

        {/* Options Section (If Choice) */}
        {problem.options && problem.options.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10 overflow-hidden">
            {problem.options.map((opt, i) => (
              <button 
                key={i} 
                onClick={handleOptionClick}
                className="group/opt flex items-center p-5 rounded-2xl border border-slate-100 hover:border-sky-500 hover:bg-sky-50/30 transition-all duration-300 text-left w-full focus:outline-none focus:ring-4 focus:ring-sky-50 active:scale-[0.97] hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="w-9 h-9 shrink-0 bg-slate-50 group-hover/opt:bg-sky-600 group-hover/opt:text-white group-hover/opt:scale-110 group-hover/opt:rotate-3 transition-all duration-300 border border-slate-100 rounded-xl flex items-center justify-center text-xs font-black text-slate-400 mr-4">
                  {String.fromCharCode(65 + i)}
                </div>
                <div className="text-[15px] math-font text-slate-600 group-hover/opt:text-slate-900 transition-colors" dangerouslySetInnerHTML={{ __html: renderMathContent(opt) }} />
              </button>
            ))}
          </div>
        )}

        {/* Action Footer */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-8 border-t border-slate-50 relative">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSolution(!showSolution)} 
              className={`flex items-center gap-2.5 px-6 py-3 rounded-2xl text-xs font-black transition-all duration-300 btn-ripple ${
                showSolution ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-sky-600 text-white shadow-xl shadow-sky-100 hover:-translate-y-0.5 hover:shadow-sky-200/60 active:translate-y-0 active:scale-95'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={showSolution ? "M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" : "M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"} />
              </svg>
              {showSolution ? '收起解析' : '查看解析'}
            </button>

            <div className="relative">
              <button
                 disabled={isExplanationPlaceholder || isStreaming}
                 onClick={() => {
                   if (isBankSaved) {
                     handleRemoveFromBank();
                     return;
                   }
                   setShowBankSelector(v => {
                     const next = !v;
                     if (next) {
                       setQbankCurrentFolderId(undefined);
                       setNewQbankFolderName('');
                     }
                     return next;
                   });
                   setShowErrorSelector(false);
                 }}
                 className={`flex items-center gap-2.5 px-6 py-3 rounded-2xl text-xs font-black transition-all ${
                   (isExplanationPlaceholder || isStreaming)
                   ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                   : isBankSaved
                   ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 active:scale-95'
                   : showBankSelector ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 active:scale-95'
                 }`}
              >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={isBankSaved ? "M6 18L18 6M6 6l12 12" : "M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"} />
                 </svg>
                 {isBankSaved ? '取消收藏' : '收藏到题库'}
              </button>

                {showBankSelector && renderGlobalModal(
                  <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => setShowBankSelector(false)}>
                    <div className="w-[min(360px,92vw)] bg-white border border-slate-200 rounded-[2rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] overflow-hidden animate-popIn ring-1 ring-black/5" onClick={e => e.stopPropagation()}>
                      <div className="p-5 bg-slate-50/80 border-b border-slate-100">
                        <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                          选择题库文件夹
                        </h4>
                        <p className="text-[11px] text-slate-400 font-bold mt-1 leading-relaxed">点击文件夹进入，右侧按钮可直接收藏到该文件夹。</p>
                      </div>
                      <div className="p-4 space-y-3">
                        {qbankCurrentFolderId && (
                          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 px-1 flex-wrap">
                            <button
                              onClick={() => referenceSelectorApi.goToRoot(setQbankCurrentFolderId)}
                              className="text-slate-400 hover:text-indigo-500 transition-colors"
                            >
                              根目录
                            </button>
                            {qbankInteractionData.breadcrumbFolders.map((folder) => (
                              <React.Fragment key={folder.id}>
                                <svg className="w-2.5 h-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                <button
                                  onClick={() => referenceSelectorApi.openFolder(folder.id, setQbankCurrentFolderId)}
                                  className={`truncate max-w-[90px] ${folder.id === qbankCurrentFolderId ? 'text-indigo-600' : 'text-slate-400 hover:text-indigo-500'} transition-colors`}
                                >
                                  {folder.name}
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2 p-1.5 rounded-2xl border border-indigo-100 bg-indigo-50/40">
                          <input
                            type="text"
                            value={newQbankFolderName}
                            onChange={(e) => setNewQbankFolderName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateQbankSubFolder()}
                            placeholder={`在${currentQbankFolderName}下新建子文件夹...`}
                            className="flex-1 bg-white border border-indigo-100 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 outline-none focus:border-indigo-300"
                          />
                          <button
                            onClick={handleCreateQbankSubFolder}
                            className="px-3 py-2 text-[11px] font-black rounded-xl border border-indigo-200 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all"
                          >
                            新建
                          </button>
                        </div>

                        <div className="max-h-56 overflow-y-auto space-y-2 custom-scrollbar">
                          <div className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white">
                            <button
                              onClick={() => { if (qbankCurrentFolderId) referenceSelectorApi.goToRoot(setQbankCurrentFolderId); }}
                              className="flex-1 text-left min-w-0"
                            >
                              <div className="text-[12px] font-black text-slate-700 truncate">{currentQbankFolderName}</div>
                              <div className="text-[10px] text-slate-400 font-bold">当前目录</div>
                            </button>
                            <button
                              onClick={() => handleSaveToBank(currentQbankFolderId)}
                              className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all"
                            >
                              收藏
                            </button>
                          </div>

                          {qbankInteractionData.folderRows.length > 0 ? qbankInteractionData.folderRows.map((folder) => (
                            <div key={folder.id} className="relative ml-5 w-[calc(100%-1.25rem)] flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50/30 transition-all">
                              <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-slate-300">↳</div>
                              <button
                                onClick={() => referenceSelectorApi.openFolder(folder.id, setQbankCurrentFolderId)}
                                className="flex-1 text-left min-w-0"
                              >
                                <div className="text-[12px] font-black text-slate-700 truncate">{folder.name}</div>
                                <div className="text-[10px] text-slate-400 font-bold">
                                  {folder.itemCount} 项{folder.subFolderCount > 0 ? ` · ${folder.subFolderCount} 个子文件夹` : ''}
                                </div>
                              </button>
                              <button
                                onClick={() => handleSaveToBank(folder.id)}
                                className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all"
                              >
                                收藏
                              </button>
                            </div>
                          )) : (
                            <p className="text-center text-[10px] text-slate-400 font-medium py-3">暂无子文件夹</p>
                          )}
                        </div>
                      </div>
                    </div>
                </div>
              )}
            </div>

            {!isSaved ? (
              <div className="relative">
                <button 
                  disabled={isExplanationPlaceholder || isStreaming}
                  onClick={() => {
                    setShowErrorSelector(!showErrorSelector);
                    setShowBankSelector(false);
                    setWrongCurrentFolderId(undefined);
                  }} 
                  className={`flex items-center gap-2.5 px-6 py-3 rounded-2xl text-xs font-black transition-all ${
                    (isExplanationPlaceholder || isStreaming)
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    : showErrorSelector ? 'bg-rose-600 text-white shadow-xl shadow-rose-100' : 'bg-rose-50 text-rose-600 hover:bg-rose-100 active:scale-95'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  收入错题本
                </button>

                {showErrorSelector && renderGlobalModal(
                  <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => setShowErrorSelector(false)}>
                    <div className="w-[min(360px,92vw)] max-h-[78vh] bg-white border border-slate-200 rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] overflow-hidden animate-popIn ring-1 ring-black/5 flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="p-4 bg-slate-50/80 border-b border-slate-100 shrink-0">
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                        错误归因复盘
                      </h4>
                      <p className="text-[11px] text-slate-400 font-bold mt-1.5 leading-relaxed">选择文件夹并标记错误原因，我们将为您生成针对性的加固方案。</p>
                    </div>
                    
                    {/* Folder selector */}
                    <div className="px-4 pt-3 pb-2 border-b border-slate-100 shrink-0">
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className="w-5 h-5 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                        </div>
                        <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">保存到文件夹</span>
                      </div>
                      {wrongCurrentFolderId && (
                        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 px-1 flex-wrap mb-2.5">
                          <button
                            onClick={() => referenceSelectorApi.goToRoot(setWrongCurrentFolderId)}
                            className="text-slate-400 hover:text-amber-500 transition-colors"
                          >
                            根目录
                          </button>
                          {wrongInteractionData.breadcrumbFolders.map((folder) => (
                            <React.Fragment key={folder.id}>
                              <svg className="w-2.5 h-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                              <button
                                onClick={() => referenceSelectorApi.openFolder(folder.id, setWrongCurrentFolderId)}
                                className={`truncate max-w-[90px] ${folder.id === wrongCurrentFolderId ? 'text-amber-600' : 'text-slate-400 hover:text-amber-500'} transition-colors`}
                              >
                                {folder.name}
                              </button>
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mb-2.5 p-1.5 rounded-2xl border border-amber-100 bg-amber-50/40">
                        <input
                          type="text"
                          value={newWrongFolderName}
                          onChange={(e) => setNewWrongFolderName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateWrongSubFolder()}
                          placeholder={`在${currentWrongFolderName}下新建子文件夹...`}
                          className="flex-1 bg-white border border-amber-100 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 outline-none focus:border-amber-300"
                        />
                        <button
                          onClick={handleCreateWrongSubFolder}
                          className="px-3 py-2 text-[11px] font-black rounded-xl border border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all"
                        >
                          新建
                        </button>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
                        <div className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white">
                          <button
                            onClick={() => { if (wrongCurrentFolderId) referenceSelectorApi.goToRoot(setWrongCurrentFolderId); }}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="text-[12px] font-black text-slate-700 truncate">{currentWrongFolderName}</div>
                            <div className="text-[10px] text-slate-400 font-bold">当前目录</div>
                          </button>
                          <button
                            onClick={() => handleCollectWrongToFolder(currentWrongFolderId, currentWrongFolderName)}
                            className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all"
                          >
                            收藏
                          </button>
                        </div>

                        {wrongInteractionData.folderRows.length > 0 ? wrongInteractionData.folderRows.map((folder) => (
                          <div key={folder.id} className="relative ml-5 w-[calc(100%-1.25rem)] flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-amber-50/40 transition-all">
                            <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-slate-300">↳</div>
                            <button
                              onClick={() => referenceSelectorApi.openFolder(folder.id, setWrongCurrentFolderId)}
                              className="flex-1 text-left min-w-0"
                            >
                              <div className="text-[12px] font-black text-slate-700 truncate">{folder.name}</div>
                              <div className="text-[10px] text-slate-400 font-bold">
                                {folder.itemCount} 项{folder.subFolderCount > 0 ? ` · ${folder.subFolderCount} 个子文件夹` : ''}
                              </div>
                            </button>
                            <button
                              onClick={() => handleCollectWrongToFolder(folder.id, folder.name)}
                              className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all"
                            >
                              收藏
                            </button>
                          </div>
                        )) : (
                          <p className="text-center text-[10px] text-slate-400 font-medium py-2">暂无子文件夹</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5 scroll-smooth custom-scrollbar"></div>

                    {/* Custom Input */}
                    <div className="p-4 bg-slate-50 border-t border-slate-100 relative z-[110] shrink-0">
                      <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border-2 border-slate-100 focus-within:border-rose-400 focus-within:ring-4 focus-within:ring-rose-50 transition-all shadow-inner">
                        <input 
                          type="text" 
                          placeholder="手动输入新分类..." 
                          className="flex-1 text-xs px-3 py-2 outline-none bg-transparent font-black placeholder:text-slate-300"
                          value={customInput}
                          onChange={e => setCustomInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                        />
                        <button onClick={handleAddCustom} className="w-9 h-9 shrink-0 bg-rose-600 text-white rounded-[14px] flex items-center justify-center hover:bg-rose-700 transition-all shadow-lg shadow-rose-200 active:scale-90">
                          <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                        </button>
                      </div>
                    </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={handleRemove} className="flex items-center gap-2.5 px-6 py-3 rounded-2xl text-xs font-black text-slate-400 bg-slate-50 hover:bg-rose-50 hover:text-rose-600 transition-all border border-transparent hover:border-rose-100 active:scale-95">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                移出记录
              </button>
            )}
          </div>

          {isSaved && (
            <div className="flex items-center gap-3 animate-fadeIn">
               <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">错误分类 </span>
               <span className="px-4 py-1.5 bg-rose-500 text-white text-[10px] font-black rounded-full shadow-lg shadow-rose-100 ring-2 ring-white">{ (problem as any).errorType }</span>
               {(problem as any).folderId && (
                 <span className="px-3 py-1 bg-amber-100 text-amber-700 text-[10px] font-black rounded-full">
                   {folders.find(f => f.id === (problem as any).folderId)?.name || '默认'}
                 </span>
               )}
            </div>
          )}
        </div>

        {showSolution && (
          <div className="mt-10 space-y-6 animate-expandDown">
            {/* 解题思维路径 */}
            <div className="p-10 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm relative animate-slideUp" style={{animationDelay:'0.15s'}}>
              {/* 浮动数学符号装饰动画 */}
              <div className="absolute inset-0 pointer-events-none select-none overflow-hidden rounded-[2.5rem]" aria-hidden="true">
                <span className="absolute top-6 left-5 text-2xl suit-float-1 opacity-[0.06] text-indigo-500">∫</span>
                <span className="absolute top-[18%] left-12 text-lg suit-float-3 opacity-[0.05] text-emerald-500">π</span>
                <span className="absolute top-[35%] left-4 text-xl suit-float-2 opacity-[0.06] text-sky-500">Σ</span>
                <span className="absolute top-[55%] left-10 text-lg suit-float-4 opacity-[0.05] text-violet-500">∞</span>
                <span className="absolute top-[72%] left-6 text-2xl suit-float-1 opacity-[0.05] text-rose-400">Δ</span>
                <span className="absolute top-[88%] left-3 text-xl suit-float-3 opacity-[0.06] text-amber-500">θ</span>
                <span className="absolute top-4 right-8 text-3xl suit-float-2 opacity-[0.06] text-sky-400">√</span>
                <span className="absolute top-[20%] right-4 text-lg suit-float-4 opacity-[0.05] text-indigo-400">λ</span>
                <span className="absolute top-[40%] right-10 text-xl suit-float-1 opacity-[0.06] text-emerald-400">Ω</span>
                <span className="absolute top-[60%] right-5 text-2xl suit-float-3 opacity-[0.05] text-violet-400">∫</span>
                <span className="absolute top-[78%] right-8 text-lg suit-float-2 opacity-[0.06] text-rose-400">α</span>
                <span className="absolute top-[92%] right-3 text-xl suit-float-4 opacity-[0.05] text-sky-500">β</span>
              </div>
              <div className="flex items-center gap-3 mb-8">
                <div className={`w-2 h-6 rounded-full ${isExplanationReady ? 'bg-emerald-500' : isStreaming ? 'bg-sky-400 animate-pulse' : 'bg-slate-200'} transition-colors duration-500`}></div>
                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">解题思维路径</h5>
                {isExplanationPlaceholder && (
                  <span className="text-[10px] text-slate-400 animate-pulse ml-1">AI 解析生成中...</span>
                )}
                {isStreaming && (
                  <span className="text-[10px] text-sky-500 animate-pulse ml-1">AI 正在输出解析...</span>
                )}
              </div>
              {isExplanationPlaceholder ? (
                // 解析骨架屏（尚未开始流式输出）
                <div className="animate-pulse space-y-3 relative z-10">
                  <div className="h-4 bg-slate-100 rounded-lg w-full"></div>
                  <div className="h-4 bg-slate-100 rounded-lg w-11/12"></div>
                  <div className="h-4 bg-slate-100 rounded-lg w-4/5"></div>
                  <div className="h-4 bg-slate-100 rounded-lg w-full mt-4"></div>
                  <div className="h-4 bg-slate-100 rounded-lg w-3/4"></div>
                  <div className="h-4 bg-slate-100 rounded-lg w-5/6"></div>
                  <div className="h-4 bg-slate-100 rounded-lg w-2/3 mt-4"></div>
                </div>
              ) : (
                <div className="relative z-10 max-h-[560px] overflow-y-auto pr-2 custom-scrollbar">
                  {/* <think> 思考过程折叠块 */}
                  {thinkContent && !shouldUseThinkAsExplanation && (
                    <div className="mb-6 rounded-2xl border border-violet-100 overflow-hidden">
                      <button
                        onClick={() => setShowThink(v => !v)}
                        className="w-full flex items-center gap-2 px-4 py-3 bg-violet-50/80 hover:bg-violet-100/70 transition-colors text-left"
                      >
                        <svg
                          className={`w-3.5 h-3.5 text-violet-400 transition-transform duration-200 flex-shrink-0 ${showThink ? 'rotate-90' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="text-[11px] font-black text-violet-500 tracking-wide">
                          {isThinkComplete ? '查看思考过程' : '正在深度思考中...'}
                        </span>
                        {!isThinkComplete && (
                          <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse ml-0.5" />
                        )}
                      </button>
                      {showThink && (
                        <div className="px-5 py-4 bg-violet-50/30 border-t border-violet-100 text-slate-500 text-[13.5px] leading-relaxed whitespace-pre-wrap font-mono">
                          {thinkContent}
                          {!isThinkComplete && (
                            <span className="inline-block w-[2px] h-[1em] bg-violet-400 align-middle ml-0.5 animate-pulse" />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 主解答内容 */}
                  {(shouldUseThinkAsExplanation || mainContent || (!thinkContent && problem.explanation)) ? (
                    <div className="text-slate-700 leading-relaxed math-font whitespace-pre-wrap text-[17px]">
                      {shouldUseThinkAsExplanation && (
                        <div className="mb-4 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-[12px] font-bold text-amber-700">
                          模型未单独输出最终答案，以下展示其完整思路作为解析内容。
                        </div>
                      )}
                      <span dangerouslySetInnerHTML={{ __html: renderMathContent(shouldUseThinkAsExplanation ? thinkContent : (mainContent || problem.explanation)) }} />
                      {isStreaming && mainContent && (
                        <span className="inline-block w-[2px] h-[1.1em] bg-sky-500 align-middle ml-0.5 animate-pulse" />
                      )}
                    </div>
                  ) : (
                    // 全程在 <think> 内，尚未输出正式答案时显示光标
                    isStreaming && !mainContent && thinkContent && !showThink && (
                      <p className="text-[11px] text-violet-400 animate-pulse">思考完毕后将自动展示答案...</p>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
