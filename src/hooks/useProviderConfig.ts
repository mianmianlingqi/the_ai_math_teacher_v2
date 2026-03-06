/**
 * useProviderConfig.ts
 *
 * 单一职责：管理所有 AI 供应商配置状态（主模型/双模型/对话/识图）。
 *
 * Why: 原 App.tsx 中有 5 个相关 useState + 2 个 useEffect + handleProviderSave + handleQuickModelChange，
 *      约 80 行逻辑散落在组件顶部。提取到此 hook 后，App.tsx 只需一行解构即可获取全部能力，
 *      且配置逻辑可独立测试，不依赖任何 UI 状态。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AIProviderConfig, ChatConfig, DualModelConfig, VisionConfig } from '@/types';
import { DEFAULT_PROVIDER_CONFIG, DEFAULT_VISION_CONFIG } from '@/constants';
import { storageService } from '@/services/storage';
import { UnifiedAIService } from '@/services/ai/aiService';
import { aiApi, isBackendEnabled } from '@/services/api/backendApi';

// ===== 类型定义 =====

export interface BackendProvider {
  id: string;
  name: string;
  models: string[];
}

export interface UseProviderConfigResult {
  // 状态
  providerConfig: AIProviderConfig;
  setProviderConfig: React.Dispatch<React.SetStateAction<AIProviderConfig>>;
  dualModelConfig: DualModelConfig;
  setDualModelConfig: React.Dispatch<React.SetStateAction<DualModelConfig>>;
  chatConfig: ChatConfig;
  setChatConfig: React.Dispatch<React.SetStateAction<ChatConfig>>;
  visionConfig: VisionConfig;
  setVisionConfig: React.Dispatch<React.SetStateAction<VisionConfig>>;
  backendProviders: BackendProvider[];

  // 派生值：供快速模型选择器使用
  quickModelValue: string;

  // 操作方法
  /**
   * 处理快速模型选择器的变更。
   * @param value  - "providerId:modelName" 或 "__custom__"
   * @param onOpenSettings - 当选取 "__custom__" 时调用，打开设置面板
   */
  handleQuickModelChange: (value: string, onOpenSettings: () => void) => void;

  /**
   * 保存来自 SettingsPanel 的全量配置更新。
   * Why: SettingsPanel 一次性修改 4 个配置，集中写入确保原子性。
   */
  handleProviderSave: (
    newConfig: AIProviderConfig,
    newDualConfig: DualModelConfig,
    newChatConfig: ChatConfig,
    newVisionConfig: VisionConfig
  ) => void;

  /** AI 服务实例 ref——配置变更时 useEffect 在内部同步更新，无需外部感知 */
  aiServiceRef: React.MutableRefObject<UnifiedAIService>;
}

// ===== Hook 实现 =====

/**
 * 管理 AI 供应商配置状态与服务实例。
 *
 * @returns 配置状态、快速切换方法、保存方法和 AI 服务 Ref
 */
export function useProviderConfig(): UseProviderConfigResult {
  // 1. 初始化各配置，读取持久化存储，并做兼容性迁移
  const [providerConfig, setProviderConfig] = useState<AIProviderConfig>(() => {
    const saved = storageService.getProviderConfig();
    if (!saved) return DEFAULT_PROVIDER_CONFIG;
    return {
      ...saved,
      timeout: saved.timeout ?? 300,
      // 迁移旧版默认温度 0.8 → 1.0
      temperature: (saved.temperature === 0.8 || !saved.temperature) ? 1.0 : saved.temperature,
    };
  });

  const [dualModelConfig, setDualModelConfig] = useState<DualModelConfig>(
    () => storageService.getDualModelConfig()
  );

  const [chatConfig, setChatConfig] = useState<ChatConfig>(() => {
    const saved = storageService.getChatConfig();
    return saved || { provider: { ...DEFAULT_PROVIDER_CONFIG, apiKey: '', temperature: 0.7 } };
  });

  const [visionConfig, setVisionConfig] = useState<VisionConfig>(() => {
    const saved = storageService.getVisionConfig();
    return saved || { provider: { ...DEFAULT_VISION_CONFIG } };
  });

  const [backendProviders, setBackendProviders] = useState<BackendProvider[]>([]);

  // 2. 创建 AI 服务实例 ref（避免每次渲染重建）
  const aiServiceRef = useRef(new UnifiedAIService(providerConfig, dualModelConfig));

  // 3. 配置变更时同步更新服务实例
  useEffect(() => {
    aiServiceRef.current.updateConfig(providerConfig, dualModelConfig);
  }, [providerConfig, dualModelConfig]);

  // 4. 挂载时拉取后台供应商列表，并自动切换到默认模型
  useEffect(() => {
    if (!isBackendEnabled()) return;

    aiApi.getProviders().then(list => {
      setBackendProviders(list);

      // 如果用户当前未配置任何供应商，自动选取第一个后台供应商
      if (list.length > 0 && !providerConfig.backendProvider && !providerConfig.apiKey) {
        const deepseek = list.find(p => p.id === 'deepseek');
        const target = deepseek ?? list[0];
        const model = target.models.includes('deepseek-reasoner')
          ? 'deepseek-reasoner'
          : target.models[0];
        const newConfig: AIProviderConfig = {
          ...providerConfig,
          id: target.id,
          name: target.name,
          backendProvider: target.id,
          model,
          apiKey: '',
        };
        setProviderConfig(newConfig);
        storageService.saveProviderConfig(newConfig);
      }
    }).catch(() => {
      // 后台不可用时静默失败，用户仍可使用自定义 Key
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 5. 快速模型选择器：从 "providerId:model" 格式解析并更新配置
  const handleQuickModelChange = (value: string, onOpenSettings: () => void) => {
    if (value === '__custom__') {
      onOpenSettings();
      return;
    }
    // modelName 可能包含冒号（如 "openai:gpt-4o:mini"），只取第一个冒号前为 providerId
    const colonIdx = value.indexOf(':');
    const providerId = value.slice(0, colonIdx);
    const model = value.slice(colonIdx + 1);
    const provider = backendProviders.find(p => p.id === providerId);

    const newConfig: AIProviderConfig = {
      ...providerConfig,
      id: providerId,
      name: provider?.name ?? providerId,
      backendProvider: providerId,
      model,
      apiKey: '', // 后台代理模式无需暴露 Key
    };
    setProviderConfig(newConfig);
    storageService.saveProviderConfig(newConfig);
  };

  // 6. 来自 SettingsPanel 的批量保存（4 配置原子写入）
  const handleProviderSave = (
    newConfig: AIProviderConfig,
    newDualConfig: DualModelConfig,
    newChatConfig: ChatConfig,
    newVisionConfig: VisionConfig
  ) => {
    setProviderConfig(newConfig);
    setDualModelConfig(newDualConfig);
    setChatConfig(newChatConfig);
    setVisionConfig(newVisionConfig);
    storageService.saveProviderConfig(newConfig);
    storageService.saveDualModelConfig(newDualConfig);
    storageService.saveChatConfig(newChatConfig);
    storageService.saveVisionConfig(newVisionConfig);
  };

  // 7. 派生值：当前快速选择器显示值
  const quickModelValue = useMemo(
    () => providerConfig.backendProvider
      ? `${providerConfig.backendProvider}:${providerConfig.model}`
      : '__custom__',
    [providerConfig.backendProvider, providerConfig.model]
  );

  return {
    providerConfig,
    setProviderConfig,
    dualModelConfig,
    setDualModelConfig,
    chatConfig,
    setChatConfig,
    visionConfig,
    setVisionConfig,
    backendProviders,
    quickModelValue,
    handleQuickModelChange,
    handleProviderSave,
    aiServiceRef,
  };
}
