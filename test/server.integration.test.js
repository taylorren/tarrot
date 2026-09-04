// End-to-end regression tests for the critical HTTP behaviors that pure unit
// tests cannot reach: the cooldown (429), concurrent in-flight rejection (409),
// previous-reading lifecycle, and abandoned requests. Each test file runs in its
// own process, so these env vars only affect this one and are set before the
// server module is imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---- Mock Ollama double ------------------------------------------------
// A tiny local HTTP server that stands in for the model: configurable status,
// optional delay, and optional "empty" content. Holds concurrent connections
// just like a real provider would.
const mock = {
  calls: 0,
  status: 200,
  delayMs: 0,
  empty: false,
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const mockServer = http.createServer(async (req, res) => {
  mock.calls += 1;
  await readBody(req);
  const reply = () => {
    if (mock.status >= 400) {
      res.writeHead(mock.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `mock ${mock.status} boom` }));
      return;
    }
    const content = mock.empty
      ? ''
      : JSON.stringify({ reading: '一段来自测试模型的解读', thread: '一个可行的小行动' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { content } }));
  };
  if (mock.delayMs > 0) setTimeout(reply, mock.delayMs);
  else reply();
});
// ---- Boot the real server under test against the mock ------------------
// Isolate log writes so tests never touch the real analytics, and give the
// server a distinct identity source (trusted proxy) we can drive per request.
const mockPort = await new Promise((resolve) => {
  mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port));
});

process.env.NODE_ENV = 'production';
process.env.OLLAMA_API_KEY = 'test-key';
process.env.OLLAMA_URL = `http://127.0.0.1:${mockPort}`;
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tarrot-logs-'));
process.env.TRUST_PROXY = 'true';

const { server, getRateLimitIdentity } = await import('../server/server.js');

const appPort = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const BASE = `http://127.0.0.1:${appPort}`;

const payload = () => ({
  question: '一个需要被照看的问题',
  cards: [
    { index: 0, name: 'The Fool', reversed: false, position: 0 },
    { index: 1, name: 'The Magician', reversed: true, position: 1 },
    { index: 2, name: 'The High Priestess', reversed: false, position: 2 },
  ],
});

const identity = (ip) => getRateLimitIdentity({
  headers: { 'x-forwarded-for': ip },
  socket: { remoteAddress: '127.0.0.1' },
});

function postReading(ip, body = payload(), { signal } = {}) {
  return fetch(`${BASE}/api/reading`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
}

function getWith(ip, route) {
  return fetch(`${BASE}${route}`, { headers: { 'X-Forwarded-For': ip } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The subtests share one server and one mock, so run them sequentially (a
// parent `test` with awaited `t.test` calls) — node:test otherwise runs them
// concurrently and the shared quota/mock state would race.
test('server reading, cooldown, concurrency, previous-reading, and abandonment', async (t) => {
  await t.test('saves a reading, serves previous-reading, and cools down per identity', async () => {
    mock.status = 200;
    mock.delayMs = 0;
    mock.empty = false;

    const first = await postReading('10.0.0.1');
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.match(firstBody.reading, /测试模型/);
    assert.equal(firstBody.quota.used, 1);

    // The same identity is cooled down; a different identity is not.
    const second = await postReading('10.0.0.1');
    assert.equal(second.status, 429);
    const secondBody = await second.json();
    assert.equal(secondBody.quota.used, 1);

    const fresh = await postReading('10.0.0.2');
    assert.equal(fresh.status, 200);

    // The cooled identity can reopen its reading via previous-reading.
    const prev = await getWith('10.0.0.1', '/api/previous-reading');
    assert.equal(prev.status, 200);
    const prevBody = await prev.json();
    assert.equal(prevBody.question, payload().question);

    // An identity with no reading gets a 404.
    const none = await getWith('10.0.0.99', '/api/previous-reading');
    assert.equal(none.status, 404);
  });

  await t.test('rejects a concurrent request racing the same in-flight identity', async () => {
    mock.status = 200;
    mock.delayMs = 400;
    mock.empty = false;
    mock.calls = 0;

    // Start the first (slow) request, then race a second before it completes.
    const firstPromise = postReading('10.0.0.11');
    await sleep(80);
    const second = await postReading('10.0.0.11');
    assert.equal(second.status, 409);

    const first = await firstPromise;
    assert.equal(first.status, 200);
    // The model was called exactly once — the racing request never reached it.
    assert.equal(mock.calls, 1);
  });

  await t.test('treats an aborted request as abandoned: stores nothing, consumes no quota', async () => {
    mock.status = 200;
    mock.delayMs = 600;
    mock.empty = false;

    const abort = new AbortController();
    const ip = '10.0.0.21';
    const pending = postReading(ip, payload(), { signal: abort.signal });
    pending.catch(() => {}); // consume the client-side rejection immediately
    await sleep(100);
    abort.abort();

    // The client is gone; the server should still wait for the model, detect
    // the disconnect, store nothing, and consume no quota.
    await sleep(800);
    const quota = await (await getWith(ip, '/api/quota')).json();
    const prev = await getWith(ip, '/api/previous-reading');

    assert.equal(quota.used, 0, 'abandoned request must not consume quota');
    assert.equal(prev.status, 404, 'abandoned request must not store a reading');
// Stop accepting and drop idle connections so the runner's process can exit
// cleanly after all tests complete.
test.after(async () => {
  for (const s of [server, mockServer]) {
    try { s.closeIdleConnections?.(); } catch (_) { /* ignore */ }
    try { s.close(); } catch (_) { /* ignore */ }
  }
});
  });
});