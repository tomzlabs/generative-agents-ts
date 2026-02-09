import { useMemo, useState, useEffect } from 'react';
import type { AppSettings, LLMProvider } from '../core/settings/types';

const PROVIDERS: { label: string; value: LLMProvider; defaultBaseURL: string; models: string[] }[] = [
  {
    label: 'OpenAI',
    value: 'openai',
    defaultBaseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  {
    label: 'Ollama (Local)',
    value: 'ollama',
    defaultBaseURL: 'http://localhost:11434/v1',
    models: ['llama3', 'mistral', 'gemma', 'deepseek-coder']
  },
  {
    label: 'DeepSeek',
    value: 'deepseek',
    defaultBaseURL: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-coder']
  },
  {
    label: 'Custom / Other',
    value: 'custom',
    defaultBaseURL: '',
    models: []
  }
];

export function SettingsPanel(props: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onResetWorld: () => void;
  onClearKey: () => void;
}) {
  const { settings, onChange, onResetWorld, onClearKey } = props;
  const [show, setShow] = useState(false);

  // Auto-detect provider if missing (migration)
  useEffect(() => {
    if (!settings.llm.provider) {
      onChange({ ...settings, llm: { ...settings.llm, provider: 'openai' } });
    }
  }, [settings.llm.provider]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value as LLMProvider;
    const providerConfig = PROVIDERS.find(p => p.value === newProvider);

    onChange({
      ...settings,
      llm: {
        ...settings.llm,
        provider: newProvider,
        baseURL: providerConfig?.defaultBaseURL || settings.llm.baseURL,
        model: providerConfig?.models[0] || settings.llm.model
      }
    });
  };

  const maskedKey = useMemo(() => {
    const k = settings.llm.apiKey;
    if (!k) return '(empty)';
    if (k.length <= 8) return '*'.repeat(k.length);
    return `${k.slice(0, 3)}…${k.slice(-4)}`;
  }, [settings.llm.apiKey]);

  const currentProviderConfig = PROVIDERS.find(p => p.value === settings.llm.provider);

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setShow((v) => !v)}
        style={{
          background: '#f8ffde',
          color: '#355537',
          border: '2px solid #7ea46a',
          padding: '8px 16px',
          fontFamily: "'Press Start 2P', cursive",
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.12)'
        }}
      >
        {show ? '[_] HIDE CONFIG' : '[+] SYSTEM CONFIG'}
      </button>

      {show ? (
        <div
          style={{
            marginTop: 10,
            padding: 20,
            border: '2px solid #7ea46a',
            borderRadius: 6,
            background: 'rgba(244, 255, 217, 0.96)',
            color: '#2f4a31',
            boxShadow: '0 8px 18px rgba(64, 109, 66, 0.12)'
          }}
        >
          <div style={{
            fontWeight: 600,
            marginBottom: 16,
            color: '#3e6541',
            borderBottom: '1px solid #7ea46a',
            paddingBottom: 8,
            fontSize: '0.9em',
            letterSpacing: '2px'
          }}>
            NEURAL LINK CONFIGURATION
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(100px, 140px) 1fr', alignItems: 'center' }}>

            <div style={{ opacity: 0.7, fontFamily: 'monospace' }}>PROVIDER</div>
            <select
              value={settings.llm.provider || 'openai'}
              onChange={handleProviderChange}
              style={{
                padding: 8,
                background: '#fffef0',
                color: '#2f4a31',
                border: '1px solid #88ad75',
                borderRadius: 4,
                width: '100%'
              }}
            >
              {PROVIDERS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            <div style={{ opacity: 0.7, fontFamily: 'monospace' }}>ENDPOINT</div>
            <input
              value={settings.llm.baseURL}
              onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, baseURL: e.target.value } })}
              placeholder="https://api.openai.com/v1"
              style={{ padding: 8, background: '#fffef0', border: '1px solid #88ad75', color: '#2f4a31', borderRadius: 4, fontFamily: 'monospace' }}
            />

            <div style={{ opacity: 0.7, fontFamily: 'monospace' }}>MODEL</div>
            <div>
              <input
                list="model-suggestions"
                value={settings.llm.model}
                onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, model: e.target.value } })}
                placeholder="gpt-4o-mini"
                style={{ padding: 8, background: '#fffef0', border: '1px solid #88ad75', color: '#2f4a31', borderRadius: 4, width: '100%', fontFamily: 'monospace' }}
              />
              <datalist id="model-suggestions">
                {currentProviderConfig?.models.map(m => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>

            <div style={{ opacity: 0.7, fontFamily: 'monospace' }}>API KEY</div>
            <input
              value={settings.llm.apiKey}
              onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })}
              placeholder="sk-..."
              type="password"
              style={{ padding: 8, background: '#fffef0', border: '1px solid #88ad75', color: '#2f4a31', borderRadius: 4, fontFamily: 'monospace' }}
            />
          </div>

          <div style={{ marginTop: 16, fontFamily: 'monospace', fontSize: 11, color: '#5f7e5f' }}>
            STATUS: {maskedKey !== '(empty)' ? 'KEY_LOADED' : 'NO_KEY_DETECTED'}
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap', borderTop: '1px solid #7ea46a', paddingTop: 16 }}>
            <button
              onClick={onClearKey}
              style={{
                background: '#fff4ef',
                border: '1px solid #d46c56',
                color: '#a2402e',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '0.8em',
                fontFamily: 'monospace'
              }}
            >
              PURGE CREDENTIALS
            </button>
            <button
              onClick={onResetWorld}
              style={{
                background: '#fff8e6',
                border: '1px solid #c9a24b',
                color: '#8e6f2b',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '0.8em',
                fontFamily: 'monospace'
              }}
            >
              RESET SIMULATION
            </button>
          </div>

          <div style={{ marginTop: 12, fontSize: 10, color: '#5f7e5f', fontFamily: 'monospace' }}>
            WARNING: Credentials stored in local browser storage. Avoid using on public terminals.
          </div>
        </div>
      ) : null}
    </div>
  );
}
