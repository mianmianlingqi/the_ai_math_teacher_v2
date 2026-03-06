import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { showConfirm } from '@/services/api/confirmService';

interface BackupFile {
  name: string;
  time: string;
  size: number;
}

interface BackupManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onRestore: (filename: string) => void;
}

export const BackupManager: React.FC<BackupManagerProps> = ({ isOpen, onClose, onRestore }) => {
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  useEffect(() => {
    if (isOpen) {
      loadFiles();
      setCurrentPage(1);
    }
  }, [isOpen]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, pageSize]);

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/list-backups');
      if (!res.ok) throw new Error('无法连接备份服务');
      const data = await res.json();
      setFiles(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  };

  const filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedFiles = filteredFiles.slice(startIndex, startIndex + pageSize);

  const handleDelete = async (filename: string) => {
    const confirmed = await showConfirm(`确定要删除备份 "${filename}" 吗？\n删除后将无法恢复。`);
    if (!confirmed) {
      return;
    }

    setBusyFile(filename);
    try {
      const res = await fetch(`/api/delete-backup?filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result?.error || '删除失败');
      }
      setFiles(prev => prev.filter(file => file.name !== filename));
    } catch (err: any) {
      toast.error('删除失败：' + (err?.message || '未知错误'));
    } finally {
      setBusyFile(null);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={handleOverlayClick}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-scaleIn ring-1 ring-gray-900/5 dark:ring-white/10">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="text-xl">📦</span>
            备份管理（{files.length}）
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={loadFiles}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              title="刷新备份列表"
            >
              刷新
            </button>
            <button 
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="mb-3 flex items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索备份文件名..."
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
            />
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2 py-2 rounded-lg border border-gray-200 bg-white text-xs text-gray-600"
              title="每页条数"
            >
              <option value={4}>4/页</option>
              <option value={6}>6/页</option>
              <option value={8}>8/页</option>
            </select>
            <button
              onClick={() => files[0] && onRestore(files[0].name)}
              disabled={files.length === 0}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              title="恢复最新备份"
            >
              恢复最新
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
              <p>加载备份列表中...</p>
            </div>
          ) : error ? (
             <div className="text-center py-8 text-red-500">
               <p className="mb-2 text-3xl">⚠️</p>
               <p>{error}</p>
               <button onClick={loadFiles} className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm text-gray-700">重试</button>
             </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <p className="text-4xl mb-4">📭</p>
              <p>{files.length === 0 ? '当前没有找到任何本地备份' : '没有匹配的备份文件'}</p>
              <p className="text-sm mt-2 opacity-70">点击 "导出全部数据" 即可创建备份</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {pagedFiles.map((file, idx) => (
                <div 
                  key={file.name} 
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-700 transition-all group"
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs shrink-0">
                      {startIndex + idx === 0 ? '🆕' : '📄'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-[13px] text-gray-900 dark:text-gray-100 truncate pr-2" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {new Date(file.time).toLocaleString()} · {formatSize(file.size)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        const confirmed = await showConfirm(`确定要恢复备份 "${file.name}" 吗？\n当前未保存的进度将会丢失。`);
                        if (confirmed) {
                          onRestore(file.name);
                        }
                      }}
                      className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-blue-500 hover:text-white hover:border-blue-500 dark:hover:bg-blue-600 transition-all text-xs font-medium shadow-sm active:scale-95"
                    >
                      恢复
                    </button>
                    <button
                      onClick={() => handleDelete(file.name)}
                      disabled={busyFile === file.name}
                      className="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all text-xs font-medium shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {busyFile === file.name ? '删除中' : '删除'}
                    </button>
                  </div>
                </div>
              ))}

              {filteredFiles.length > pageSize && (
                <div className="pt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>第 {safePage}/{totalPages} 页 · 共 {filteredFiles.length} 条</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={safePage <= 1}
                      className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={safePage >= totalPages}
                      className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 text-center">
             备份文件存储在项目根目录的 <code className="bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded">backup/</code> 文件夹中
        </div>
      </div>
    </div>,
    document.body
  );
};
