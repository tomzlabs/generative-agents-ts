import React from 'react';
import { removeFromStorage } from '../core/persistence/storage';
import { STORAGE_KEYS } from '../core/persistence/keys';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    // Keep logging for debug while providing a safe in-app fallback.
    console.error('App runtime error', error);
  }

  private handleClearAndReload = () => {
    removeFromStorage(STORAGE_KEYS.world);
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0f1717',
          color: '#d8efcf',
          fontFamily: '"Press Start 2P", "Space Mono", monospace',
          padding: 20,
        }}
      >
        <div style={{ maxWidth: 760, width: '100%', border: '2px solid #85b86f', background: '#18211f', padding: 18 }}>
          <div style={{ fontSize: 12, marginBottom: 12 }}>系统异常 / Runtime Error</div>
          <div style={{ fontSize: 11, lineHeight: 1.8, opacity: 0.9 }}>
            页面运行时发生错误。你可以先清空地图存档后重载。
          </div>
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, color: '#f5db86' }}>
            {this.state.message || 'Unknown runtime error'}
          </pre>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              type="button"
              onClick={this.handleClearAndReload}
              style={{ border: '2px solid #85b86f', background: '#223729', color: '#d8efcf', padding: '8px 12px', cursor: 'pointer' }}
            >
              清空地图存档并重载
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ border: '2px solid #85b86f', background: '#243336', color: '#d8efcf', padding: '8px 12px', cursor: 'pointer' }}
            >
              仅重载页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
