type ReqLike = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ResLike = {
  status: (code: number) => ResLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE', 'OPTIONS']);

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
  if (Array.isArray(raw)) {
    return raw.filter(Boolean).join('/');
  }
  return typeof raw === 'string' ? raw : '';
}

function sanitizePath(path: string): string {
  return path
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p !== '.' && p !== '..')
    .join('/');
}

function isAllowedPath(path: string): boolean {
  return path === 'sandboxes' || path.startsWith('sandboxes/');
}

function bodyToObject(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      return {};
    } catch {
      return {};
    }
  }
  if (typeof body === 'object') return body as Record<string, unknown>;
  return {};
}

export default async function handler(req: ReqLike, res: ResLike) {
  const method = (req.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
    return;
  }

  const conwayBase = normalizeBaseUrl(pickEnv('CONWAY_API_BASE'));
  const conwayKey = pickEnv('CONWAY_API_KEY');
  const conwayProjectId = pickEnv('CONWAY_PROJECT_ID');

  if (!conwayBase || !conwayKey) {
    res.status(500).json({
      error: 'Conway proxy is not configured on server',
      required: ['CONWAY_API_BASE', 'CONWAY_API_KEY'],
    });
    return;
  }

  const rawPath = getPathFromQuery(req.query);
  const safePath = sanitizePath(rawPath);
  if (!safePath || !isAllowedPath(safePath)) {
    res.status(400).json({ error: 'Invalid Conway path' });
    return;
  }

  const targetUrl = `${conwayBase}/${safePath}`;
  let bodyText: string | undefined;
  if (method !== 'GET' && method !== 'DELETE') {
    const payload = bodyToObject(req.body);
    if (conwayProjectId && safePath === 'sandboxes' && method === 'POST' && !payload.projectId) {
      payload.projectId = conwayProjectId;
    }
    bodyText = JSON.stringify(payload);
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${conwayKey}`,
        ...(bodyText ? { 'Content-Type': 'application/json' } : {}),
      },
      body: bodyText,
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    if (text) {
      res.send(text);
      return;
    }
    res.end();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(502).json({
      error: 'Conway upstream request failed',
      message: msg,
    });
  }
}
