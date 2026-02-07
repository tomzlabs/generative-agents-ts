import { useMemo, useState } from 'react';
import type { AppSettings } from '../core/settings/types';

export function SettingsPanel(props: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onResetWorld: () => void;
  onClearKey: () => void;
}) {
  const { settings, onChange, onResetWorld, onClearKey } = props;

  const [show, setShow] = useState(false);

  const maskedKey = useMemo(() => {
    const k = settings.llm.apiKey;
    if (!k) return '(empty)';
    if (k.length <= 8) return '*'.repeat(k.length);
    return `${k.slice(0, 3)}…${k.slice(-4)}`;
  }, [settings.llm.apiKey]);

  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={() => setShow((v) => !v)}>{show ? 'Hide Settings' : 'Show Settings'}</button>
      {show ? (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#0b1020',
            color: '#e5e7eb',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>LLM (OpenAI-compatible)</div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '140px 1fr', alignItems: 'center' }}>
            <div style={{ opacity: 0.85 }}>baseURL</div>
            <input
              value={settings.llm.baseURL}
              onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, baseURL: e.target.value } })}
              placeholder="https://api.openai.com/v1"
              style={{ padding: 6 }}
            />

            <div style={{ opacity: 0.85 }}>model</div>
            <input
              value={settings.llm.model}
              onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, model: e.target.value } })}
              placeholder="gpt-4o-mini"
              style={{ padding: 6 }}
            />

            <div style={{ opacity: 0.85 }}>apiKey</div>
            <input
              value={settings.llm.apiKey}
              onChange={(e) => onChange({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })}
              placeholder="paste your key"
              style={{ padding: 6 }}
            />
          </div>

          <div style={{ marginTop: 10, fontFamily: 'ui-monospace', fontSize: 12, opacity: 0.9 }}>
            stored in localStorage only · current: {maskedKey}
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={onClearKey}>Clear apiKey</button>
            <button onClick={onResetWorld}>Reset world (clear saved state)</button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            Note: Frontend direct LLM calls expose the key to the browser. For better security, switch to a server proxy later.
          </div>
        </div>
      ) : null}
    </div>
  );
}
