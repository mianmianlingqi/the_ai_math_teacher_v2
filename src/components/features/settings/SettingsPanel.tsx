import React, { useState, useEffect } from 'react';
import { AIProviderConfig, DualModelConfig, ChatConfig, VisionConfig } from '@/types';
import { PROVIDER_PRESETS, DEFAULT_PROVIDER_CONFIG, VISION_PROVIDER_PRESETS, DEFAULT_VISION_CONFIG } from '@/constants';
import { storageService } from '@/services/storage';
import { SuitDecorations } from '@/components/common/SuitDecorations';
import { aiApi, authApi, isBackendEnabled, tokenStore, BackendUser } from '@/services/api/backendApi';

const sanitizeUiError = (raw: string): string => {
  const text = String(raw || '')
    .replace(/```[\s\S]*?```/g, '[已隐藏代码片段]')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!text) return '请求失败，请检查配置后重试。';
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
};

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
  isLoggedIn: boolean;
  onSave: (config: AIProviderConfig, dualConfig: DualModelConfig, chatConfig: ChatConfig, visionConfig: VisionConfig) => void;
  currentConfig: AIProviderConfig;
  currentDualConfig: DualModelConfig;
  currentChatConfig: ChatConfig;
  currentVisionConfig: VisionConfig;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose, onOpenAuth, isLoggedIn, onSave, currentConfig, currentDualConfig, currentChatConfig, currentVisionConfig }) => {
  const [activeTab, setActiveTab] = useState<'main' | 'small' | 'chat' | 'vision'>('main');

  const [config, setConfig] = useState<AIProviderConfig>(currentConfig);
  const [dualConfig, setDualConfig] = useState<DualModelConfig>(currentDualConfig);
  const [chatConfig, setChatConfig] = useState<ChatConfig>(currentChatConfig);
  const [visionConfig, setVisionConfig] = useState<VisionConfig>(currentVisionConfig);

  const [customModelMain, setCustomModelMain] = useState('');
  const [customModelSmall, setCustomModelSmall] = useState('');
  const [customModelChat, setCustomModelChat] = useState('');
  const [customModelVision, setCustomModelVision] = useState('');

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // ===== 注销账号流程状态 =====
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState('');
  const [deactivateLoading, setDeactivateLoading] = useState(false);
  const [deactivateError, setDeactivateError] = useState('');

  const handleDeactivate = async () => {
    if (!deactivatePassword) {
      setDeactivateError('请输入密码以确认注销');
      return;
    }
    setDeactivateLoading(true);
    setDeactivateError('');
    try {
      await authApi.deactivate(deactivatePassword);
      // auth:logout 事件已在 deactivate() 内广播，UI 会自动同步
      onClose();
    } catch (err: any) {
      setDeactivateError(err.message || '注销失败，请稍后重试');
    } finally {
      setDeactivateLoading(false);
    }
  };

  useEffect(() => {
    setConfig(currentConfig);
    setDualConfig(currentDualConfig);
    setChatConfig(currentChatConfig);
    setVisionConfig(currentVisionConfig);
  }, [currentConfig, currentDualConfig, currentChatConfig, currentVisionConfig, isOpen]);

  const mainConfigInvalid = !config.backendProvider && (!config.baseURL || (!config.apiKey && config.id !== 'ollama') || !config.model);
  const smallConfigInvalid = dualConfig.enabled && !dualConfig.provider?.backendProvider && (!dualConfig.provider?.baseURL || (!dualConfig.provider?.apiKey && dualConfig.provider?.id !== 'ollama') || !dualConfig.provider?.model);
  const isSaveDisabled = mainConfigInvalid || smallConfigInvalid;

  const getMissingHint = () => {
    const hints: string[] = [];
    if (mainConfigInvalid) hints.push('核心思考大模型');
    if (smallConfigInvalid) hints.push('格式化小模型');
    return hints;
  };

  const handleSave = () => {
    const finalConfig = {
      ...config,
      model: customModelMain.trim() || config.model,
      timeout: config.timeout ?? 300,
      temperature: config.temperature ?? 1.0,
    };

    let finalDualConfig = { ...dualConfig };
    if (finalDualConfig.provider) {
      finalDualConfig.provider = {
        ...finalDualConfig.provider,
        model: customModelSmall.trim() || finalDualConfig.provider.model,
        timeout: finalDualConfig.provider.timeout ?? 300,
        temperature: finalDualConfig.provider.temperature ?? 1.0,
      };
    }

    const finalChatConfig: ChatConfig = {
      provider: {
        ...chatConfig.provider,
        model: customModelChat.trim() || chatConfig.provider.model,
        timeout: chatConfig.provider.timeout ?? 120,
        temperature: chatConfig.provider.temperature ?? 0.7,
      },
    };

    const finalVisionConfig: VisionConfig = {
      provider: {
        ...visionConfig.provider,
        model: customModelVision.trim() || visionConfig.provider.model,
        timeout: visionConfig.provider.timeout ?? 120,
        temperature: visionConfig.provider.temperature ?? 0.3,
      },
    };

    storageService.saveProviderConfig(finalConfig);
    storageService.saveDualModelConfig(finalDualConfig);
    storageService.saveChatConfig(finalChatConfig);
    storageService.saveVisionConfig(finalVisionConfig);
    onSave(finalConfig, finalDualConfig, finalChatConfig, finalVisionConfig);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center settings-no-motion">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm settings-simple-fade" onClick={onClose}></div>
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto flex flex-col settings-simple-pop">
        <div className="p-10 pb-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-sky-100 rounded-2xl flex items-center justify-center text-sky-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900">AI 供应商配置</h2>
                <p className="text-xs text-slate-400 font-bold">支持 OpenAI 兼容 API 的所有供应商</p>
              </div>
            </div>
            <button onClick={onClose} data-help="关闭设置窗口并返回主页。若已修改参数但未点“保存配置”，本次修改不会生效。" className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex gap-2 mt-8 p-1 bg-slate-100/50 rounded-2xl">
            <button
              onClick={() => { setActiveTab('main'); setTestStatus('idle'); setTestMessage(''); }}
              data-help="核心思考大模型：负责生成题目思路与主要内容。建议优先配置稳定、质量高的模型。"
              className={`flex-1 py-2.5 rounded-xl text-sm font-black transition-all ${activeTab === 'main' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              核心思考大模型
            </button>
            <button
              onClick={() => { setActiveTab('small'); setTestStatus('idle'); setTestMessage(''); }}
              data-help="格式化小模型：将核心模型输出转为标准 JSON。开启后可提升解析稳定性。"
              className={`flex-1 py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 ${activeTab === 'small' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              格式化小模型
              {dualConfig.enabled && <span className="w-2 h-2 rounded-full bg-emerald-400"></span>}
            </button>
            <button
              onClick={() => { setActiveTab('chat'); setTestStatus('idle'); setTestMessage(''); }}
              data-help="答疑模型：用于右下角 ai对话助手。建议选择响应快、上下文理解稳定的模型。"
              className={`flex-1 py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 ${activeTab === 'chat' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              答疑模型
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            </button>
            <button
              onClick={() => { setActiveTab('vision'); setTestStatus('idle'); setTestMessage(''); }}
              data-help="视觉识别模型：用于图片题识别与图片答疑。请优先选择支持多模态输入的模型。"
              className={`flex-1 py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 ${activeTab === 'vision' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              视觉识别
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </button>
          </div>
        </div>

        <div className="p-10 pt-4 flex-1 overflow-y-auto">
          {activeTab === 'small' && (
            <div className="mb-8 p-6 bg-sky-50/50 rounded-2xl border border-sky-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-sky-900 text-sm">启用双模型模式</h3>
                <p className="text-xs text-sky-600/70 mt-1 font-medium">大模型构思题干解答，小模型负责转化为标准JSON</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  value=""
                  className="sr-only peer"
                  aria-label="启用双模型模式"
                  checked={dualConfig.enabled}
                  onChange={(e) => {
                    setDualConfig(prev => {
                      if (e.target.checked && !prev.provider) {
                        return { enabled: true, provider: DEFAULT_PROVIDER_CONFIG };
                      }
                      return { ...prev, enabled: e.target.checked };
                    });
                  }}
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
              </label>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="mb-6 p-5 bg-sky-50/50 rounded-2xl border border-sky-100">
              <h3 className="font-black text-sky-900 text-sm mb-1">答疑对话模型</h3>
              <p className="text-xs text-sky-600/70 font-medium">配置用于 ai对话助手的模型，支持流式输出实时对话。建议选用响应速度快的模型。</p>
            </div>
          )}

          {activeTab === 'vision' && (
            <div className="mb-6 p-5 bg-violet-50/50 rounded-2xl border border-violet-100">
              <h3 className="font-black text-violet-900 text-sm mb-1">视觉识别模型</h3>
              <p className="text-xs text-violet-600/70 font-medium">配置用于拍照/上传识别题目的视觉模型。需要选择支持图片输入的模型（如 GPT-4o、Gemini、Qwen-VL 等）。</p>
            </div>
          )}

          {(!dualConfig.enabled && activeTab === 'small') ? (
            <div className="text-center py-12 text-slate-400 font-bold text-sm">
              启用上方开关以配置格式化模型
            </div>
          ) : activeTab === 'chat' ? (
            <ProviderForm
              config={chatConfig.provider}
              onChange={(newConf) => setChatConfig({ provider: newConf })}
              customModel={customModelChat}
              setCustomModel={setCustomModelChat}
              isLoggedIn={isLoggedIn}
              onOpenAuth={onOpenAuth}
              testStatus={testStatus}
              setTestStatus={setTestStatus}
              testMessage={testMessage}
              setTestMessage={setTestMessage}
            />
          ) : activeTab === 'vision' ? (
            <ProviderForm
              config={visionConfig.provider}
              onChange={(newConf) => setVisionConfig({ provider: newConf })}
              customModel={customModelVision}
              setCustomModel={setCustomModelVision}
              isLoggedIn={isLoggedIn}
              onOpenAuth={onOpenAuth}
              testStatus={testStatus}
              setTestStatus={setTestStatus}
              testMessage={testMessage}
              setTestMessage={setTestMessage}
              providerPresets={VISION_PROVIDER_PRESETS}
            />
          ) : (
            <ProviderForm
              config={activeTab === 'main' ? config : dualConfig.provider!}
              onChange={(newConf) => activeTab === 'main' ? setConfig(newConf) : setDualConfig(prev => ({ ...prev, provider: newConf }))}
              customModel={activeTab === 'main' ? customModelMain : customModelSmall}
              setCustomModel={(val) => activeTab === 'main' ? setCustomModelMain(val) : setCustomModelSmall(val)}
              isLoggedIn={isLoggedIn}
              onOpenAuth={onOpenAuth}
              testStatus={testStatus}
              setTestStatus={setTestStatus}
              testMessage={testMessage}
              setTestMessage={setTestMessage}
            />
          )}

          {/* 底部按钮 */}
          <div className="flex flex-col gap-3 pt-8 mt-8 border-t border-slate-100">
            <div className="flex gap-4">
              <button onClick={onClose} className="flex-1 py-4 rounded-2xl text-sm font-black text-slate-500 bg-slate-50 hover:bg-slate-100 transition-all border-2 border-slate-100">
                取消
              </button>
              <button
                onClick={handleSave}
                data-help="保存当前标签页及其它已修改配置。保存后会立即用于后续生成、答疑与识别请求。"
                disabled={isSaveDisabled}
                className={`flex-1 py-4 rounded-2xl text-sm font-black transition-all ${isSaveDisabled
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    : 'bg-sky-600 text-white hover:bg-sky-700 shadow-xl shadow-sky-100'
                  }`}
              >
                保存配置
              </button>
            </div>
            {isSaveDisabled && (
              <div className="flex items-center gap-2 px-1">
                <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-amber-500 font-semibold">
                  请先完善以下标签页的配置：
                  {getMissingHint().map((tab, i) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab === '核心思考大模型' ? 'main' : 'small')}
                      className="ml-1 underline underline-offset-2 text-sky-500 hover:text-sky-700 font-black"
                    >
                      {tab}{i < getMissingHint().length - 1 ? '、' : ''}
                    </button>
                  ))}
                </p>
              </div>
            )}
          </div>

          {/* ===== 注销账号区（仅登录用户可见）===== */}
          {isLoggedIn && (
            <div className="mt-8 pt-6 border-t border-rose-100">
              {!showDeactivate ? (
                <button
                  onClick={() => { setShowDeactivate(true); setDeactivateError(''); setDeactivatePassword(''); }}
                  className="text-xs font-bold text-rose-400 hover:text-rose-600 underline underline-offset-2 transition-colors"
                >
                  注销账号
                </button>
              ) : (
                <div className="space-y-4 rounded-2xl border-2 border-rose-200 bg-rose-50/50 p-5">
                  <div>
                    <p className="text-sm font-black text-rose-700">⚠️ 确认注销账号</p>
                    <p className="text-xs text-rose-500 font-medium mt-1">注销后账号将被停用，所有登录设备下线。此操作不可自行撤销。</p>
                  </div>
                  <input
                    type="password"
                    placeholder="输入当前密码以确认"
                    value={deactivatePassword}
                    onChange={e => { setDeactivatePassword(e.target.value); setDeactivateError(''); }}
                    className="w-full bg-white border-2 border-rose-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-rose-400 transition-all"
                    onKeyDown={e => e.key === 'Enter' && handleDeactivate()}
                  />
                  {deactivateError && (
                    <p className="text-xs font-semibold text-rose-600">{deactivateError}</p>
                  )}
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowDeactivate(false); setDeactivatePassword(''); setDeactivateError(''); }}
                      className="flex-1 py-2.5 rounded-xl text-xs font-black text-slate-500 bg-white border-2 border-slate-200 hover:bg-slate-50 transition-all"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleDeactivate}
                      disabled={deactivateLoading}
                      className="flex-1 py-2.5 rounded-xl text-xs font-black text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-50 transition-all"
                    >
                      {deactivateLoading ? '注销中...' : '确认注销'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface ProviderFormProps {
  config: AIProviderConfig;
  onChange: (config: AIProviderConfig) => void;
  customModel: string;
  setCustomModel: (model: string) => void;
  isLoggedIn: boolean;
  onOpenAuth: () => void;
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  setTestStatus: (status: 'idle' | 'testing' | 'success' | 'error') => void;
  testMessage: string;
  setTestMessage: (msg: string) => void;
  providerPresets?: typeof PROVIDER_PRESETS;
}

const ProviderForm: React.FC<ProviderFormProps> = ({ config, onChange, customModel, setCustomModel, isLoggedIn, onOpenAuth, testStatus, setTestStatus, testMessage, setTestMessage, providerPresets }) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const presets = providerPresets || PROVIDER_PRESETS;

  // ===== 后台模型相关状态 =====
  const backendEnabled = isBackendEnabled();
  const isBackendMode = !!config.backendProvider;
  const [backendProviders, setBackendProviders] = useState<Array<{ id: string; name: string; models: string[] }>>([]);
  const [backendLoading, setBackendLoading] = useState(false);
  const [showBackendSection, setShowBackendSection] = useState(isBackendMode);
  const [backendUser, setBackendUser] = useState<BackendUser | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState('');

  useEffect(() => {
    setShowBackendSection(!!config.backendProvider);
  }, [config.backendProvider]);

  const loadBackendUserQuota = async () => {
    if (!isLoggedIn) {
      setBackendUser(null);
      setQuotaError('');
      return;
    }

    setQuotaLoading(true);
    setQuotaError('');
    try {
      const me = await authApi.getMe();
      if (!me) {
        throw new Error('步骤[获取当前用户信息]失败，返回值为 null。Hint: 请重新登录后重试。');
      }
      setBackendUser(me);
    } catch (error: any) {
      setBackendUser(null);
      const message = (error?.message || '').trim() || '未知错误';
      setQuotaError(`步骤[加载用户配额]失败，登录状态[${isLoggedIn ? '已登录' : '未登录'}]，原因[${message}]。Hint: 请检查登录状态并重试。`);
    } finally {
      setQuotaLoading(false);
    }
  };

  useEffect(() => {
    if (!backendEnabled) return;
    if (!isLoggedIn) {
      setBackendUser(null);
      setQuotaError('');
      return;
    }
    loadBackendUserQuota();
  }, [backendEnabled, isLoggedIn]);

  const loadBackendProviders = async () => {
    if (backendProviders.length > 0) return;
    setBackendLoading(true);
    const list = await aiApi.getProviders().catch(() => []);
    setBackendProviders(list);
    setBackendLoading(false);
  };

  const handleSelectBackendProvider = (providerId: string, providerName: string, defaultModel: string) => {
    onChange({
      ...config,
      id: `backend-${providerId}`,
      name: `[后台] ${providerName}`,
      model: defaultModel,
      baseURL: '',
      apiKey: '',
      backendProvider: providerId,
    });
    setCustomModel('');
  };

  const handleExitBackendMode = () => {
    onChange({
      ...config,
      id: 'custom',
      name: '自定义',
      model: '',
      baseURL: '',
      apiKey: '',
      backendProvider: undefined,
    });
    setCustomModel('');
  };

  const handlePresetChange = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      const savedKey = storageService.getAPIKey(preset.id);
      onChange({
        ...config,
        id: preset.id,
        name: preset.name,
        baseURL: preset.baseURL,
        model: preset.defaultModel,
        apiKey: savedKey || '',
      });
      setCustomModel('');
    }
  };

  const currentPreset = presets.find(p => p.id === config.id);

  const handleModelSelect = (model: string) => {
    if (model !== '__custom__') {
      onChange({ ...config, model });
      setCustomModel('');
    }
  };

  const resolveTestModels = (providerId: string, model: string): string[] => {
    const m = (model || '').trim().toLowerCase();
    if (providerId === 'moonshot') {
      if (m === 'k2.5') return ['kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'moonshot-v1-auto'];
      if (m === 'k2') return ['kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'moonshot-v1-auto'];
    }
    return [model];
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestMessage('');
    const testConfig = {
      ...config,
      model: customModel.trim() || config.model,
    };

    try {
      const baseURL = testConfig.baseURL.replace(/\/+$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (testConfig.apiKey) {
        headers['Authorization'] = `Bearer ${testConfig.apiKey}`;
      }

      const candidateModels = resolveTestModels(testConfig.id, testConfig.model);
      let finalReply = '';
      let usedModel = candidateModels[0];
      let connected = false;
      let lastErrMsg = '连接失败';

      for (let index = 0; index < candidateModels.length; index++) {
        const model = candidateModels[index];
        const response = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "请回复：连接成功" }],
            max_tokens: 20,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          const canFallback = response.status === 404 && /resource_not_found_error|model/i.test(errText);
          if (canFallback && index < candidateModels.length - 1) continue;
          if (response.status === 401 || response.status === 403) {
            lastErrMsg = '认证失败，请检查 API Key 是否正确';
          } else if (response.status === 404) {
            lastErrMsg = '模型不可用，请检查模型名称或切换模型';
          } else if (response.status === 429) {
            lastErrMsg = '请求过于频繁，请稍后重试';
          } else if (response.status >= 500) {
            lastErrMsg = '服务暂时不可用，请稍后重试';
          } else {
            lastErrMsg = `连接失败（HTTP ${response.status}）`;
          }
          throw new Error(lastErrMsg);
        }

        const data = await response.json();
        finalReply = data.choices?.[0]?.message?.content || '';
        usedModel = model;
        connected = true;
        break;
      }

      if (!connected) {
        throw new Error(lastErrMsg || '连接失败');
      }

      setTestStatus('success');
      if (usedModel !== testConfig.model) {
        setTestMessage(`连接成功（已自动回退到 ${usedModel}）！模型回复: "${finalReply.slice(0, 50)}"`);
      } else {
        setTestMessage(`连接成功！模型回复: "${finalReply.slice(0, 50)}"`);
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(`连接失败: ${sanitizeUiError(err?.message || '')}`);
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn mt-2">

      {/* ===== 配置区 ===== */}
      <>
      {/* 供应商选择 */}
      <div className="space-y-3">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">选择供应商</label>
        <div className="grid grid-cols-3 gap-2">
          {presets.map(preset => (
            <button
              key={preset.id}
              onClick={() => handlePresetChange(preset.id)}
              data-help={`切换到 ${preset.name} 供应商预设。将自动填充推荐 Base URL 与默认模型。`}
              className={`px-4 py-3 rounded-2xl text-xs font-bold transition-all border-2 text-left ${config.id === preset.id
                  ? 'bg-sky-50 border-sky-300 text-sky-700'
                  : 'bg-slate-50/50 border-slate-100 text-slate-600 hover:border-slate-200 hover:bg-white'
                }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* API 地址 */}
      <div className="space-y-3">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">API 基础地址 (Base URL)</label>
        <input
          type="text"
          data-help="填写 OpenAI 兼容接口地址（通常以 /v1 结尾）。用于所有聊天请求的基础入口。"
          className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all font-mono"
          placeholder="https://api.example.com/v1"
          value={config.baseURL}
          onChange={(e) => onChange({ ...config, baseURL: e.target.value })}
        />
      </div>

      {/* API Key */}
      <div className="space-y-3">
        <div className="flex items-center justify-between ml-2 mr-2">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">API Key</label>
          {currentPreset?.website && (
            <a
              href={currentPreset.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-bold text-sky-500 hover:text-sky-700 underline underline-offset-2"
            >
              获取 Key →
            </a>
          )}
        </div>
        <div className="relative">
          <input
            type={showApiKey ? "text" : "password"}
            data-help="填写 API Key。若使用本地 Ollama 可留空。建议按模型用途分别测试连接。"
            className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-6 py-4 pr-24 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all font-mono"
            placeholder={config.id === 'ollama' ? '本地模型无需 Key（留空即可）' : '输入你的 API Key...'}
            value={config.apiKey}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value.trim() })}
          />
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            data-help="切换 API Key 显示/隐藏状态，仅影响本地输入框展示，不会影响保存内容。"
            className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1.5 text-[10px] font-black text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
          >
            {showApiKey ? '隐藏' : '显示'}
          </button>
        </div>
      </div>

      {/* 模型选择 */}
      <div className="space-y-3">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">模型名称</label>
        {currentPreset && currentPreset.models.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {currentPreset.models.map(model => (
              <button
                key={model}
                onClick={() => handleModelSelect(model)}
                data-help={`使用推荐模型：${model}。若不在列表中，可在下方输入自定义模型名。`}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border ${config.model === model && !customModel
                    ? 'bg-sky-100 border-sky-300 text-sky-700'
                    : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-slate-200'
                  }`}
              >
                {model}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          data-help="可手动输入模型名称（覆盖上方选择）。例如供应商新模型或私有部署模型。"
          className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all font-mono"
          placeholder="输入或选择模型名称..."
          value={customModel || config.model}
          onChange={(e) => {
            setCustomModel(e.target.value);
            if (e.target.value) {
              onChange({ ...config, model: e.target.value });
            }
          }}
        />
      </div>
      </>

      {/* 高级参数 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-3">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">温度 (Temp)</label>
          <input
            type="number"
            data-help="温度控制回答发散度。越低越稳定，越高越灵活；出题场景建议 0.7~1.0。"
            min="0"
            max="2"
            step="0.1"
            className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-4 text-xs font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all"
            value={config.temperature ?? 1.0}
            onChange={(e) => {
              const nextTemperature = Number.parseFloat(e.target.value);
              onChange({
                ...config,
                temperature: Number.isNaN(nextTemperature) ? undefined : nextTemperature,
              });
            }}
          />
        </div>
        <div className="space-y-3">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Tokens</label>
          <input
            type="number"
            data-help="限制输出长度。留空使用模型默认值；值过小可能导致回答被截断。"
            min="0"
            step="256"
            className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-4 text-xs font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all"
            placeholder="默认"
            value={config.maxTokens || ''}
            onChange={(e) => onChange({ ...config, maxTokens: parseInt(e.target.value) || undefined })}
          />
        </div>
        <div className="space-y-3">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">超时 (秒)</label>
          <input
            type="number"
            data-help="请求超时时间（秒）。网络较慢或模型较慢时可适当增大，例如 300 秒。"
            min="0"
            step="1"
            className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-4 text-xs font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all"
            placeholder="300"
            value={config.timeout ?? 300}
            onChange={(e) => {
              const nextTimeout = Number.parseInt(e.target.value, 10);
              onChange({
                ...config,
                timeout: Number.isNaN(nextTimeout) ? undefined : nextTimeout,
              });
            }}
          />
        </div>
      </div>

      {/* 测试连接 */}
      <div className="space-y-3">
        <button
          onClick={handleTest}
          data-help="发送一条最小测试请求验证：Base URL、Key 与模型名称是否可用。失败时请先检查模型名与权限。"
          disabled={testStatus === 'testing'}
          className={`w-full py-4 rounded-2xl text-sm font-black transition-all border-2 flex items-center justify-center gap-2 ${testStatus === 'testing'
              ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-wait'
              : testStatus === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'
                : testStatus === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300'
            }`}
        >
          {testStatus === 'testing' ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
              测试中...
            </>
          ) : testStatus === 'success' ? '✓ 连接成功' : testStatus === 'error' ? '✗ 连接失败（点击重试）' : '测试连接'}
        </button>
        {testMessage && (
          <p className={`text-xs font-bold px-2 ${testStatus === 'success' ? 'text-emerald-600' : 'text-rose-500'}`}>
            {testMessage}
          </p>
        )}
      </div>
    </div>
  );
};
