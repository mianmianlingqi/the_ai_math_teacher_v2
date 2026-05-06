import { AutoSaveSettings } from '@/types';

export const AUTO_SAVE_MIN_INTERVAL_SECONDS = 30;
export const AUTO_SAVE_MAX_INTERVAL_SECONDS = 3600;
export const AUTO_SAVE_DEFAULT_INTERVAL_SECONDS = 300;

export const AUTO_SAVE_MIN_MAX_SAVES = 1;
export const AUTO_SAVE_MAX_MAX_SAVES = 100;
export const AUTO_SAVE_DEFAULT_MAX_SAVES = 10;

export const DEFAULT_AUTO_SAVE_SETTINGS: AutoSaveSettings = {
  enabled: false,
  maxSaves: AUTO_SAVE_DEFAULT_MAX_SAVES,
  intervalSeconds: AUTO_SAVE_DEFAULT_INTERVAL_SECONDS,
};

export function normalizeAutoSaveSettings(value?: Partial<AutoSaveSettings> | null): AutoSaveSettings {
  const maxSaves = Number.isFinite(value?.maxSaves)
    ? Math.min(AUTO_SAVE_MAX_MAX_SAVES, Math.max(AUTO_SAVE_MIN_MAX_SAVES, Math.floor(value!.maxSaves)))
    : AUTO_SAVE_DEFAULT_MAX_SAVES;

  const intervalSeconds = Number.isFinite(value?.intervalSeconds)
    ? Math.min(AUTO_SAVE_MAX_INTERVAL_SECONDS, Math.max(AUTO_SAVE_MIN_INTERVAL_SECONDS, Math.floor(value!.intervalSeconds)))
    : AUTO_SAVE_DEFAULT_INTERVAL_SECONDS;

  return {
    enabled: Boolean(value?.enabled),
    maxSaves,
    intervalSeconds,
  };
}
