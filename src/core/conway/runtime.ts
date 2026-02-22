export type ConwaySandboxInfo = {
  id: string;
  status: string;
  url?: string;
  createdAt?: number;
};

// Frontend client for a Conway HTTP gateway.
// The gateway is expected to bridge Conway MCP tool calls (sandbox_create/sandbox_exec/...)
// into REST-style endpoints consumed by this app.

export type ConwayExecInfo = {
  id?: string;
  status: string;
  output?: string;
};

type ConwayApiConfig = {
  mode: 'proxy' | 'direct';
  baseUrl: string;
  apiKey: string;
  projectId: string;
};

type ConwayRequestInit = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, unknown>;
};

function pickEnv(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function getConwayConfig(): ConwayApiConfig {
  const proxyBase = normalizeBaseUrl(pickEnv(import.meta.env.VITE_CONWAY_PROXY_BASE || '/api/conway'));
  const directBase = normalizeBaseUrl(pickEnv(import.meta.env.VITE_CONWAY_API_BASE));
  const directKey = pickEnv(import.meta.env.VITE_CONWAY_API_KEY);
  const projectId = pickEnv(import.meta.env.VITE_CONWAY_PROJECT_ID);
  if (directBase && directKey) {
    return {
      mode: 'direct',
      baseUrl: directBase,
      apiKey: directKey,
      projectId,
    };
  }
  return {
    mode: 'proxy',
    baseUrl: proxyBase,
    apiKey: '',
    projectId: '',
  };
}

export function isConwayConfigured(config = getConwayConfig()): boolean {
  if (config.mode === 'direct') {
    return Boolean(config.baseUrl && config.apiKey);
  }
  return Boolean(config.baseUrl);
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const json = (await response.json()) as unknown;
    if (json && typeof json === 'object') return json as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function pickObject(source: unknown, keys: string[]): Record<string, unknown> | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (value && typeof value === 'object') return value as Record<string, unknown>;
  }
  return obj;
}

function pickString(source: Record<string, unknown> | null, keys: string[]): string {
  if (!source) return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function asSandboxInfo(payload: Record<string, unknown> | null): ConwaySandboxInfo {
  const node = pickObject(payload, ['sandbox', 'data', 'result']) ?? payload;
  const id = pickString(node, ['id', 'sandboxId', 'sandbox_id']);
  const status = pickString(node, ['status', 'state']) || 'unknown';
  const url = pickString(node, ['url', 'publicUrl', 'domain']) || undefined;
  const createdAt = pickNumber(node, ['createdAt', 'created_at', 'createdAtMs']);
  if (!id) {
    throw new Error('Conway sandbox response missing id');
  }
  return { id, status, url, createdAt };
}

function asExecInfo(payload: Record<string, unknown> | null): ConwayExecInfo {
  const node = pickObject(payload, ['exec', 'execution', 'run', 'data', 'result']) ?? payload;
  const id = pickString(node, ['id', 'runId', 'executionId']) || undefined;
  const status = pickString(node, ['status', 'state']) || 'accepted';
  const output = pickString(node, ['output', 'stdout', 'message']) || undefined;
  return { id, status, output };
}

export class ConwayRuntimeService {
  private config: ConwayApiConfig;

  constructor(config = getConwayConfig()) {
    this.config = config;
  }

  getConfig(): ConwayApiConfig {
    return this.config;
  }

  isConfigured(): boolean {
    return isConwayConfigured(this.config);
  }

  private async request(path: string, init: ConwayRequestInit = {}): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) {
      throw new Error('Conway runtime is not configured');
    }
    const method = init.method ?? 'GET';
    const headers: HeadersInit = {
      Accept: 'application/json',
    };
    if (this.config.mode === 'direct') {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    if (init.body) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const payload = await readJsonSafe(response);
    if (!response.ok) {
      const msg = pickString(payload, ['message', 'error', 'detail']) || `${response.status} ${response.statusText}`;
      throw new Error(`Conway API error: ${msg}`);
    }
    return payload;
  }

  async createSandbox(input: {
    name?: string;
    image?: string;
    port?: number;
    startupCommand?: string;
    metadata?: Record<string, unknown>;
  } = {}): Promise<ConwaySandboxInfo> {
    const payload: Record<string, unknown> = {
      name: input.name ?? `aitown-agent-${Date.now()}`,
      image: input.image ?? 'node:20',
      metadata: {
        source: 'aitown',
        ...input.metadata,
      },
    };
    if (this.config.projectId) payload.projectId = this.config.projectId;
    if (input.port) payload.port = input.port;
    if (input.startupCommand) payload.startupCommand = input.startupCommand;
    const json = await this.request('/sandboxes', { method: 'POST', body: payload });
    return asSandboxInfo(json);
  }

  async getSandbox(sandboxId: string): Promise<ConwaySandboxInfo> {
    if (!sandboxId) throw new Error('sandboxId required');
    const json = await this.request(`/sandboxes/${sandboxId}`, { method: 'GET' });
    return asSandboxInfo(json);
  }

  async stopSandbox(sandboxId: string): Promise<ConwaySandboxInfo> {
    if (!sandboxId) throw new Error('sandboxId required');
    try {
      const json = await this.request(`/sandboxes/${sandboxId}/stop`, { method: 'POST' });
      return asSandboxInfo(json);
    } catch (error) {
      const msg = String(error instanceof Error ? error.message : error).toLowerCase();
      if (!msg.includes('404')) throw error;
      const json = await this.request(`/sandboxes/${sandboxId}`, { method: 'DELETE' });
      return asSandboxInfo(json);
    }
  }

  async runAgentLoop(sandboxId: string, input: {
    command?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConwayExecInfo> {
    if (!sandboxId) throw new Error('sandboxId required');
    const payload: Record<string, unknown> = {
      command: input.command ?? 'node agent-runner.js',
      message: input.message,
      metadata: {
        source: 'aitown',
        ...input.metadata,
      },
    };
    const json = await this.request(`/sandboxes/${sandboxId}/exec`, { method: 'POST', body: payload });
    return asExecInfo(json);
  }
}

export function createConwayRuntimeService(): ConwayRuntimeService {
  return new ConwayRuntimeService(getConwayConfig());
}
