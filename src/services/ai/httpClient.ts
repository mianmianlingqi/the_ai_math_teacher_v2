/**
 * _aiHttpCore.ts
 *
 * 单一职责：OpenAI 兼容 API 的 HTTP 底层工具函数。
 * 无业务状态，无副作用，供 aiService / chatService 共用。
 *
 * Why: aiService 和 chatService 各自重复了相同的：
 *   - isReasoningModel 正则判断
 *   - baseURL 规范化
 *   - Authorization 请求头构建
 *   - 超时毫秒计算
 *   - HTTP 4xx/5xx 错误码映射
 *   提取到此处，统一维护，避免多点修改遗漏。
 */

import { AIProviderConfig } from '@/types';

// ===== 推理模型识别 =====

/**
 * 判断给定模型名是否属于推理模型（DeepSeek-R1 / OpenAI o1 系列等）。
 *
 * Why: 推理模型需要关闭 temperature、延长超时，在多处需要判断，统一正则源。
 *
 * @param model - 模型 ID 字符串
 * @returns true 表示是推理模型
 */
export function isReasoningModel(model: string): boolean {
  return /reasoner|^o[0-9]|r1/i.test(model);
}

// ===== URL 规范化 =====

/**
 * 移除 baseURL 末尾的多余斜杠，使拼接子路径时格式统一。
 *
 * @param baseURL - 供应商配置中的 Base URL
 */
export function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

// ===== 请求头构建 =====

/**
 * 构建标准 OpenAI 兼容请求头：Content-Type + 可选 Bearer Token。
 *
 * Why: 两个 service 各自写了相同的 3 行模板代码，在此统一。
 *
 * @param provider - AI 供应商配置
 */
export function buildAuthHeaders(provider: AIProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

// ===== 超时时长计算 =====

/**
 * 根据供应商配置和模型类型计算请求超时毫秒数。
 *
 * Why: 推理模型（R1/o1）需要较长推理时间，默认给 300s；
 *      普通模型默认 120s（可由 provider.timeout 覆盖）。
 *
 * @param provider - AI 供应商配置
 */
export function getTimeoutMs(provider: AIProviderConfig): number {
  const defaultSecs = isReasoningModel(provider.model) ? 300 : 120;
  return (provider.timeout ?? defaultSecs) * 1000;
}

// ===== HTTP 错误信息映射 =====

export interface HttpErrorInfo {
  message: string;
  suggestion: string;
  category: 'network' | 'config' | 'model';
}

/**
 * 将 HTTP 状态码映射为用户友好的错误信息和修复建议。
 *
 * Why: aiService 对每个状态码都需要给出日志 + 建议，提取统一映射
 *      避免各 service 各自维护不同版本的错误文案。
 *
 * @param status      - HTTP 状态码
 * @param model       - 当前使用的模型名称（用于 404 提示）
 * @param providerName - 供应商显示名称（用于 5xx 提示）
 */
export function getHttpErrorInfo(
  status: number,
  model: string,
  providerName: string,
): HttpErrorInfo {
  if (status === 401 || status === 403) {
    return {
      message: `认证失败 (HTTP ${status})：API Key 无效或已过期。`,
      suggestion: '请前往设置检查你的 API Key 是否正确，或重新从供应商处获取。',
      category: 'config',
    };
  }
  if (status === 404) {
    return {
      message: `模型不存在 (HTTP 404)："${model}" 在 ${providerName} 上不可用。`,
      suggestion: '请在设置中切换到其他模型，或确认模型名称拼写正确。',
      category: 'model',
    };
  }
  if (status === 429) {
    return {
      message: '请求过于频繁 (HTTP 429)：已触发速率限制。',
      suggestion: '请等待 30-60 秒后重试，或升级你的 API 套餐。',
      category: 'network',
    };
  }
  if (status === 400) {
    return {
      message: '请求参数错误 (HTTP 400)：模型可能不支持当前配置。',
      suggestion: '尝试在设置中关闭/调整 response_format，或换一个模型。',
      category: 'model',
    };
  }
  if (status >= 500) {
    return {
      message: `供应商服务端错误 (HTTP ${status})：${providerName} 服务暂时不可用。`,
      suggestion: '这通常是供应商的临时故障，请稍后重试。',
      category: 'network',
    };
  }
  return {
    message: `HTTP ${status} 错误`,
    suggestion: '请检查网络连接和供应商配置。',
    category: 'network',
  };
}
