/**
 * providers.ts
 *
 * 单一职责：AI 供应商预设列表 + 视觉识别供应商预设 + 各自的默认配置。
 * 变化原因：新增/更新供应商或其模型列表时修改此文件。
 */

import { ProviderPreset, AIProviderConfig } from '@/types';

// ===== 通用供应商预设（出题 / 答疑 / 双模型） =====

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-preview',
    models: ['gpt-5-preview', 'gpt-4.5', 'gpt-4.5-turbo', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o1'],
    website: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.0-flash-001',
    models: ['gemini-3.0-pro-001', 'gemini-3.0-flash-001', 'gemini-3.0-flash-lite-001', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    website: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-reasoner',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder-v3'],
    website: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'moonshot',
    name: 'Moonshot / Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    models: [
      'kimi-k2.5',
      'kimi-k2-0905-preview',
      'kimi-k2-0711-preview',
      'kimi-k2-turbo-preview',
      'kimi-k2-thinking-turbo',
      'kimi-k2-thinking',
      'moonshot-v1-auto',
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
    ],
    website: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5-flash',
    models: ['glm-5-plus', 'glm-5-flash', 'glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-4-air'],
    website: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow 硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3.5-72B-Instruct',
      'Qwen/Qwen3-72B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'THUDM/glm-4-9b-chat',
    ],
    website: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-4-70b-versatile',
    models: [
      'llama-4-70b-versatile',
      'llama-3.3-70b-versatile',
      'deepseek-r1-distill-llama-70b',
      'gemma3-9b-it',
      'mixtral-8x22b-32768',
    ],
    website: 'https://console.groq.com/keys',
  },
  {
    id: 'together',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-4-70B-Instruct-Turbo',
    models: [
      'meta-llama/Llama-4-70B-Instruct-Turbo',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'Qwen/Qwen3-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
    ],
    website: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'dashscope',
    name: '通义千问 (DashScope)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen3.5-max', 'qwen3.5-plus', 'qwen3-max', 'qwen3-plus', 'qwen-max', 'qwen-plus', 'qwen-turbo'],
    website: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:14b',
    models: ['qwen3.5', 'qwen3', 'qwen2.5:14b', 'llama4:8b', 'llama3.3:latest', 'deepseek-r1:14b'],
    website: 'https://ollama.com/',
  },
  {
    id: 'custom',
    name: '自定义 / 其他',
    baseURL: '',
    defaultModel: '',
    models: [],
    website: '',
  },
];

export const DEFAULT_PROVIDER_CONFIG: AIProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-reasoner',
  temperature: 1.0,
  timeout: 300,
};

// ===== 视觉识别供应商预设（仅包含支持 Vision 的供应商和模型） =====

export const VISION_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-3.0-flash-001', 'gemini-3.0-pro-001'],
    website: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    website: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'moonshot',
    name: '月之暗面 (Moonshot / Kimi)',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    models: [
      'kimi-k2.5',
      'kimi-k2-0905-preview',
      'kimi-k2-0711-preview',
      'kimi-k2-turbo-preview',
      'kimi-k2-thinking-turbo',
      'kimi-k2-thinking',
      'moonshot-v1-auto',
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
      'moonshot-v1-8k-vision-preview',
      'moonshot-v1-32k-vision-preview',
      'moonshot-v1-128k-vision-preview',
    ],
    website: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'dashscope',
    name: '通义千问 (DashScope)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-vl-plus',
    models: ['qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct', 'qwen2.5-vl-7b-instruct'],
    website: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4v-flash',
    models: ['glm-4v-plus', 'glm-4v-flash', 'glm-4v'],
    website: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow 硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    models: [
      'Qwen/Qwen2.5-VL-72B-Instruct',
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'Pro/Qwen/Qwen2.5-VL-7B-Instruct',
    ],
    website: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llava:7b',
    models: ['llava:7b', 'llava:13b', 'llava-llama3', 'moondream'],
    website: 'https://ollama.com/',
  },
  {
    id: 'custom',
    name: '自定义 / 其他',
    baseURL: '',
    defaultModel: '',
    models: [],
    website: '',
  },
];

export const DEFAULT_VISION_CONFIG: AIProviderConfig = {
  id: 'gemini',
  name: 'Google Gemini',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: '',
  model: 'gemini-2.0-flash',
  temperature: 0.3,
  timeout: 120,
};
