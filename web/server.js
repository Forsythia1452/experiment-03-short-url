import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function validateLongUrl(value) {
  if (!value || typeof value !== 'string') throw new AppError(400, '请输入长网址');
  if (value.length > 2048) throw new AppError(400, '网址不能超过 2048 个字符');
  let parsed;
  try { parsed = new URL(value); } catch { throw new AppError(400, '网址格式不正确'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new AppError(400, '仅允许 HTTP 或 HTTPS 协议');
  if (!parsed.hostname) throw new AppError(400, '网址必须包含主机名');
  return parsed.toString();
}

export function validateAlias(value) {
  if (value == null || value === '') return undefined;
  if (!/^[A-Za-z0-9_-]{4,30}$/.test(value)) {
    throw new AppError(400, '自定义短码须为 4-30 位字母、数字、下划线或连字符');
  }
  return value;
}

export function validateExpiry(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new AppError(400, '有效期必须是未来时间');
  }
  return date.toISOString();
}

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class ShlinkStore {
  constructor({ baseUrl, publicUrl, apiKey, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }
  async request(route, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${route}`, {
      ...options,
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(5000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 409 ? '该短码已存在，请更换' : (body.detail || body.title || 'Shlink 服务请求失败');
      throw new AppError(response.status === 409 ? 409 : 502, message);
    }
    return body;
  }
  async create({ longUrl, customSlug, validUntil }) {
    const body = { longUrl };
    if (customSlug) body.customSlug = customSlug;
    if (validUntil) body.validUntil = validUntil;
    const item = await this.request('/rest/v3/short-urls', { method: 'POST', body: JSON.stringify(body) });
    return normalizeItem(item, this.publicUrl);
  }
  async list() {
    const body = await this.request('/rest/v3/short-urls?itemsPerPage=100&orderBy=-dateCreated');
    return (body.shortUrls?.data || []).map((x) => normalizeItem(x, this.publicUrl));
  }
  async visits(code) {
    const body = await this.request(`/rest/v3/short-urls/${encodeURIComponent(code)}/visits`);
    return { count: body.visits?.pagination?.totalItems ?? 0, visits: body.visits?.data || [] };
  }
  async health() {
    const response = await this.fetch(`${this.baseUrl}/rest/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  }
}

class DemoStore {
  constructor(dbPath, publicUrl) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        code TEXT PRIMARY KEY, long_url TEXT NOT NULL, created_at TEXT NOT NULL,
        valid_until TEXT, visits INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS visit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, visited_at TEXT NOT NULL
      );
    `);
  }
  async create({ longUrl, customSlug, validUntil }) {
    const code = customSlug || randomBytes(4).toString('base64url').slice(0, 6);
    try {
      this.db.prepare('INSERT INTO links(code,long_url,created_at,valid_until) VALUES(?,?,?,?)')
        .run(code, longUrl, new Date().toISOString(), validUntil || null);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new AppError(409, '该短码已存在，请更换');
      throw error;
    }
    return this.get(code);
  }
  get(code) {
    const row = this.db.prepare('SELECT * FROM links WHERE code=?').get(code);
    if (!row) return null;
    return {
      shortCode: row.code, shortUrl: `${this.publicUrl}/s/${row.code}`, longUrl: row.long_url,
      dateCreated: row.created_at, validUntil: row.valid_until, visitsCount: row.visits
    };
  }
  async list() {
    return this.db.prepare('SELECT * FROM links ORDER BY created_at DESC').all().map((row) => ({
      shortCode: row.code, shortUrl: `${this.publicUrl}/s/${row.code}`, longUrl: row.long_url,
      dateCreated: row.created_at, validUntil: row.valid_until, visitsCount: row.visits
    }));
  }
  async visits(code) {
    const item = this.get(code);
    if (!item) throw new AppError(404, '短码不存在');
    return { count: item.visitsCount, visits: this.db.prepare('SELECT visited_at AS date FROM visit_log WHERE code=? ORDER BY id DESC').all(code) };
  }
  async resolve(code) {
    const item = this.get(code);
    if (!item) throw new AppError(404, '短码不存在');
    if (item.validUntil && new Date(item.validUntil).getTime() <= Date.now()) throw new AppError(410, '短链已过期');
    this.db.prepare('UPDATE links SET visits=visits+1 WHERE code=?').run(code);
    this.db.prepare('INSERT INTO visit_log(code,visited_at) VALUES(?,?)').run(code, new Date().toISOString());
    return item.longUrl;
  }
  async health() { return true; }
  close() { this.db.close(); }
}

function normalizeItem(item, publicUrl) {
  const shortCode = item.shortCode;
  return {
    shortCode,
    shortUrl: item.shortUrl || `${publicUrl}/${shortCode}`,
    longUrl: item.longUrl,
    dateCreated: item.dateCreated,
    validUntil: item.validUntil || null,
    visitsCount: item.visitsSummary?.total ?? item.visitsCount ?? 0
  };
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new AppError(413, '请求内容过大');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new AppError(400, '请求 JSON 格式错误'); }
}

function createRateLimiter(maxPerMinute) {
  const clients = new Map();
  return (req) => {
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = clients.get(key);
    if (!current || now - current.start >= 60_000) {
      clients.set(key, { start: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maxPerMinute) throw new AppError(429, '创建过于频繁，请稍后再试');
  };
}

export function createServer(options = {}) {
  const demoMode = options.demoMode ?? process.env.DEMO_MODE === 'true' ?? false;
  const port = Number(options.port ?? process.env.WEB_PORT ?? 8501);
  const publicUrl = options.publicUrl ?? process.env.SHLINK_PUBLIC_URL ?? `http://localhost:${port}`;
  const store = options.store ?? (demoMode
    ? new DemoStore(options.dbPath ?? process.env.DEMO_DB_PATH ?? path.join(__dirname, '..', 'data', 'shortlinks.db'), publicUrl)
    : new ShlinkStore({ baseUrl: process.env.SHLINK_BASE_URL ?? 'http://shlink:8080', publicUrl, apiKey: process.env.SHLINK_API_KEY ?? '' }));
  const limitCreate = createRateLimiter(Number(options.rateLimit ?? process.env.RATE_LIMIT_PER_MINUTE ?? 10));
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'", 'X-Content-Type-Options': 'nosniff' });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        const healthy = await store.health();
        return json(res, healthy ? 200 : 503, { status: healthy ? 'pass' : 'fail', mode: demoMode ? 'demo' : 'shlink' });
      }
      if (req.method === 'GET' && url.pathname === '/api/short-urls') return json(res, 200, { data: await store.list() });
      if (req.method === 'POST' && url.pathname === '/api/short-urls') {
        limitCreate(req);
        const body = await readJson(req);
        const created = await store.create({
          longUrl: validateLongUrl(body.longUrl),
          customSlug: validateAlias(body.customSlug),
          validUntil: validateExpiry(body.validUntil)
        });
        return json(res, 201, created);
      }
      const visitMatch = url.pathname.match(/^\/api\/short-urls\/([^/]+)\/visits$/);
      if (req.method === 'GET' && visitMatch) return json(res, 200, await store.visits(decodeURIComponent(visitMatch[1])));
      const shortMatch = demoMode && url.pathname.match(/^\/s\/([^/]+)$/);
      if (req.method === 'GET' && shortMatch) {
        const target = await store.resolve(decodeURIComponent(shortMatch[1]));
        res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
        return res.end();
      }
      throw new AppError(404, '页面或接口不存在');
    } catch (error) {
      const status = error instanceof AppError ? error.status : (error.name === 'TimeoutError' ? 504 : 500);
      if (status >= 500) console.error(error);
      if (req.headers.accept?.includes('text/html') && !url.pathname.startsWith('/api/')) {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<meta charset="utf-8"><title>访问失败</title><style>body{font:18px system-ui;margin:15vh auto;max-width:520px;padding:24px}a{color:#4f46e5}</style><h1>${status}</h1><p>${escapeHtml(error.message || '服务异常')}</p><a href="/">返回管理页</a>`);
      }
      return json(res, status, { error: error.message || '服务异常' });
    }
  });
  return { server, store, port };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, port } = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Web service listening on http://localhost:${port}`));
}

export { AppError, DemoStore, ShlinkStore };

