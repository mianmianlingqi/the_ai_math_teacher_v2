
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  QBankItem, QBankFolder, DEFAULT_QBANK_FOLDER_ID, DEFAULT_FOLDER_ID, WrongProblem, WrongProblemFolder,
  Syllabus, Difficulty, QuestionType, QBankSource 
} from '@/types';
import { 
  SYLLABUS_OPTIONS, DIFFICULTY_OPTIONS, QUESTION_TYPE_OPTIONS, DEFAULT_VISION_CONFIG 
} from '@/constants';
import { storageService } from '@/services/storage';
import { folderManagerApi } from '@/services/api/folderApi';
import { SuitDecorations } from '@/components/common/SuitDecorations';
import toast from 'react-hot-toast';
import { showConfirm } from '@/services/api/confirmService';

// ===== 题目编辑器子组件 =====

interface QuestionEditorProps {
  item: QBankItem | null;           // null = 新建
  folderId: string;
  folders: QBankFolder[];
  onSave: (item: QBankItem) => void;
  onBatchSave: (items: QBankItem[]) => void;
  onCancel: () => void;
}

const QuestionEditor: React.FC<QuestionEditorProps> = ({ item, folderId, folders, onSave, onBatchSave, onCancel }) => {
  const [question, setQuestion] = useState(item?.question || '');
  const [options, setOptions] = useState<string[]>(item?.options || []);
  const [answer, setAnswer] = useState(item?.answer || '');
  const [explanation, setExplanation] = useState(item?.explanation || '');
  
  const [difficulty, setDifficulty] = useState<Difficulty | undefined>(item?.difficulty);
  const [syllabus, setSyllabus] = useState<Syllabus | undefined>(item?.syllabus);
  const [questionType, setQuestionType] = useState<QuestionType | undefined>(item?.questionType);

  const [images, setImages] = useState<string[]>(item?.images || []);
  const [tags, setTags] = useState<string[]>(item?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [targetFolderId, setTargetFolderId] = useState(item?.folderId || folderId);
  const [isScanning, setIsScanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenScanInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        if (base64) resolve(base64);
        else reject(new Error(`读取图片失败：${file.name}`));
      };
      reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`));
      reader.readAsDataURL(file);
    });
  };

  const validateScanFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      throw new Error(`文件不是图片：${file.name}`);
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error(`图片过大（超过10MB）：${file.name}`);
    }
  };

  const buildQBankItemFromScan = (result: Partial<QBankItem>, base64: string): QBankItem | null => {
    const questionText = (result.question || '').trim();
    if (!questionText) return null;

    const now = Date.now();
    return {
      id: 'q_' + now + '_' + Math.random().toString(36).slice(2, 8),
      question: questionText,
      options: (result.options || []).map(o => o.trim()).filter(Boolean),
      answer: (result.answer || '').trim(),
      explanation: (result.explanation || '').trim(),
      difficulty: result.difficulty,
      syllabus: result.syllabus,
      questionType: result.questionType,
      images: [base64],
      tags: (result.tags || []).map(t => t.trim()).filter(Boolean),
      folderId: targetFolderId,
      source: 'image_scan',
      sourceNote: result.sourceNote || 'OCR 识别',
      createdAt: now,
      updatedAt: now,
    };
  };

  const scanFileToQuestion = async (file: File): Promise<{ results: Partial<QBankItem>[]; base64: string }> => {
    validateScanFile(file);
    const base64 = await readFileAsBase64(file);

    const visionCfg = storageService.getVisionConfig();
    const visionProvider = visionCfg?.provider || DEFAULT_VISION_CONFIG;
    if (!visionProvider.apiKey && visionProvider.id !== 'ollama') {
      throw new Error('请先在设置中配置视觉识别模型的 API Key');
    }

    const { scanImageWithVisionAPI } = await import('@/services/ai/visionService');
    const results = await scanImageWithVisionAPI(visionProvider, base64);
    return { results, base64 };
  };

  const handleScanFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;

    // 单图：如果只有1道题则填充当前编辑器；若识别到多题则批量入库
    if (files.length === 1) {
      setIsScanning(true);
      try {
        const { results, base64 } = await scanFileToQuestion(files[0]);
        if (!results.length) {
          toast.error('识别失败：未检测到有效题目。');
          return;
        }

        if (results.length === 1) {
          const result = results[0];
          if (result.question) setQuestion(result.question);
          if (result.options) setOptions(result.options);
          if (result.answer) setAnswer(result.answer);
          if (result.explanation) setExplanation(result.explanation);
          if (result.difficulty) setDifficulty(result.difficulty);
          if (result.syllabus) setSyllabus(result.syllabus);
          if (result.questionType) setQuestionType(result.questionType);
          if (result.tags) setTags(prev => [...new Set([...prev, ...(result.tags || [])])]);
          setImages(prev => [...prev, base64]);
          toast.success('识别成功，请校对内容！');
        } else {
          const imported = results
            .map((result, idx) => {
              const itemFromScan = buildQBankItemFromScan(result, base64);
              if (itemFromScan) {
                itemFromScan.sourceNote = `OCR 识别（同图第 ${idx + 1} 题）`;
              }
              return itemFromScan;
            })
            .filter((item): item is QBankItem => !!item);

          if (imported.length > 0) {
            onBatchSave(imported);
            toast.success(`识别到同一张图中的 ${imported.length} 道题，已批量导入题库。`);
            onCancel();
          } else {
            toast.error('识别失败：未生成可保存题目。');
          }
        }
      } catch {
        toast.error('识别失败，请稍后重试或在设置中更换视觉模型。');
      } finally {
        setIsScanning(false);
      }
      return;
    }

    // 多图：批量识别并直接入库
    setIsScanning(true);
    try {
      const imported: QBankItem[] = [];
      let failed = 0;

      for (const file of files) {
        try {
          const { results, base64 } = await scanFileToQuestion(file);
          if (!results.length) {
            failed++;
            continue;
          }

          let addedForCurrentFile = 0;
          results.forEach((result, idx) => {
            const itemFromScan = buildQBankItemFromScan(result, base64);
            if (itemFromScan) {
              itemFromScan.sourceNote = results.length > 1
                ? `OCR 识别（同图第 ${idx + 1} 题）`
                : (itemFromScan.sourceNote || 'OCR 识别');
              imported.push(itemFromScan);
              addedForCurrentFile++;
            }
          });

          if (addedForCurrentFile === 0) failed++;
        } catch {
          failed++;
        }
      }

      if (imported.length > 0) {
        onBatchSave(imported);
        toast.success(`批量识别完成：成功 ${imported.length} 道，失败 ${failed} 道。`);
        onCancel();
      } else {
        toast.error('批量识别失败：没有成功识别出可保存的题目。');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files as FileList) : [];
    await handleScanFiles(files);
    e.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleScanFiles(Array.from(files));
    }
  };

  const handleAddImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file: File) => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > 2 * 1024 * 1024) {
        toast.error(`图片"${file.name}"超过2MB，已跳过。建议压缩后再上传。`);
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

  // 选项管理
  const addOption = () => setOptions([...options, '']);
  const updateOption = (idx: number, val: string) => {
    const newOpts = [...options];
    newOpts[idx] = val;
    setOptions(newOpts);
  };
  const removeOption = (idx: number) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    if (!question.trim()) {
      toast.error('请输入题目内容');
      return;
    }

    const now = Date.now();
    const saved: QBankItem = {
      id: item?.id || ('q_' + now + '_' + Math.random().toString(36).slice(2, 8)),
      question: question.trim(),
      options: options.map(o => o.trim()).filter(o => o), // 移除空选项
      answer: answer.trim(),
      explanation: explanation.trim(),
      difficulty,
      syllabus,
      questionType,
      images,
      tags,
      folderId: targetFolderId,
      source: item?.source || 'manual',
      sourceNote: item?.sourceNote,
      createdAt: item?.createdAt || now,
      updatedAt: now,
    };
    onSave(saved);
  };

  return (
    <div 
      className="relative bg-white rounded-[2rem] border border-slate-200 shadow-xl overflow-hidden flex flex-col w-full max-w-4xl h-[calc(100vh-2rem)] md:h-[calc(100vh-5rem)] animate-scaleIn"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 拖拽悬浮提示层 */}
      {isDragging && (
        <div className="absolute inset-0 z-[60] bg-sky-50/80 backdrop-blur-sm flex items-center justify-center rounded-[2rem] border-[3px] border-dashed border-sky-400 pointer-events-none">
          <div className="flex flex-col items-center gap-3 animate-pulse">
            <svg className="w-16 h-16 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-lg font-bold text-sky-600">松开鼠标，AI 识别题目</p>
            <p className="text-sm text-sky-400">支持 PNG / JPG / JPEG / WEBP 格式图片</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
          {item ? '编辑题目' : '新建题目'}
          {isScanning && (
             <span className="text-xs font-medium text-sky-500 animate-pulse flex items-center gap-1">
               <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
               AI 正在识别图片...
             </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
            {!item && (
                <button 
                  onClick={() => hiddenScanInputRef.current?.click()}
                  disabled={isScanning}
                  className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  拍照/上传识别
                </button>
            )}
            <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        
        {/* Meta Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">所属文件夹</label>
            <select 
              value={targetFolderId}
              onChange={(e) => setTargetFolderId(e.target.value)}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all"
            >
              {folderManagerApi.flattenFolderTree(folders).map(({ folder: f, depth }) => (
                <option key={f.id} value={f.id}>{'　'.repeat(depth)}{depth > 0 ? '└ ' : ''}{f.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
             <select 
                value={syllabus || ''} 
                onChange={e => setSyllabus(e.target.value as Syllabus)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
              >
                <option value="">选择大纲...</option>
                {SYLLABUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select 
                value={difficulty || ''} 
                onChange={e => setDifficulty(e.target.value as Difficulty)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
              >
                <option value="">选择难度...</option>
                {DIFFICULTY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select 
                value={questionType || ''} 
                onChange={e => setQuestionType(e.target.value as QuestionType)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
              >
                <option value="">选择题型...</option>
                {QUESTION_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
          </div>
        </div>

        {/* Question Content */}
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">题目内容 (支持 LaTeX)</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="输入题目描述... (公式请用 $...$ 或 $$...$$ 包裹)"
            className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 placeholder-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all resize-none font-mono text-sm leading-relaxed"
          />
        </div>

        {/* Options (if Choice) */}
        <div className="space-y-3">
            <div className="flex justify-between items-end">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                    选项 (选择题必填)
                </label>
                <button 
                  onClick={addOption}
                  className="text-xs font-bold text-sky-500 hover:text-sky-600"
                >
                    + 添加选项
                </button>
            </div>
            {options.map((opt, idx) => (
                <div key={idx} className="flex gap-2">
                    <span className="flex items-center justify-center w-8 h-10 border border-slate-200 bg-slate-50 rounded-lg text-slate-400 font-bold text-sm">
                        {String.fromCharCode(65 + idx)}
                    </span>
                    <input
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                        placeholder={`选项 ${String.fromCharCode(65 + idx)}`}
                    />
                    <button onClick={() => removeOption(idx)} className="text-slate-400 hover:text-rose-500 p-2">
                        &times;
                    </button>
                </div>
            ))}
        </div>

        {/* Answer & Explanation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">答案</label>
                <textarea
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                    placeholder="输入正确答案..."
                />
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">解析</label>
                <textarea
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                    className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                    placeholder="输入详细解析..."
                />
            </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">标签</label>
          <div className="flex flex-wrap gap-2 mb-2 p-3 bg-slate-50 rounded-xl border border-slate-200 min-h-[3rem]">
            {tags.map(tag => (
              <span key={tag} className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 flex items-center gap-1">
                #{tag}
                <button onClick={() => handleRemoveTag(tag)} className="hover:text-rose-500 ml-1">×</button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              className="flex-1 bg-transparent border-none outline-none text-sm min-w-[60px]"
              placeholder={tags.length === 0 ? "输入标签按回车..." : ""}
            />
          </div>
        </div>

        {/* Images */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">图片附件</label>
            <button onClick={handleAddImage} className="text-xs font-bold text-sky-500 hover:text-sky-600 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              添加图片
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
          </div>
          {/* Scan Button (Hidden/Helper logic only if needed inside editor, but main entry should be outside maybe?) 
              Actually, let's add a "Smart Scan" button HERE too to overwrite content
          */}
          <input 
            type="file" 
            accept="image/*" 
            multiple
            className="hidden" 
            ref={hiddenScanInputRef}
            onChange={handleScanImage}
          />
          {images.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {images.map((img, idx) => (
                <div key={idx} className="relative group aspect-square bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                  <img src={img} alt={`attachment-${idx}`} className="w-full h-full object-cover" />
                  <button onClick={() => handleRemoveImage(idx)} className="absolute top-2 right-2 p-1 bg-white/90 rounded-full text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 py-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
        <button onClick={onCancel} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all">
          取消
        </button>
        <button onClick={handleSave} className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold shadow-lg shadow-slate-200 hover:shadow-xl hover:bg-slate-800 transform hover:-translate-y-0.5 transition-all">
          保存题目
        </button>
      </div>
    </div>
  );
};

// ===== 主组件 =====

export const QuestionBank: React.FC = () => {
  const QBANK_WRONG_PREFIX = 'wp_qbank_';
    const [folders, setFolders] = useState<QBankFolder[]>([]);
  const [wrongFolders, setWrongFolders] = useState<WrongProblemFolder[]>([]);
    const [items, setItems] = useState<QBankItem[]>([]); // All items
  const [collectedFromQBankIds, setCollectedFromQBankIds] = useState<Set<string>>(new Set());
  const [collectingItem, setCollectingItem] = useState<QBankItem | null>(null);
  const [targetWrongFolderId, setTargetWrongFolderId] = useState<string>(DEFAULT_FOLDER_ID);
    const [collectFolderCurrentId, setCollectFolderCurrentId] = useState<string | undefined>(undefined);
    const [collectFolderSearch, setCollectFolderSearch] = useState('');
    const [activeFolderId, setActiveFolderId] = useState<string>(DEFAULT_QBANK_FOLDER_ID);
    const [editingItem, setEditingItem] = useState<QBankItem | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [showFolderInput, setShowFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [activeFilterTag, setActiveFilterTag] = useState<string | null>(null);
    const newFolderInputRef = useRef<HTMLInputElement>(null);

    const renderGlobalModal = (node: React.ReactNode) => {
      if (typeof document === 'undefined') return null;
      return createPortal(node, document.body);
    };

    const loadData = () => {
        setFolders(folderManagerApi.getFolders('qbank') as QBankFolder[]);
        setWrongFolders(folderManagerApi.getFolders('wrong') as WrongProblemFolder[]);
        setItems(storageService.getQBankItems());
        const collectedIds = storageService
          .getWrongProblems()
          .filter(p => p.id.startsWith(QBANK_WRONG_PREFIX))
          .map(p => p.id.replace(QBANK_WRONG_PREFIX, ''));
        setCollectedFromQBankIds(new Set(collectedIds));
    };

    useEffect(() => { loadData(); }, []);

    useEffect(() => {
        if(showFolderInput) newFolderInputRef.current?.focus();
    }, [showFolderInput]);

    // Derived state
    const folderItems = items.filter(i => i.folderId === activeFolderId);
    // Sort by updated time desc
    folderItems.sort((a,b) => b.updatedAt - a.updatedAt);
    const globalFolderStats = folderManagerApi.getFolderStats('qbank');
    const childFolders = folderManagerApi.getChildFolders(folders, activeFolderId);
    const breadcrumbPath = folderManagerApi.getFolderPath(folders, activeFolderId).filter(f => f.id !== DEFAULT_QBANK_FOLDER_ID);

    // Build tag stats from items in current folder
    const tagStats: Record<string, number> = {};
    folderItems.forEach(item => {
      const tags: string[] = [];
      if (item.syllabus) tags.push(item.syllabus);
      if (item.difficulty) tags.push(item.difficulty);
      if (item.questionType) tags.push(item.questionType);
      tags.forEach(t => { tagStats[t] = (tagStats[t] || 0) + 1; });
    });
    const tagTypes = Object.keys(tagStats);

    const filteredItems = activeFilterTag
      ? folderItems.filter(item => item.syllabus === activeFilterTag || item.difficulty === activeFilterTag || item.questionType === activeFilterTag)
      : folderItems;
    const collectModalChildFolders = folderManagerApi.getChildFolders(wrongFolders, collectFolderCurrentId).filter(folder =>
      !collectFolderSearch.trim() || folder.name.toLowerCase().includes(collectFolderSearch.trim().toLowerCase())
    );
    const collectModalBreadcrumb = collectFolderCurrentId
      ? folderManagerApi.getFolderPath(wrongFolders, collectFolderCurrentId).filter(folder => folder.id !== DEFAULT_FOLDER_ID)
      : [];
    const currentCollectFolderTargetId = collectFolderCurrentId || DEFAULT_FOLDER_ID;
    const currentCollectFolderName = collectFolderCurrentId
      ? (wrongFolders.find(folder => folder.id === collectFolderCurrentId)?.name || '当前目录')
      : '根目录';
    const selectedWrongFolderName = wrongFolders.find(folder => folder.id === targetWrongFolderId)?.name || '根目录';

    const handleCreateFolder = () => {
        if(!newFolderName.trim()) return;
      folderManagerApi.addFolder('qbank', newFolderName.trim(), activeFolderId);
        setNewFolderName('');
        setShowFolderInput(false);
        loadData();
    };

    const handleDeleteFolder = async (id: string): Promise<void> => {
        if(id === DEFAULT_QBANK_FOLDER_ID) return;
        const folder = folders.find(f => f.id === id);
      const childCount = folderManagerApi.getChildFolders(folders, id).length;
      const descendants = folderManagerApi.getAllDescendantFolderIds(folders, id);
        const count = globalFolderStats[id] || 0;
        let msg = `确定删除文件夹"${folder?.name}"吗？`;
        if (count > 0) msg += `\n其中 ${count} 道题目将被移至上级文件夹。`;
        if (childCount > 0) msg += `\n其中 ${childCount} 个子文件夹将被移至上级。`;
        if(!(await showConfirm(msg))) return;
      folderManagerApi.removeFolder('qbank', id);
        if(activeFolderId === id || descendants.includes(activeFolderId)) {
            setActiveFolderId(folder?.parentId || DEFAULT_QBANK_FOLDER_ID);
            setActiveFilterTag(null);
        }
        loadData();
    };

    const handleStartRename = (folder: QBankFolder) => {
        if (folder.id === DEFAULT_QBANK_FOLDER_ID) return;
        setRenamingFolderId(folder.id);
        setRenameValue(folder.name);
    };

    const handleRename = () => {
        if (renamingFolderId && renameValue.trim()) {
        folderManagerApi.renameFolder('qbank', renamingFolderId, renameValue.trim());
            setRenamingFolderId(null);
            setRenameValue('');
            loadData();
        }
    };

    const handleSaveItem = (item: QBankItem) => {
        storageService.saveQBankItem(item);
        setEditingItem(null);
        setIsCreating(false);
        loadData();
    };

    const handleBatchSaveItems = (newItems: QBankItem[]) => {
      if (!newItems.length) return;
      newItems.forEach((item) => storageService.saveQBankItem(item));
      setEditingItem(null);
      setIsCreating(false);
      loadData();
    };

    const handleDeleteItem = async (id: string): Promise<void> => {
        if(!(await showConfirm('确定删除该题目吗？'))) return;
        storageService.removeQBankItem(id);
        loadData();
    };

    const handleCollectToWrongBook = (item: QBankItem, targetFolderId: string) => {
      const wrongId = `${QBANK_WRONG_PREFIX}${item.id}`;
      const now = Date.now();
      const sourceFolderName = folders.find(f => f.id === item.folderId)?.name || '根目录';
      const targetFolderName = wrongFolders.find(f => f.id === targetFolderId)?.name || '根目录';
      const wrongProblem: WrongProblem = {
        id: wrongId,
        question: item.question,
        options: item.options || [],
        answer: item.answer || '待补充',
        explanation: item.explanation || '',
        difficulty: item.difficulty || Difficulty.MEDIUM,
        syllabus: item.syllabus || Syllabus.UNDERGRADUATE_TRANSITION,
        questionType: item.questionType || QuestionType.CALCULATION,
        suggestedErrorTypes: [],
        addedAt: now,
        errorType: '题库收藏',
        folderId: targetFolderId,
        userNote: `来源题库文件夹：${sourceFolderName}`,
      };

      storageService.addWrongProblem(wrongProblem);
      setCollectedFromQBankIds(prev => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
        setCollectingItem(null);
        toast.success(collectedFromQBankIds.has(item.id)
          ? `已更新该题在错题本中的收藏位置（${targetFolderName}）。`
          : `已收藏到错题本（${targetFolderName}）。`);
    };

    const handleToggleCollect = async (item: QBankItem) => {
      const wrongId = `${QBANK_WRONG_PREFIX}${item.id}`;
      if (collectedFromQBankIds.has(item.id)) {
        if (!(await showConfirm('确定取消收藏该题吗？取消后将从错题本移除。'))) return;
        storageService.removeWrongProblem(wrongId);
        setCollectedFromQBankIds(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        toast.success('已取消收藏。');
        return;
      }

      setTargetWrongFolderId(DEFAULT_FOLDER_ID);
      setCollectFolderCurrentId(undefined);
      setCollectFolderSearch('');
      setCollectingItem(item);
    };
    
    // Render helper for LaTeX
    const renderMath = (text: string, maxLen?: number) => {
        if (!text) return '';
        const katex = (window as any).katex;
        let display = maxLen && text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
        if (!katex) return display;

        // 统一定界符
        let processed = display.replace(/\\\[([\s\S]+?)\\\]/g, '$$$$$1$$$$');
        processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, '$$$1$$');

        const parts = processed.split(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g);
        return parts.map((part) => {
            try {
                if (part.startsWith('$$') && part.endsWith('$$')) {
                    return `<span class="katex-display">${katex.renderToString(part.slice(2, -2).trim(), { displayMode: true, throwOnError: false })}</span>`;
                } else if (part.startsWith('$') && part.endsWith('$')) {
                    return katex.renderToString(part.slice(1, -1).trim(), { displayMode: false, throwOnError: false });
                }
                return part;
            } catch { return part; }
        }).join('');
    };

    return (
        <div className="space-y-6 animate-slideUp">
            {/* Top action bar */}
            <div className="flex justify-between items-center bg-white px-8 py-4 rounded-[1.5rem] border border-slate-200 shadow-sm animate-slideUp hover-float-3d relative overflow-hidden" style={{animationDelay:'0.05s'}} data-help="【新手引导① 题库管理】先新建题目，再按文件夹与标签整理，后续查找和组卷会更高效。">
                <SuitDecorations variant="corner" />
                <div className="flex items-center gap-3 relative z-[1]">
                    <div className="w-2 h-6 bg-indigo-500 rounded-full animate-breathe"></div>
                    <h2 className="text-lg font-black text-slate-800">题库管理</h2>
                </div>
                <button 
                    onClick={() => setIsCreating(true)}
                    data-help="点击开始录题：支持手动输入或拍照识别。保存前建议先检查题干、答案和解析。"
                    className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-lg shadow-slate-200 transition-all flex items-center gap-2 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 mr-14"
                >
                    <span>+</span> 新建题目
                </button>
            </div>

            {/* Folder area */}
            <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden hover-float-3d relative" data-help="【新手引导② 分类文件夹】这里是题目的文件柜。建议按章节或题型建立层级文件夹，便于长期管理。">
                <SuitDecorations variant="corner" />
                <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between relative z-[1]">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="text-sm font-black text-slate-700">分类文件夹</span>
                    </div>
                    <button
                      onClick={() => setShowFolderInput(true)}
                      data-help="在当前目录新建子文件夹。建议命名清晰（如“导数-计算题”），后续定位更快。"
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
                            onClick={() => { setActiveFolderId(DEFAULT_QBANK_FOLDER_ID); setActiveFilterTag(null); }}
                            data-help="返回根目录并清除当前筛选，适合重新浏览全部题目。"
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
                                    onClick={() => { setActiveFolderId(crumb.id); setActiveFilterTag(null); }}
                                    data-help="点击可跳回该层级文件夹，并清除当前标签筛选。"
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
                        const isRenaming = renamingFolderId === folder.id;

                        return (
                            <div
                                key={folder.id}
                                className="group relative flex items-center gap-2.5 px-5 py-3 rounded-2xl border-2 cursor-pointer transition-all duration-200 bg-white border-slate-100 text-slate-600 hover:border-amber-200 hover:bg-amber-50/30"
                                onClick={() => {
                                    if (!isRenaming) {
                                        setActiveFolderId(folder.id);
                                        setActiveFilterTag(null);
                                    }
                                }}
                            >
                                <svg className="w-5 h-5 transition-colors text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                </svg>

                                {isRenaming ? (
                                    <input
                                        autoFocus
                                        className="text-sm font-bold bg-transparent outline-none border-b-2 border-amber-400 w-24"
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
                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-500" title={`${subCount} 个子文件夹`}>
                                            <svg className="w-2.5 h-2.5 inline mr-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
                                            {subCount}
                                        </span>
                                    )}
                                </div>

                                {folder.id !== DEFAULT_QBANK_FOLDER_ID && !isRenaming && (
                                    <div className="flex items-center gap-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleStartRename(folder); }}
                                            className="w-6 h-6 flex items-center justify-center rounded-lg text-amber-400 hover:bg-amber-100 hover:text-amber-600 transition-all"
                                            title="重命名"
                                        >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                                            className="w-6 h-6 flex items-center justify-center rounded-lg text-amber-400 hover:bg-rose-100 hover:text-rose-600 transition-all"
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

                    {showFolderInput && (
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
                                    if (e.key === 'Escape') { setShowFolderInput(false); setNewFolderName(''); }
                                }}
                            />
                            <button
                                onClick={handleCreateFolder}
                                data-help="确认创建文件夹。创建后可以马上进入该文件夹继续整理。"
                                className="w-7 h-7 flex items-center justify-center rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-all shadow-sm active:scale-90"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            </button>
                            <button
                                onClick={() => { setShowFolderInput(false); setNewFolderName(''); }}
                                data-help="取消本次创建，不会保存这个文件夹名。"
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    )}

                    {childFolders.length === 0 && !showFolderInput && (
                        <div className="text-xs font-medium text-slate-300 py-2 px-4">当前文件夹内无子文件夹</div>
                    )}
                </div>
            </div>

            {/* Tag filter section */}
            {folderItems.length > 0 && (
                <div className="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden hover-float-3d relative" data-help="【新手引导③ 题目分类筛选】先进入目标文件夹，再按标签筛选；需要恢复全量时点击“全部”。">
                    <SuitDecorations variant="corner" />
                    <div className="px-8 py-4 border-b border-slate-100 flex items-center gap-2">
                        <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        <span className="text-sm font-black text-slate-700">
                            {folders.find(f => f.id === activeFolderId)?.name}  题目分类
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 ml-1">({folderItems.length} 道题目)</span>
                    </div>

                    <div className="p-4 flex flex-wrap gap-2">
                        <button
                            onClick={() => setActiveFilterTag(null)}
                            data-help="显示当前文件夹的全部题目。找不到题时，先点这里恢复全量。"
                            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                                activeFilterTag === null
                                    ? 'bg-sky-600 text-white shadow-lg shadow-sky-100'
                                    : 'bg-slate-50 text-slate-500 hover:bg-sky-50 hover:text-sky-600 border border-slate-100'
                            }`}
                        >
                            全部 ({folderItems.length})
                        </button>

                        {tagTypes.map(type => (
                            <button
                                key={type}
                                onClick={() => setActiveFilterTag(activeFilterTag === type ? null : type)}
                                data-help="只看这个标签的题目；再点一次可取消。"
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                                    activeFilterTag === type
                                        ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-100'
                                        : 'bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-100'
                                }`}
                            >
                                {type} ({tagStats[type]})
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {folderItems.length === 0 && (
                <div className="bg-indigo-50 border border-indigo-100 p-8 rounded-3xl flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                        <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                    </div>
                    <h4 className="text-lg font-black text-indigo-900 mb-2">
                        「{folders.find(f => f.id === activeFolderId)?.name}」文件夹暂无题目
                    </h4>
                    <p className="text-xs font-bold text-indigo-700 max-w-sm leading-relaxed">
                        点击右上角"新建题目"添加手动录入或 AI 识别题目，也可通过顶部「数据」按钮导入备份。
                    </p>
                    <button onClick={() => setIsCreating(true)} className="mt-4 px-5 py-2 bg-indigo-500 text-white rounded-xl text-sm font-bold hover:bg-indigo-600 transition-all shadow-md">
                        去创建一道
                    </button>
                </div>
            )}

            {/* Problem list */}
            {filteredItems.length > 0 && (
                <div className="space-y-6" data-help="【新手引导④ 题目列表】这里展示当前目录（或筛选后）的题目，可编辑、收藏到错题本或删除。">
                    <div className="flex items-center gap-2 px-1">
                        <div className="w-1.5 h-6 bg-indigo-500 rounded-full"></div>
                        <h3 className="text-lg font-black text-slate-800">
                            {activeFilterTag
                                ? `"${activeFilterTag}" 分类下的题目`
                                : `${folders.find(f => f.id === activeFolderId)?.name} 中的全部题目`
                            }
                        </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        {filteredItems.map((item, idx) => {
                            const isExpanded = expandedItems.has(item.id);
                            const needsExpand =
                              (item.options && item.options.length > 0) ||
                              !!item.answer ||
                              !!item.explanation ||
                              (item.images && item.images.length > 0);
                            return (
                            <div key={item.id} className="group bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover-float-3d transition-all relative overflow-hidden">
                                <SuitDecorations variant="corner" />
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex gap-2 mb-2">
                                        {item.syllabus && <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-md">{item.syllabus}</span>}
                                        {item.difficulty && <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-md">{item.difficulty}</span>}
                                        {item.questionType && <span className="text-[10px] font-black bg-sky-50 text-sky-600 px-2 py-1 rounded-md">{item.questionType}</span>}
                                    </div>
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => setEditingItem(item)} data-help="编辑这道题：可改题干、答案、标签，还能调整到别的文件夹。" className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                        </button>
                                        <button
                                          onClick={() => handleToggleCollect(item)}
                                          data-help={collectedFromQBankIds.has(item.id) ? '该题已收藏到错题本。再次点击可取消收藏。' : '收藏该题到错题本。点击后可选择存放文件夹。'}
                                        className={`p-2 rounded-lg transition-all ${collectedFromQBankIds.has(item.id) ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'}`}
                                          title={collectedFromQBankIds.has(item.id) ? '已收藏（点击取消）' : '收藏至错题'}
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
                                        </svg>
                                      </button>
                                        <button onClick={() => handleDeleteItem(item.id)} data-help="删除这道题（删除后不可恢复）。不确定时先不要删。" className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                
                                {/* 题目内容 */}
                                <div 
                                  className="text-slate-800 font-medium mb-2 text-sm leading-relaxed math-font"
                                  dangerouslySetInnerHTML={{ __html: renderMath(item.question) }}
                                />

                                {/* 展开后显示答案和解析 */}
                                {isExpanded && (
                                    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 animate-fadeIn">
                                        {/* 选项 */}
                                        {item.options && item.options.length > 0 && (
                                            <div className="space-y-2">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">选项</span>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    {item.options.map((opt, oi) => (
                                                        <div key={oi} className="flex items-start gap-2 px-3 py-2 bg-white rounded-xl border border-slate-100">
                                                            <span className="text-xs font-black text-slate-400 mt-0.5">{String.fromCharCode(65 + oi)}.</span>
                                                            <span className="text-sm text-slate-700 math-font" dangerouslySetInnerHTML={{ __html: renderMath(opt) }} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* 答案 */}
                                        {item.answer && (
                                            <div>
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">答案</span>
                                                <div className="mt-1 px-4 py-3 bg-emerald-50/50 rounded-xl border border-emerald-100">
                                                    <div className="text-sm font-bold text-emerald-800 math-font" dangerouslySetInnerHTML={{ __html: renderMath(item.answer) }} />
                                                </div>
                                            </div>
                                        )}

                                        {/* 解析 */}
                                        {item.explanation && (
                                            <div>
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">解析</span>
                                                <div className="mt-1 px-4 py-3 bg-sky-50/50 rounded-xl border border-sky-100">
                                                    <div className="text-sm text-slate-700 leading-relaxed math-font whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderMath(item.explanation) }} />
                                                </div>
                                            </div>
                                        )}

                                        {/* 图片附件 */}
                                        {item.images && item.images.length > 0 && (
                                            <div>
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">图片附件</span>
                                                <div className="mt-1 grid grid-cols-3 md:grid-cols-4 gap-2">
                                                    {item.images.map((img, ii) => (
                                                        <div key={ii} className="aspect-square bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                                                            <img src={img} alt={`img-${ii}`} className="w-full h-full object-cover" />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 底部信息 + 展开按钮 */}
                                <div className="flex items-center justify-between mt-2">
                                    <div className="flex items-center gap-4 text-xs text-slate-400">
                                        <span>Updated: {new Date(item.updatedAt).toLocaleDateString()}</span>
                                        {item.source && (
                                            <span className="flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                                                {item.source === 'manual' ? '手动录入' : item.source === 'ai' ? 'AI 生成' : '错题本'}
                                            </span>
                                        )}
                                        {item.tags.length > 0 && (
                                            <div className="flex gap-1">
                                                {item.tags.map(t => <span key={t} className="text-slate-500">#{t}</span>)}
                                            </div>
                                        )}
                                    </div>
                                    {needsExpand && (
                                        <button
                                            onClick={() => setExpandedItems(prev => {
                                                const next = new Set(prev);
                                                if (next.has(item.id)) next.delete(item.id);
                                                else next.add(item.id);
                                                return next;
                                            })}
                                            className="text-xs font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-indigo-50 mr-16"
                                        >
                                            {isExpanded ? (
                                                <>
                                                    收起
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                                                </>
                                            ) : (
                                                <>
                                                    展开
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Editor Modal */}
            {(isCreating || editingItem) && renderGlobalModal(
                <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm p-4 md:p-10 flex items-center justify-center">
                    <QuestionEditor 
                        item={editingItem} 
                        folderId={activeFolderId}
                        folders={folders}
                        onSave={handleSaveItem}
                        onBatchSave={handleBatchSaveItems}
                        onCancel={() => {
                            setEditingItem(null);
                            setIsCreating(false);
                        }}
                    />
                </div>
                    )}

            {collectingItem && renderGlobalModal(
              <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm p-4 flex items-center justify-center">
                <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden animate-scaleIn">
                        <div className="px-6 py-5 border-b border-slate-100">
                            <h3 className="text-base font-black text-slate-800">收藏到错题本</h3>
                            <p className="mt-1 text-xs text-slate-500 font-medium">请选择要存放的错题文件夹</p>
                        </div>
                        <div className="px-6 py-5 space-y-3">
                            <div className="relative">
                              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                              <input
                                type="text"
                                value={collectFolderSearch}
                                onChange={(e) => setCollectFolderSearch(e.target.value)}
                                placeholder="搜索文件夹..."
                                className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 placeholder:text-slate-300"
                              />
                            </div>

                            {collectFolderCurrentId && (
                              <div className="flex items-center gap-1 text-[11px] font-bold flex-wrap">
                                <button
                                  onClick={() => setCollectFolderCurrentId(undefined)}
                                  className="text-slate-400 hover:text-amber-600 transition-colors flex items-center gap-0.5"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" /></svg>
                                  根目录
                                </button>
                                {collectModalBreadcrumb.map((folder) => (
                                  <React.Fragment key={folder.id}>
                                    <svg className="w-3 h-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                                    <button
                                      onClick={() => setCollectFolderCurrentId(folder.id)}
                                      className={`truncate max-w-[96px] transition-colors ${folder.id === collectFolderCurrentId ? 'text-amber-600' : 'text-slate-400 hover:text-amber-600'}`}
                                    >
                                      {folder.name}
                                    </button>
                                  </React.Fragment>
                                ))}
                              </div>
                            )}

                            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                              <div className={`flex items-center gap-2 p-2.5 rounded-xl border ${targetWrongFolderId === currentCollectFolderTargetId ? 'border-amber-300 bg-amber-50/70' : 'border-slate-200 bg-white'}`}>
                                <button
                                  onClick={() => { if (collectFolderCurrentId) setCollectFolderCurrentId(undefined); }}
                                  className="flex-1 text-left min-w-0 flex items-center gap-2.5"
                                >
                                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center flex-shrink-0">
                                    {collectFolderCurrentId ? (
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                                    ) : (
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" /></svg>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-[12px] font-black text-slate-700 truncate">{currentCollectFolderName}</div>
                                    <div className="text-[10px] text-slate-400 font-bold">当前目录</div>
                                  </div>
                                </button>
                                <button
                                  onClick={() => setTargetWrongFolderId(currentCollectFolderTargetId)}
                                  className={`px-3 py-1.5 text-[11px] font-black rounded-xl border transition-all ${targetWrongFolderId === currentCollectFolderTargetId ? 'border-amber-300 bg-amber-500 text-white' : 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                                >
                                  {targetWrongFolderId === currentCollectFolderTargetId ? '已选' : '选择'}
                                </button>
                              </div>

                              {collectModalChildFolders.map(folder => {
                                const count = folderManagerApi.getItemCountByFolder('wrong', folder.id);
                                const subCount = folderManagerApi.getChildFolders(wrongFolders, folder.id).length;
                                const isSelected = targetWrongFolderId === folder.id;
                                return (
                                  <div
                                    key={folder.id}
                                    className={`relative ml-5 w-[calc(100%-1.25rem)] flex items-center gap-2 p-2.5 rounded-xl border transition-all ${isSelected ? 'border-amber-300 bg-amber-50/70' : 'border-slate-200 bg-white hover:border-amber-200 hover:bg-amber-50/30'}`}
                                  >
                                    <div className="absolute -left-3 top-1/2 -translate-y-1/2 text-slate-300">↳</div>
                                    <button
                                      onClick={() => setCollectFolderCurrentId(folder.id)}
                                      className="flex-1 text-left min-w-0"
                                    >
                                      <div className="text-[13px] font-black text-slate-700 truncate">{folder.name}</div>
                                      <div className="text-[11px] text-slate-400 font-semibold">{count} 项{subCount > 0 ? ` · ${subCount} 个子文件夹` : ''}</div>
                                    </button>
                                    <button
                                      onClick={() => setTargetWrongFolderId(folder.id)}
                                      className={`px-3 py-1.5 text-[11px] font-black rounded-xl border transition-all ${isSelected ? 'border-amber-300 bg-amber-500 text-white' : 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
                                    >
                                      {isSelected ? '已选' : '选择'}
                                    </button>
                                  </div>
                                );
                              })}
                              {collectModalChildFolders.length === 0 && (
                                <div className="text-center text-xs text-slate-400 font-semibold py-4">当前目录下没有匹配的子文件夹</div>
                              )}
                            </div>

                            <div className="text-xs text-slate-500 font-semibold leading-relaxed">
                              当前选择：<span className="text-amber-600">{selectedWrongFolderName}</span>。题目将按“题库收藏”分类保存，可在错题本中继续修改分类与备注。
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
                            <button
                              onClick={() => setCollectingItem(null)}
                              className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-200 transition-all"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => collectingItem && handleCollectToWrongBook(collectingItem, targetWrongFolderId)}
                              className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 transition-all shadow-lg shadow-amber-100"
                            >
                              确认收藏
                            </button>
                        </div>
                    </div>
                  </div>
                )}
        </div>
    );
};
