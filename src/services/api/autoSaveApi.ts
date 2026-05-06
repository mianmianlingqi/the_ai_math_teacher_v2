import toast from 'react-hot-toast';
import { DEFAULT_AUTO_SAVE_SETTINGS, normalizeAutoSaveSettings } from '@/constants';
import { storageService } from '@/services/storage';
import { AutoSaveSettings } from '@/types';

export interface AutoSaveFileEntry {
  name: string;
  timestamp: number;
  size: number;
  reason?: string;
}

export interface AutoSaveRestoreResult {
  success: boolean;
  restored: boolean;
  message: string;
  entry?: AutoSaveFileEntry;
}

interface AutoSaveResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface AutoSavePayload {
  data: Record<string, unknown>;
  maxSaves: number;
  reason?: string;
}

function buildSnapshotData(reason?: string): Record<string, unknown> {
  const raw = storageService.exportAllData();
  const payload = JSON.parse(raw) as Record<string, unknown>;
  payload._autoSaveMeta = {
    reason: reason || '自动保存',
    savedAt: new Date().toISOString(),
  };
  return payload;
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => null) as AutoSaveResponse<T> | null;
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || fallbackMessage);
  }
  return data.data as T;
}

export const autoSaveApi = {
  getSettings(): AutoSaveSettings {
    return normalizeAutoSaveSettings(storageService.getAutoSaveSettings() || DEFAULT_AUTO_SAVE_SETTINGS);
  },

  saveSettings(settings: AutoSaveSettings): AutoSaveSettings {
    const normalized = normalizeAutoSaveSettings(settings);
    storageService.saveAutoSaveSettings(normalized);
    return normalized;
  },

  async triggerSave(reason = '自动保存', settings?: AutoSaveSettings): Promise<AutoSaveFileEntry> {
    const normalized = normalizeAutoSaveSettings(settings || this.getSettings());
    const body: AutoSavePayload = {
      data: buildSnapshotData(reason),
      maxSaves: normalized.maxSaves,
      reason,
    };

    const response = await fetch('/api/autosave/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return parseJsonResponse<AutoSaveFileEntry>(response, '自动保存失败');
  },

  async getSaveList(): Promise<AutoSaveFileEntry[]> {
    const response = await fetch('/api/autosave/list');
    return parseJsonResponse<AutoSaveFileEntry[]>(response, '获取自动存档列表失败');
  },

  async loadSave(name: string, options?: { dispatchEvent?: boolean }): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`/api/autosave/load?name=${encodeURIComponent(name)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null) as AutoSaveResponse<never> | null;
      return { success: false, message: data?.error || '加载自动存档失败' };
    }

    const text = await response.text();
    const result = storageService.importData(text);
    if (result.success && options?.dispatchEvent !== false) {
      window.dispatchEvent(new CustomEvent('data:imported', { detail: { filename: name, source: 'autosave' } }));
    }
    return result;
  },

  async restoreLatestOnStartup(options?: {
    dispatchEvent?: boolean;
    logger?: Pick<Console, 'info' | 'warn'>;
  }): Promise<AutoSaveRestoreResult> {
    const logger = options?.logger || console;

    try {
      const files = await this.getSaveList();
      if (files.length === 0) {
        logger.info?.('[autoSaveApi] 启动恢复已跳过：当前没有可用自动存档。');
        return {
          success: true,
          restored: false,
          message: '当前没有可用自动存档。',
        };
      }

      const [latestSave] = [...files].sort((a, b) => b.timestamp - a.timestamp || a.name.localeCompare(b.name));
      const result = await this.loadSave(latestSave.name, { dispatchEvent: options?.dispatchEvent });
      if (!result.success) {
        throw new Error(result.message || '恢复最新自动存档失败');
      }

      logger.info?.(`[autoSaveApi] 启动时已恢复最新自动存档：${latestSave.name}`);
      return {
        success: true,
        restored: true,
        message: result.message,
        entry: latestSave,
      };
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error('恢复最新自动存档失败');
      logger.warn?.('[autoSaveApi] 启动自动恢复失败', normalizedError);
      return {
        success: false,
        restored: false,
        message: normalizedError.message,
      };
    }
  },

  async deleteSave(name: string): Promise<void> {
    const response = await fetch(`/api/autosave/delete?name=${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    await parseJsonResponse(response, '删除自动存档失败');
  },
};

export function startAutoSaveTimer(options: {
  getSettings: () => AutoSaveSettings;
  onError?: (error: Error) => void;
  onSuccess?: (entry: AutoSaveFileEntry) => void;
  notifyOnError?: boolean;
}): { refresh: () => void; stop: () => void } {
  let timer: number | null = null;
  let running = false;

  const clearCurrentTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNext = () => {
    clearCurrentTimer();
    const settings = normalizeAutoSaveSettings(options.getSettings());
    if (!settings.enabled) return;
    timer = window.setTimeout(async () => {
      if (running) {
        scheduleNext();
        return;
      }
      running = true;
      try {
        const entry = await autoSaveApi.triggerSave('定时自动保存', settings);
        options.onSuccess?.(entry);
      } catch (error: any) {
        const normalizedError = error instanceof Error ? error : new Error(error?.message || '自动保存失败');
        console.error('[autoSaveApi] 自动保存失败', normalizedError);
        options.onError?.(normalizedError);
        if (options.notifyOnError) {
          toast.error(`自动保存失败：${normalizedError.message}`);
        }
      } finally {
        running = false;
        scheduleNext();
      }
    }, settings.intervalSeconds * 1000);
  };

  return {
    refresh: scheduleNext,
    stop: clearCurrentTimer,
  };
}
