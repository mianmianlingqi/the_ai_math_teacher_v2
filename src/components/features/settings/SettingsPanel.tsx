import React, { useEffect, useState } from 'react';
import { AIProviderConfig, AutoSaveSettings } from '@/types';
import {
  AUTO_SAVE_MAX_INTERVAL_SECONDS,
  AUTO_SAVE_MAX_MAX_SAVES,
  AUTO_SAVE_MIN_INTERVAL_SECONDS,
  AUTO_SAVE_MIN_MAX_SAVES,
  PROVIDER_PRESETS,
  normalizeAutoSaveSettings,
} from '@/constants';
import { storageService } from '@/services/storage';

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
  onSave: (config: AIProviderConfig) => void;
  currentConfig: AIProviderConfig;
  autoSaveSettings: AutoSaveSettings;
  onSaveAutoSaveSettings: (settings: AutoSaveSettings) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose, onSave, currentConfig, autoSaveSettings, onSaveAutoSaveSettings }) => {
  const [config, setConfig] = useState<AIProviderConfig>(currentConfig);
  const [localAutoSaveSettings, setLocalAutoSaveSettings] = useState<AutoSaveSettings>(normalizeAutoSaveSettings(autoSaveSettings));
  const [customModel, setCustomModel] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    setConfig(currentConfig);
    setLocalAutoSaveSettings(normalizeAutoSaveSettings(autoSaveSettings));
    setCustomModel('');
    setTestStatus('idle');
    setTestMessage('');
  }, [currentConfig, autoSaveSettings, isOpen]);

  const configInvalid = !config.backendProvider && (!config.baseURL || (!config.apiKey && config.id !== 'ollama') || !config.model);

  const handleSave = () => {
    const finalConfig: AIProviderConfig = {
      ...config,
      model: customModel.trim() || config.model,
      timeout: config.timeout ?? 300,
      temperature: config.temperature ?? 1.0,
    };
    onSave(finalConfig);
    onSaveAutoSaveSettings(normalizeAutoSaveSettings(localAutoSaveSettings));
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
                <h2 className="text-xl font-black text-slate-900">系统设置</h2>
                <p className="text-xs text-slate-400 font-bold">统一管理 AI 模型配置与自动存档策略</p>
              </div>
            </div>
            <button onClick={onClose} data-help="关闭设置窗口并返回主页。若已修改参数但未点“保存配置”，本次修改不会生效。" className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-10 pt-4 flex-1 overflow-y-auto">
          <div className="mb-6 p-5 bg-violet-50/50 rounded-2xl border border-violet-100">
            <h3 className="font-black text-violet-900 text-sm mb-1">统一模型说明</h3>
            <p className="text-xs text-violet-600/70 font-medium">
              保存后，出题页、AI 对话助手和图片识别将统一使用下面这一个模型配置。
              如果你需要使用图片识别，请优先选择支持视觉输入的模型，例如 Gemini、GPT-4o、Qwen-VL 等。
            </p>
          </div>

          <ProviderForm
            config={config}
            onChange={setConfig}
            customModel={customModel}
            setCustomModel={setCustomModel}
            testStatus={testStatus}
            setTestStatus={setTestStatus}
            testMessage={testMessage}
            setTestMessage={setTestMessage}
          />

          <div className="mt-10 pt-8 border-t border-slate-100 space-y-6">
            <div>
              <h3 className="text-lg font-black text-slate-900">自动存档</h3>
              <p className="mt-1 text-xs font-bold text-slate-400 leading-5">
                程序会按设定间隔自动将当前工作区快照写入 AutoSave 存档目录，便于恢复历史状态。
              </p>
            </div>

            <label className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-5 py-4 cursor-pointer">
              <input
                type="checkbox"
                checked={localAutoSaveSettings.enabled}
                onChange={(e) => setLocalAutoSaveSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <div>
                <p className="text-sm font-black text-slate-800">启用自动保存</p>
                <p className="mt-1 text-xs font-bold text-slate-400 leading-5">
                  开启后会在后台异步运行定时器；关闭后暂停定时器，不影响手动备份与已有存档文件。
                </p>
              </div>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-3">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">最大存档数量</label>
                <input
                  type="number"
                  min={AUTO_SAVE_MIN_MAX_SAVES}
                  max={AUTO_SAVE_MAX_MAX_SAVES}
                  step="1"
                  className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all"
                  value={localAutoSaveSettings.maxSaves}
                  onChange={(e) => {
                    const next = Number.parseInt(e.target.value, 10);
                    setLocalAutoSaveSettings(prev => ({
                      ...prev,
                      maxSaves: Number.isNaN(next) ? prev.maxSaves : Math.min(AUTO_SAVE_MAX_MAX_SAVES, Math.max(AUTO_SAVE_MIN_MAX_SAVES, next)),
                    }));
                  }}
                />
                <p className="text-xs font-bold text-slate-400 px-2">默认 10，范围 {AUTO_SAVE_MIN_MAX_SAVES} - {AUTO_SAVE_MAX_MAX_SAVES}。超出上限时会自动删除最旧的存档。</p>
              </div>

              <div className="space-y-3">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">保存间隔（秒）</label>
                <input
                  type="number"
                  min={AUTO_SAVE_MIN_INTERVAL_SECONDS}
                  max={AUTO_SAVE_MAX_INTERVAL_SECONDS}
                  step="1"
                  className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all"
                  value={localAutoSaveSettings.intervalSeconds}
                  onChange={(e) => {
                    const next = Number.parseInt(e.target.value, 10);
                    setLocalAutoSaveSettings(prev => ({
                      ...prev,
                      intervalSeconds: Number.isNaN(next) ? prev.intervalSeconds : Math.min(AUTO_SAVE_MAX_INTERVAL_SECONDS, Math.max(AUTO_SAVE_MIN_INTERVAL_SECONDS, next)),
                    }));
                  }}
                />
                <p className="text-xs font-bold text-slate-400 px-2">默认 300 秒，范围 {AUTO_SAVE_MIN_INTERVAL_SECONDS} - {AUTO_SAVE_MAX_INTERVAL_SECONDS} 秒。</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-8 mt-8 border-t border-slate-100">
            <div className="flex gap-4">
              <button onClick={onClose} className="flex-1 py-4 rounded-2xl text-sm font-black text-slate-500 bg-slate-50 hover:bg-slate-100 transition-all border-2 border-slate-100">
                取消
              </button>
              <button
                onClick={handleSave}
                data-help="保存后，出题、答疑和视觉识别都会统一使用当前配置。"
                disabled={configInvalid}
                className={`flex-1 py-4 rounded-2xl text-sm font-black transition-all ${configInvalid
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-sky-600 text-white hover:bg-sky-700 shadow-xl shadow-sky-100'
                }`}
              >
                保存统一配置
              </button>
            </div>
            {configInvalid && (
              <div className="flex items-center gap-2 px-1">
                <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-amber-500 font-semibold">
                  请完善统一模型的 Base URL、API Key 与模型名称后再保存。
                </p>
              </div>
            )}
          </div>
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
  testStatus: 'idle' | 'testing' | 'success' | 'error';
  setTestStatus: (status: 'idle' | 'testing' | 'success' | 'error') => void;
  testMessage: string;
  setTestMessage: (msg: string) => void;
  providerPresets?: typeof PROVIDER_PRESETS;
}

const ProviderForm: React.FC<ProviderFormProps> = ({ config, onChange, customModel, setCustomModel, testStatus, setTestStatus, testMessage, setTestMessage, providerPresets }) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const presets = providerPresets || PROVIDER_PRESETS;

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
            messages: [{ role: 'user', content: '请回复：连接成功' }],
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

      <div className="space-y-3">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">API 基础地址 (Base URL)</label>
        <input
          type="text"
          data-help="填写 OpenAI 兼容接口地址（通常以 /v1 结尾）。统一用于出题、答疑与视觉识别。"
          className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all font-mono"
          placeholder="https://api.example.com/v1"
          value={config.baseURL}
          onChange={(e) => onChange({ ...config, baseURL: e.target.value })}
        />
      </div>

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
            type={showApiKey ? 'text' : 'password'}
            data-help="填写统一 API Key。若使用本地 Ollama 可留空。"
            className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-6 py-4 pr-24 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 focus:bg-white transition-all font-mono"
            placeholder={config.id === 'ollama' ? '本地模型无需 Key（留空即可）' : '输入你的 API Key...'}
            value={config.apiKey}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value.trim() })}
          />
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            data-help="切换 API Key 显示/隐藏状态，仅影响本地输入框展示。"
            className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1.5 text-[10px] font-black text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
          >
            {showApiKey ? '隐藏' : '显示'}
          </button>
        </div>
      </div>

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
          data-help="可手动输入模型名称（覆盖上方选择）。统一用于出题、答疑和图片识别。"
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

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-3">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">温度 (Temp)</label>
          <input
            type="number"
            data-help="温度控制统一模型回答发散度。越低越稳定，越高越灵活。"
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

      <div className="space-y-3">
        <button
          onClick={handleTest}
          data-help="发送一条最小测试请求验证：Base URL、Key 与模型名称是否可用。"
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
