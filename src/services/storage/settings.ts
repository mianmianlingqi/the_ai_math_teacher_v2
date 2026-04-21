/**
 * settingsStorage.ts
 *
 * 单一职责：AI 供应商配置 + 答疑对话配置 + 视觉识别配置的持久化读写。
 */

import { AIProviderConfig, ChatConfig, VisionConfig } from '@/types';
import {
  PROVIDER_CONFIG_KEY, API_KEYS_STORAGE_KEY,
  DUAL_MODEL_CONFIG_KEY, CHAT_CONFIG_KEY, VISION_CONFIG_KEY,
  safeReadStorage, safeWriteStorage,
} from './core';

export const settingsStorageService = {

  // ===== API Key 管理 =====

  getAPIKey(providerId: string): string {
    const data = safeReadStorage<Record<string, string>>(API_KEYS_STORAGE_KEY, {});
    return data[providerId] || '';
  },

  saveAPIKey(providerId: string, apiKey: string) {
    const keys = safeReadStorage<Record<string, string>>(API_KEYS_STORAGE_KEY, {});
    keys[providerId] = apiKey;
    safeWriteStorage(API_KEYS_STORAGE_KEY, keys);
  },

  // ===== 主模型供应商配置 =====

  getProviderConfig(): AIProviderConfig | null {
    return safeReadStorage<AIProviderConfig | null>(PROVIDER_CONFIG_KEY, null);
  },

  saveProviderConfig(config: AIProviderConfig) {
    if (config.apiKey) this.saveAPIKey(config.id, config.apiKey);
    safeWriteStorage(PROVIDER_CONFIG_KEY, config);
  },

  // ===== 双模型配置 =====

  getDualModelConfig(): { enabled: boolean; provider: AIProviderConfig | null } {
    return safeReadStorage(DUAL_MODEL_CONFIG_KEY, { enabled: false, provider: null });
  },

  saveDualModelConfig(config: { enabled: boolean; provider: AIProviderConfig | null }) {
    if (config.provider?.apiKey) {
      this.saveAPIKey(config.provider.id + '_small', config.provider.apiKey);
    }
    safeWriteStorage(DUAL_MODEL_CONFIG_KEY, config);
  },

  // ===== 答疑对话模型配置 =====

  getChatConfig(): ChatConfig | null {
    return safeReadStorage<ChatConfig | null>(CHAT_CONFIG_KEY, null);
  },

  saveChatConfig(config: ChatConfig) {
    if (config.provider?.apiKey) {
      this.saveAPIKey(config.provider.id + '_chat', config.provider.apiKey);
    }
    safeWriteStorage(CHAT_CONFIG_KEY, config);
  },

  // ===== 视觉识别模型配置 =====

  getVisionConfig(): VisionConfig | null {
    return safeReadStorage<VisionConfig | null>(VISION_CONFIG_KEY, null);
  },

  saveVisionConfig(config: VisionConfig) {
    if (config.provider?.apiKey) {
      this.saveAPIKey(config.provider.id + '_vision', config.provider.apiKey);
    }
    safeWriteStorage(VISION_CONFIG_KEY, config);
  },
};
