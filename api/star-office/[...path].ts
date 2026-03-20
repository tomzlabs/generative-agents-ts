type ReqLike = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  url?: string;
};

type ResLike = {
  status: (code: number) => ResLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

const ALLOWED_METHODS = new Set(['GET', 'POST', 'OPTIONS']);
const ALLOWED_PATHS = new Set(['status', 'agents', 'join-agent', 'agent-push', 'leave-agent', 'office-chat', 'npc-chat']);

function pickEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: string): string {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getPathFromQuery(query: ReqLike['query']): string {
  const raw = query?.path;
  if (Array.isArray(raw)) return raw.filter(Boolean).join('/');
  return typeof raw === 'string' ? raw : '';
}

function getPathFromUrl(url: string | undefined): string {
  if (!url) return '';
  const pathname = url.split('?')[0] || '';
  const prefix = '/api/star-office/';
  if (!pathname.startsWith(prefix)) return '';
  return pathname.slice(prefix.length);
}

function sanitizePath(path: string): string {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== '.' && segment !== '..')
    .join('/');
}

function bodyToText(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

export default async function handler(req: ReqLike, res: ResLike) {
  const method = (req.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,POST,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
    return;
  }

  const upstreamBase = normalizeBaseUrl(pickEnv('STAR_OFFICE_API_BASE'));
  if (!upstreamBase) {
    res.status(500).json({
      error: 'Star Office proxy is not configured on server',
      required: ['STAR_OFFICE_API_BASE'],
    });
    return;
  }

  const rawPath = getPathFromQuery(req.query) || getPathFromUrl(req.url);
  const safePath = sanitizePath(rawPath);
  if (!safePath || !ALLOWED_PATHS.has(safePath)) {
    res.status(400).json({ error: 'Invalid Star Office path' });
    return;
  }

  try {
    const upstream = await fetch(`${upstreamBase}/${safePath}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? bodyToText(req.body) : undefined,
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (text) {
      res.send(text);
      return;
    }
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({
      error: 'Star Office upstream request failed',
      message,
    });
  }
}
