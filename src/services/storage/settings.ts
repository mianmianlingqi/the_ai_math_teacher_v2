/**
 * settingsStorage.ts
 *
 * 单一职责：AI 供应商配置 + 答疑对话配置 + 视觉识别配置的持久化读写。
 */

import { AIProviderConfig, ChatConfig, VisionConfig } from '@/types';
import {
  PROVIDER_CONFIG_KEY, API_KEYS_STORAGE_KEY,
  DUAL_MODEL_CONFIG_KEY, CHAT_CONFIG_KEY, VISION_CONFIG_KEY,
} from './core';

export const settingsStorageService = {

  // ===== API Key 管理 =====

  getAPIKey(providerId: string): string {
    try {
      const data = localStorage.getItem(API_KEYS_STORAGE_KEY);
      if (!data) return '';
      return JSON.parse(data)[providerId] || '';
    } catch { return ''; }
  },

  saveAPIKey(providerId: string, apiKey: string) {
    try {
      const data = localStorage.getItem(API_KEYS_STORAGE_KEY);
      const keys = data ? JSON.parse(data) : {};
      keys[providerId] = apiKey;
      localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
    } catch { /* ignore */ }
  },

  // ===== 主模型供应商配置 =====

  getProviderConfig(): AIProviderConfig | null {
    const data = localStorage.getItem(PROVIDER_CONFIG_KEY);
    return data ? JSON.parse(data) : null;
  },

  saveProviderConfig(config: AIProviderConfig) {
    if (config.apiKey) this.saveAPIKey(config.id, config.apiKey);
    localStorage.setItem(PROVIDER_CONFIG_KEY, JSON.stringify(config));
  },

  // ===== 双模型配置 =====

  getDualModelConfig(): { enabled: boolean; provider: AIProviderConfig | null } {
    const data = localStorage.getItem(DUAL_MODEL_CONFIG_KEY);
    return data ? JSON.parse(data) : { enabled: false, provider: null };
  },

  saveDualModelConfig(config: { enabled: boolean; provider: AIProviderConfig | null }) {
    if (config.provider?.apiKey) {
      this.saveAPIKey(config.provider.id + '_small', config.provider.apiKey);
    }
    localStorage.setItem(DUAL_MODEL_CONFIG_KEY, JSON.stringify(config));
  },

  // ===== 答疑对话模型配置 =====

  getChatConfig(): ChatConfig | null {
    const data = localStorage.getItem(CHAT_CONFIG_KEY);
    return data ? JSON.parse(data) : null;
  },

  saveChatConfig(config: ChatConfig) {
    if (config.provider?.apiKey) {
      this.saveAPIKey(config.provider.id + '_chat', config.provider.apiKey);
    }
    localStorage.setItem(CHAT_CONFIG_KEY, JSON.stringify(config));
  },

  // ===== 视觉识别模型配置 =====

  getVisionConfig(): VisionConfig | null {
    const data = localStorage.getItem(VISION_CONFIG_KEY);
    return data ? JSON.parse(data) : null;
  },

  saveVisionConfig(config: VisionConfig) {
    if (config.provider?.apiKey) {
      this.saveAPIKey(config.provider.id + '_vision', config.provider.apiKey);
    }
    localStorage.setItem(VISION_CONFIG_KEY, JSON.stringify(config));
  },
};
