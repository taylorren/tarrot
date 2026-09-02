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
const TAROT_KNOWLEDGE_PATH = path.join(__here, 'tarot-knowledge.json');

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
const TAROT_KNOWLEDGE = JSON.parse(fs.readFileSync(TAROT_KNOWLEDGE_PATH, 'utf8'));

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

/** Never store raw IPs — hash them. Enough to distinguish anonymous clients. */
function ipHash(req) {
  const ip = (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// ---- Reading cooldown -----------------------------------------------------
const COOLDOWN_HOURS = Number(process.env.READING_COOLDOWN_HOURS || 4);
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

function quotaSnapshot(lastReadingAt) {
  const resetAt = lastReadingAt + COOLDOWN_MS;
  const coolingDown = Date.now() < resetAt;
  return {
    used: coolingDown ? 1 : 0,
    limit: IS_PRODUCTION ? 1 : null,
    resetAt: coolingDown ? resetAt : 0,
  };
}

// Latest complete reading per client. The JSONL log is the source of truth;
// this index is rebuilt from it on boot and updated in memory.
// Complete readings exist only while their cooldown is active, so the user can
// reopen the prior reading without creating a long-term personal-data archive.
const LOG_DIR = path.join(ROOT, 'logs');
const ACTIVE_READINGS_PATH = path.join(LOG_DIR, 'active-readings.json');
const lastReadingIndex = new Map();

function isActiveReading(reading) {
  return reading && Date.now() < reading.completedAt + COOLDOWN_MS;
}

function saveActiveReadings() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(ACTIVE_READINGS_PATH, JSON.stringify(Object.fromEntries(lastReadingIndex)));
  } catch (err) {
    console.error('[active readings]', err.message);
  }
}

function pruneExpiredReadings() {
  let changed = false;
  for (const [clientId, reading] of lastReadingIndex) {
    if (!isActiveReading(reading)) {
      lastReadingIndex.delete(clientId);
      changed = true;
    }
  }
  if (changed) saveActiveReadings();
}

function loadActiveReadings() {
  try {
    const stored = JSON.parse(fs.readFileSync(ACTIVE_READINGS_PATH, 'utf8'));
    for (const [clientId, reading] of Object.entries(stored)) {
      if (
        typeof reading?.completedAt !== 'number' || typeof reading.question !== 'string' ||
        !Array.isArray(reading.cards) || reading.cards.length !== 3 ||
        typeof reading.reading !== 'string' || typeof reading.thread !== 'string'
      ) continue;
      if (isActiveReading(reading)) lastReadingIndex.set(clientId, reading);
    }
  } catch (_) { /* no logs yet */ }
}

function appendLog(record) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const month = record.ts.slice(0, 7);
    fs.appendFileSync(path.join(LOG_DIR, `usage-${month}.jsonl`), JSON.stringify({ ...record, environment: IS_PRODUCTION ? 'production' : 'development' }) + '\n');
  } catch (err) {
    console.error('[log]', err.message);
  }
}

function lastReadingFor(clientId) {
  return lastReadingIndex.get(clientId) || null;
}
loadActiveReadings();
pruneExpiredReadings();
setInterval(pruneExpiredReadings, 60_000).unref();

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
  const spread = (Array.isArray(cards) ? cards : []).map((card, i) => {
    const orientation = card.reversed ? '逆位' : '正位';
    const knowledge = TAROT_KNOWLEDGE[card.name];
    const meaning = knowledge
      ? `\n   参考关键词：${knowledge.keywords.join('、')}\n   ${orientation}参考：${card.reversed ? knowledge.reversed : knowledge.upright}`
      : '';
    return `${i + 1}. ${positions[i] || '第' + (i + 1) + '张'} —— ${card.name}（${orientation}）${meaning}`;
  }).join('\n');

  const system =
    '你是“小小问题”这位温和、敏锐的读牌人——一位不说教、不制造恐惧的塔罗读者。' +
    '你不做算命预言，而是帮助提问者对眼前的处境获得更清晰、更有力量的角度。' +
    '语气安静、具体、有温度。请把三张牌视为一个整体来回应问题本身，' +
    '而不是逐张孤立讲解；注意每张牌的正位/逆位，并把它们的含义真正联系起来。' +
    '牌阵中会提供牌义参考，请以它为基础进行综合，不要逐字复述或逐张列出。' +
    '不要虚构牌面图像、场景、人物、物件或象征细节；除牌名外，不要描述牌面。' +
    '不要把牌义写成确定的事实、预言，或把提问者置于未经其提供的具体场景中。' +
    '不要重复问题，不要用“第一张”“第二张”“第三张”依次讲牌。' +
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
  try { return { ...JSON.parse(cleaned), validJson: true }; } catch (_) { /* fall through */ }
  return { reading: cleaned, thread: '', validJson: false };
}

async function handleReading(req, res) {
  const clientId = getClientId(req, res);
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (_) { return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' })); }

  const previousReading = lastReadingFor(clientId);
  const quota = quotaSnapshot(previousReading?.completedAt || 0);

  // Server-side gate — the client's localStorage check is only a convenience.
  if (IS_PRODUCTION && quota.used >= quota.limit) {
    appendLog({ ts: new Date().toISOString(), status: 'cooldown', clientId, ipHash: ipHash(req), resetAt: quota.resetAt });
    return send(res, 429, JSON.stringify({
      error: '这次解读刚刚落下，四小时后再带着新的问题回来吧。',
      quota,
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
        ts: new Date().toISOString(), status: 'abandoned', clientId, ipHash: ipHash(req),
        model: MODEL, latencyMs: Date.now() - startedAt,
      });
      return;
    }

    const insight = parseInsight(content);
    const completedAt = Date.now();
    const reading = (insight.reading || '').trim();
    const thread = (insight.thread || '').trim();
    const cards = (Array.isArray(payload?.cards) ? payload.cards : []).map((card, position) => ({
      index: Number.isInteger(card?.index) ? card.index : undefined,
      name: String(card?.name || ''),
      reversed: !!card?.reversed,
      position,
    }));
    const grounding = cards.map((card) => ({
      name: card.name,
      orientation: card.reversed ? 'reversed' : 'upright',
      knowledgeFound: !!TAROT_KNOWLEDGE[card.name],
    }));
    const completedReading = {
      completedAt,
      question: String(payload?.question || '').slice(0, 200),
      cards,
      reading,
      thread,
    };
    lastReadingIndex.set(clientId, completedReading);
    saveActiveReadings();
    appendLog({
      ts: new Date(completedAt).toISOString(),
      status: 'ok',
      clientId,
      ipHash: ipHash(req),
      model: MODEL,
      latencyMs: Date.now() - startedAt,
      promptTokens: raw.prompt_eval_count ?? null,
      completionTokens: raw.eval_count ?? null,
      cooldownHours: COOLDOWN_HOURS,
      grounding,
      validJson: insight.validJson,
      readingLength: reading.length,
      threadLength: thread.length,
    });
    console.info('[reading]', JSON.stringify({
      model: MODEL,
      grounding,
      validJson: insight.validJson,
      readingLength: reading.length,
      threadLength: thread.length,
    }));
    return send(res, 200, JSON.stringify({
      reading,
      thread,
      quota: quotaSnapshot(completedAt),
    }));
  } catch (err) {
    // Failed calls cost nothing and don't consume quota — but log them.
    appendLog({
      ts: new Date().toISOString(),
      status: 'error',
      clientId,
      ipHash: ipHash(req),
      model: MODEL,
      latencyMs: Date.now() - startedAt,
      detail: String(err.message || err).slice(0, 200),
    });
    console.error('[reading]', err.message);
    return send(res, 502, JSON.stringify({ error: 'AI 暂时没有回应。请稍后再试。', detail: String(err.message || err) }));
  }
}

// Lightweight pre-flight check — never consumes quota, never calls Ollama.
function handleQuota(req, res) {
  const clientId = getClientId(req, res);
  return send(res, 200, JSON.stringify(quotaSnapshot(lastReadingFor(clientId)?.completedAt || 0)));
}

function handlePreviousReading(req, res) {
  const clientId = getClientId(req, res);
  const previousReading = lastReadingFor(clientId);
  const quota = quotaSnapshot(previousReading?.completedAt || 0);
  if (!previousReading || !IS_PRODUCTION || !quota.used) {
    return send(res, 404, JSON.stringify({ error: 'No active reading' }));
  }
  return send(res, 200, JSON.stringify({
    question: previousReading.question,
    cards: previousReading.cards,
    reading: previousReading.reading,
    thread: previousReading.thread,
    quota,
  }));
}

// ---- Request router ------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/reading') return handleReading(req, res);
  if (req.method === 'GET' && url.pathname === '/api/quota') return handleQuota(req, res);
  if (req.method === 'GET' && url.pathname === '/api/previous-reading') return handlePreviousReading(req, res);
  if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  return send(res, 404, 'Not found', 'text/plain');
});

server.listen(PORT, () => {
  console.log(`🌙 小小问题 backend → http://localhost:${PORT}`);
  console.log(`   Ollama model: ${MODEL}${API_KEY ? '' : '  ⚠ 没有 API key（请检查 .env 里的 OLLAMA_API_KEY）'}`);
  if (HAS_DIST) console.log(`   Serving built app from dist/ (production)`);
  else console.log(`   Dev mode: frontend is served by \`npm run dev\` → http://localhost:5173`);
});