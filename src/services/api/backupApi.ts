/**
 * backupService.ts
 *
 * 单一职责：封装所有备份/恢复相关的网络调用与文件操作。
 *
 * Why: 原 App.tsx 直接调用 fetch('/api/save-backup') 等接口，违反"网络调用只在 service 层"原则。
 *      将这些逻辑收拢到此文件后，日后替换 API 路径只需改一处，且可独立 mock 测试。
 */

import { storageService } from '@/services/storage';
import toast from 'react-hot-toast';
import { showConfirm } from './confirmService';

// ===== 类型定义 =====

export interface BackupFile {
  name: string;
  time: number; // Unix 时间戳（毫秒）
}

export interface ImportResult {
  success: boolean;
  message: string;
}

// ===== 工具函数 =====

/**
 * 触发浏览器文件下载。
 *
 * @param content  - 文件内容字符串
 * @param fileName - 下载文件名
 * @param mimeType - MIME 类型
 */
function downloadFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== 导出/导入 API =====

/**
 * 导出全部数据。
 *
 * 数据流：
 * 1. 序列化 localStorage → JSON 字符串
 * 2. 尝试 POST /api/save-backup 保存到服务器
 * 3. 服务器不可用时，回退为浏览器下载
 *
 * @param onMenuClose - 操作完成后关闭数据菜单的回调
 */
export async function exportData(onMenuClose: () => void): Promise<void> {
  const jsonStr = storageService.exportAllData();

  // 1. 尝试服务器端自动保存
  try {
    const response = await fetch('/api/save-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStr,
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        toast.success(`备份成功！文件已自动保存到 backup/${result.filename}`);
        onMenuClose();
        return;
      }
    }
    console.warn('[backupService] 服务器备份返回非成功状态，回退到浏览器下载。');
  } catch (e) {
    console.warn('[backupService] API 备份请求失败，回退到浏览器下载。', e);
  }

  // 2. 回退方案：浏览器下载
  const fileName = `AI数学老师_全部数据_${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(jsonStr, fileName, 'application/json;charset=utf-8');
  onMenuClose();
}

/**
 * 从服务器 backup 文件夹自动恢复最新备份。
 *
 * 数据流：
 * 1. GET /api/list-backups → 获取文件列表（按时间倒序）
 * 2. 用户确认 → GET /api/load-backup?filename=xxx
 * 3. storageService.importData → 写入 localStorage
 * 4. 刷新页面以重新加载所有状态（TODO: 未来用状态管理替代 reload）
 *
 * @param onMenuClose      - 关闭数据菜单
 * @param onFallbackUpload - 服务器不可用时触发手动文件上传
 */
export async function importFromServer(
  onMenuClose: () => void,
  onFallbackUpload: () => void
): Promise<void> {
  try {
    // 1. 获取备份列表
    const listRes = await fetch('/api/list-backups');
    if (!listRes.ok) {
      throw new Error(
        `步骤[获取备份列表]失败，HTTP状态[${listRes.status}]，原因[服务器返回错误]。Hint: 请确认本地 API 服务是否正在运行。`
      );
    }

    const files: BackupFile[] = await listRes.json();
    if (!Array.isArray(files) || files.length === 0) {
      toast.error('未找到服务器端的备份文件。请先执行一次“导出全部数据”以生成备份。');
      return;
    }

    // 2. 确认使用最新文件（服务器端已排序）
    const latestFile = files[0];
    const confirmed = await showConfirm(
      `找到最新备份：${latestFile.name}\n时间：${new Date(latestFile.time).toLocaleString()}\n确定要恢复吗？`
    );
    if (!confirmed) {
      return;
    }

    // 3. 加载内容并导入
    await _restoreFromFilename(latestFile.name);
  } catch (error: any) {
    console.error('[backupService] importFromServer 失败：', error);
    toast.error(`无法自动加载备份，请使用手动上传文件。\n错误：${error.message}`);
    onFallbackUpload();
  } finally {
    onMenuClose();
  }
}

/**
 * 按文件名从服务器恢复指定备份。
 *
 * @param filename     - 备份文件名（不含路径）
 * @param onComplete   - 关闭备份选择器弹窗的回调
 */
export async function restoreByFilename(filename: string, onComplete: () => void): Promise<void> {
  try {
    await _restoreFromFilename(filename);
  } catch (error: any) {
    toast.error(`恢复失败，文件[${filename}]，原因：${error?.message || '未知错误'}。请检查文件是否存在或已损坏。`);
  } finally {
    onComplete();
  }
}

// ===== 内部工具 =====

/**
 * 从服务器加载指定文件名并执行导入（被 importFromServer 和 restoreByFilename 复用）。
 *
 * @param filename - 备份文件名
 * @throws 当网络请求失败或数据格式有误时抛出错误
 */
async function _restoreFromFilename(filename: string): Promise<void> {
  const contentRes = await fetch(`/api/load-backup?filename=${encodeURIComponent(filename)}`);
  if (!contentRes.ok) {
    throw new Error(
      `步骤[读取备份文件]失败，文件名[${filename}]，HTTP状态[${contentRes.status}]。Hint: 请确认文件仍存在于 backup 目录。`
    );
  }

  const text = await contentRes.text();
  const result = storageService.importData(text);

  if (!result.success) {
    throw new Error(
      `步骤[解析导入数据]失败，文件名[${filename}]，原因[${result.message}]。Hint: 该文件可能不是合法的 AI 数学老师备份格式。`
    );
  }

  // 通过自定义事件通知 App 层刷新 React 状态，避免强制刷新页面
  window.dispatchEvent(new CustomEvent('data:imported', { detail: { filename } }));
}
