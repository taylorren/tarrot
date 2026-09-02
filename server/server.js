// server/server.js — Ollama cloud proxy + optional production static server.
//
// In development the Vite dev server (:5173) proxies `/api/*` here (:8787), so
// the OLLAMA_API_KEY never leaves the server. In production it also serves the
// built `dist/` output.
//
// Run:  npm run server    (or: node server/server.js)

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__here, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = process.env.PORT || 8787;
const OLLAMA_CHAT = 'https://ollama.com/api/chat';

// ---- Minimal .env loader (no dependencies) -------------------------------
function loadEnv() {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch (_) { /* .env optional */ }
}
loadEnv();

const API_KEY = process.env.OLLAMA_API_KEY || '';
// Direct ollama.com calls use the plain model name; "-cloud" is local-only.
const MODEL = (process.env.OLLAMA_MODEL || 'gpt-oss:20b').replace(/-cloud$/, '');
const HAS_DIST = fs.existsSync(path.join(DIST, 'index.html'));
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { chunks.push(c); size += c.length; if (size > 64 * 1024) { req.destroy(); reject(new Error('Body too large')); } });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); // decode once — keeps multi-byte chars intact
    req.on('error', reject);
  });
}

// ---- Anonymous identity (cookie first, hashed-IP fallback) ---------------
const COOKIE_NAME = 'tarrot_id';
const COOKIE_MAX_AGE = 31536000; // 1 year

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Resolve (and if needed issue) the anonymous client id. */
function getClientId(req, res) {
  const existing = getCookie(req, COOKIE_NAME);
  if (existing && /^[a-f0-9-]{36}$/.test(existing)) return existing;
  const id = crypto.randomUUID();
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${id}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`);
  return id;
}

/** Never store raw IPs — hash them. Enough to count unique visitors per day. */
function ipHash(req) {
  const ip = (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// ---- Daily quota ----------------------------------------------------------
const QUOTA_LIMIT = Number(process.env.DAILY_LIMIT || 3);

function quotaSnapshot(used, resetAt) {
  return { used, limit: IS_PRODUCTION ? QUOTA_LIMIT : null, resetAt };
}

/** Local-day key for the client (browser sends its timezone offset in minutes). */
function localDay(tzOffsetMinutes) {
  const tz = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : -new Date().getTimezoneOffset();
  const shifted = new Date(Date.now() - tz * 60000);
  return {
    day: shifted.toISOString().slice(0, 10),
    resetAt: Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) + 86400000 + tz * 60000,
  };
}

// Usage index: clientId -> Map(day -> successful count). The JSONL log is the
// source of truth; this index is rebuilt from it on boot and updated in memory.
const LOG_DIR = path.join(ROOT, 'logs');
const usageIndex = new Map();

function loadUsage() {
  try {
    for (const file of fs.readdirSync(LOG_DIR)) {
      if (!file.startsWith('usage-') || !file.endsWith('.jsonl')) continue;
      for (const line of fs.readFileSync(path.join(LOG_DIR, file), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          if (rec.status !== 'ok' || !rec.clientId || !rec.day) continue;
          if (!usageIndex.has(rec.clientId)) usageIndex.set(rec.clientId, new Map());
          const days = usageIndex.get(rec.clientId);
          days.set(rec.day, (days.get(rec.day) || 0) + 1);
        } catch (_) { /* skip malformed line */ }
      }
    }
  } catch (_) { /* no logs yet */ }
}

function appendLog(record) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const month = record.ts.slice(0, 7);
    fs.appendFileSync(path.join(LOG_DIR, `usage-${month}.jsonl`), JSON.stringify(record) + '\n');
  } catch (err) {
    console.error('[log]', err.message);
  }
}

function quotaFor(clientId, day) {
  return usageIndex.get(clientId)?.get(day) || 0;
}

function recordUsage(clientId, day, delta = 1) {
  if (!usageIndex.has(clientId)) usageIndex.set(clientId, new Map());
  const days = usageIndex.get(clientId);
  days.set(day, (days.get(day) || 0) + delta);
}
loadUsage();

// ---- Static serving (production only) ------------------------------------
function serveStatic(req, res, urlPath) {
  if (!HAS_DIST) return send(res, 404, 'Not found (run `npm run build` first, or use `npm run dev`)', 'text/plain');
  let filePath = path.normalize(path.join(DIST, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(DIST)) return send(res, 403, 'Forbidden', 'text/plain');
  if (filePath.endsWith(path.sep)) filePath = path.join(filePath, 'index.html');
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    // SPA fallback
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
  });
}

// ---- Ollama cloud call (non-streaming, forced JSON) ----------------------
function buildMessages({ question, cards }) {
  const positions = ['此刻的真实', '需要照看的事', '向前的一种方式'];
  const spread = (Array.isArray(cards) ? cards : []).map((c, i) => {
    const orientation = c.reversed ? '逆位' : '正位';
    return `${i + 1}. ${positions[i] || '第' + (i + 1) + '张'} —— ${c.name}（${orientation}）`;
  }).join('\n');

  const system =
    '你是“小小问题”这位温和、敏锐的读牌人——一位不说教、不制造恐惧的塔罗读者。' +
    '你不做算命预言，而是帮助提问者对眼前的处境获得更清晰、更有力量的角度。' +
    '语气安静、具体、有温度。请把三张牌视为一个整体来回应问题本身，' +
    '而不是逐张孤立讲解；注意每张牌的正位/逆位，并把它们的含义真正联系起来。' +
    '请严格输出 JSON 对象，只有两个字段：\n' +
    '1. "reading"：一段约 120–180 字的解读，把问题与三张牌连成一条连贯的线索，' +
    '点出正在发生的、需要照看的地方，以及一种向前的方式；\n' +
    '2. "thread"：一句具体、可执行、非常小的事，今天就做得到（不超过 40 字）。\n' +
    '不要提及自己是 AI，不要使用“命中注定”之类宿命论口吻。直接、诚恳、温暖。';

  const user =
    `问题：${question || '此刻有什么正停留在我心里'}\n\n` +
    `牌阵：\n${spread || '（未提供牌）'}\n\n请给我这次的解读。`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function callOllama(messages) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) return reject(new Error('Missing OLLAMA_API_KEY in .env'));
    const payload = JSON.stringify({ model: MODEL, messages, stream: false, think: false, format: 'json' });
    const req = https.request(OLLAMA_CHAT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${API_KEY}`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8'); // single decode — avoids split multibyte chars
        if (res.statusCode && res.statusCode >= 400) {
          let detail = body;
          try { detail = JSON.parse(body).error || body; } catch (_) {}
          return reject(new Error(`Ollama ${res.statusCode}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
        }
        try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('Bad JSON from Ollama: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Ollama request timed out')); });
    req.write(payload);
    req.end();
  });
}

// Strip markdown fences, then parse the JSON the model was asked to return.
function parseInsight(content) {
  const cleaned = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }
  return { reading: cleaned, thread: '' };
}

async function handleReading(req, res) {
  const clientId = getClientId(req, res);
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (_) { return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' })); }

  const { day, resetAt } = localDay(payload?.tzOffset);
  const used = quotaFor(clientId, day);

  // Server-side gate — the client's localStorage check is only a convenience.
  if (IS_PRODUCTION && used >= QUOTA_LIMIT) {
    appendLog({ ts: new Date().toISOString(), day, status: 'limit_reached', clientId, ipHash: ipHash(req), used });
    return send(res, 429, JSON.stringify({
      error: '今天的解读次数已经用完了。明天这个时候再来，让牌面也休息一下。',
      quota: quotaSnapshot(used, resetAt),
    }));
  }

  const startedAt = Date.now();
  try {
    const raw = await callOllama(buildMessages(payload));
    const content = raw && raw.message && raw.message.content;
    if (!content) throw new Error('Ollama returned an empty response');

    // Fairness: if the user already left ("换一个问题" / closed the tab) while
    // the AI was generating, they never saw a reading — don't deduct.
    if (res.writableEnded || res.destroyed) {
      appendLog({
        ts: new Date().toISOString(), day, status: 'abandoned', clientId, ipHash: ipHash(req),
        model: MODEL, latencyMs: Date.now() - startedAt, used, limit: QUOTA_LIMIT,
      });
      return;
    }

    const insight = parseInsight(content);
    recordUsage(clientId, day);
    appendLog({
      ts: new Date().toISOString(),
      day,
      status: 'ok',
      clientId,
      ipHash: ipHash(req),
      question: String(payload?.question || '').slice(0, 200),
      cards: (Array.isArray(payload?.cards) ? payload.cards : []).map((c) => `${c.name}${c.reversed ? '(R)' : ''}`),
      model: MODEL,
      latencyMs: Date.now() - startedAt,
      promptTokens: raw.prompt_eval_count ?? null,
      completionTokens: raw.eval_count ?? null,
      used: used + 1,
      limit: QUOTA_LIMIT,
    });
    return send(res, 200, JSON.stringify({
      reading: (insight.reading || '').trim(),
      thread: (insight.thread || '').trim(),
      quota: quotaSnapshot(used + 1, resetAt),
    }));
  } catch (err) {
    // Failed calls cost nothing and don't consume quota — but log them.
    appendLog({
      ts: new Date().toISOString(),
      day,
      status: 'error',
      clientId,
      ipHash: ipHash(req),
      model: MODEL,
      latencyMs: Date.now() - startedAt,
      detail: String(err.message || err).slice(0, 200),
      used,
      limit: QUOTA_LIMIT,
    });
    console.error('[reading]', err.message);
    return send(res, 502, JSON.stringify({ error: 'AI 暂时没有回应。请稍后再试。', detail: String(err.message || err) }));
  }
}

// Lightweight pre-flight check — never consumes quota, never calls Ollama.
function handleQuota(req, res) {
  const clientId = getClientId(req, res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { day, resetAt } = localDay(Number(url.searchParams.get('tz')));
  const used = quotaFor(clientId, day);
  return send(res, 200, JSON.stringify(quotaSnapshot(used, resetAt)));
}

// ---- Request router ------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/reading') return handleReading(req, res);
  if (req.method === 'GET' && url.pathname === '/api/quota') return handleQuota(req, res);
  if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  return send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`🌙 小小问题 backend → http://localhost:${PORT}`);
  console.log(`   Ollama model: ${MODEL}${API_KEY ? '' : '  ⚠ 没有 API key（请检查 .env 里的 OLLAMA_API_KEY）'}`);
  if (HAS_DIST) console.log(`   Serving built app from dist/ (production)`);
  else console.log(`   Dev mode: frontend is served by \`npm run dev\` → http://localhost:5173`);
});