# 小小问题 (Tarrot)

> *This project is dedicated to my late parents, for their love and inspiration.*

> **A gentle daily tarot practice.** Ask one honest question, flip three cards,
> and receive a quiet, specific, and warm reading — with an AI-generated insight
> about your question, grounded in the three cards you actually drew (including
> whether each is upright or reversed).

The insight is generated dynamically by an **Ollama cloud model** running on the
server, so the API key never reaches the browser. Cards are drawn locally; the
AI is only asked — and only billed — after the third card is flipped.

- **Frontend:** Vue 3 · Vite · TypeScript
- **Backend:** zero-dependency Node HTTP server (Ollama cloud proxy + optional
  production static hosting)
- **Cards:** 78-card Rider–Waite deck, served as compact WebP assets

---

## ✨ Features

- **Three-card spread** with three meaningful positions (`此刻的真实`, `需要照看的事`,
  `向前的一种方式`), each card randomly drawn upright or reversed at the moment it's
  flipped.
- **Human‑first, AI‑as‑companion:** every card carries its own gentle guidance and
  a manually curated reflection; the AI synthesizes the reading only after the
  spread is complete.
- **Fair billing:** a reading is only requested from the model *after* the third
  card is revealed, so users never pay for an insight they didn't see.
- **Server-side quota:** a four-hour cooldown enforces one paid reading per
  identity, keyed by an anonymous hashed IP (no accounts, no cookies to reset).
- **Privacy by default:** no raw IPs or personal data stored; previous readings
  and usage logs live in a git-ignored `logs/` directory and expire automatically.
- **Graceful degradation:** if the model is slow or fails, the hand-written card
  reminders remain available with a retry — not a dead end.

---

## 🚀 Quick start

### 1. Prerequisites

- **Node.js ≥ 20** (the project uses native `node --test` and zero npm
  runtime dependencies)
- An **Ollama cloud API key** from [ollama.com/settings/keys](https://ollama.com/settings/keys)

### 2. Configure

Create a `.env` at the project root (already in `.gitignore`):

```env
# Required — create a fresh key at https://ollama.com/settings/keys
OLLAMA_API_KEY=your-key-here

# Optional — model name (default: gpt-oss:20b).
# When calling the cloud endpoint directly, the server drops a trailing
# "-cloud" suffix automatically (it is only meaningful for a local Ollama install).
OLLAMA_MODEL=gpt-oss:20b
```

### 3. Run

```bash
npm install        # installs dev tooling (Vite, vue-tsc, etc.)
npm start          # backend (:8787) + Vite dev server (:5173) together
# → open http://localhost:5173
```

`/api/*` is proxied from the Vite dev server to the backend so the API key stays
on the server in every environment.

---

## 🏭 Production

```bash
npm run prod       # builds the frontend into dist/, then serves it with quotas
# → open http://localhost:8787
```

In production the backend also serves the built `dist/` output, applies a
one-year immutable cache to versioned assets and card art, and enforces the
per-identity cooldown.

---

## 📖 Common commands

| Command        | What it does                                        |
| -------------- | --------------------------------------------------- |
| `npm start`    | Backend (`:8787`) + Vite dev server (`:5173`)        |
| `npm run dev`  | Same as `npm start`                                 |
| `npm run server`  | Backend only                                       |
| `npm run dev:web` | Frontend (Vite) only                               |
| `npm run dev:api` | Backend in development mode                        |
| `npm run build`   | Build frontend into `dist/`                        |
| `npm run preview` | Preview the production build                        |
| `npm run prod`    | Build + run production server with quotas          |
| `npm run type-check` | Static type-checking via `vue-tsc`               |
| `npm test`         | Run the regression suite (`node --test`)          |

---

## 🧠 How a reading works

```
User asks a question → flips 3 cards (drawn on the fly)
        → after the 3rd flip, the client calls POST /api/reading
        → server validates, grounds the cards in built-in tarot knowledge
        → streams to Ollama cloud → returns { reading, thread }
        → a 4-hour cooldown begins for that identity
```

- Cards are **not** predetermined — each one is drawn at the moment it's flipped.
- The AI request is deliberately deferred until the third card is revealed
  (`showAi()` → `requestReading()`), so **billing and experience stay aligned**:
  a reading is only ever charged when the user actually receives it.
- Users who "change the question" or abandon mid-spread never consume quota —
  the server also detects a disconnected client (`abandoned`) and never stores
  or bills it.
- The model prompt is grounded with the three drawn cards from
  `server/tarot-knowledge.json` (full 78-card keywords + upright/reversed
  references), not arbitrary client text.

---

## 🔌 API

### `POST /api/reading`

Requests an AI reading for a validated question and exactly three cards.

```json
{
  "question": "我正面临一个职业上的选择",
  "cards": [
    { "name": "The Hermit", "reversed": false, "position": 0 },
    { "name": "Two of Swords", "reversed": true, "position": 1 },
    { "name": "The Star", "reversed": false, "position": 2 }
  ]
}
```

**Response** `200`:

```json
{
  "reading": "解读文本…",
  "thread": "今天可做的一小步…",
  "quota": { "used": 1, "limit": 1, "resetAt": 1780000000000 }
}
```

**Validation** happens server-side before the model is called:

- `question` — a non-empty string of at most 130 characters (a blank question
  falls back to the default).
- `cards` — exactly three unique cards, ordered by `position` 0–2, each with an
  `index`/`name`/`reversed` combination that matches the built-in 78-card deck.

Invalid requests return **`400`** and never call the model or consume quota.

### `GET /api/quota`

Free pre-flight check; never calls the model. Returns whether the caller is
cooling down and, if so, when it resets. The frontend uses this to show whether
a new reading can start or how long to wait.

### `GET /api/previous-reading`

Returns the currently completed reading (while its 4-hour cooldown is active) so
a user can reopen it. Returns `404` when there is no active reading.

### Status codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| `200` | Reading returned / quota OK                              |
| `400` | Invalid request body (no model call, no quota)           |
| `404` | Unknown or inactive previous reading                     |
| `409` | A request for this identity is already in-flight         |
| `429` | Cooldown active for this identity                        |
| `502` | Upstream AI failure — generic message; details stay on the server |

---

## ⚙️ Environment variables

All settings are read from `.env` at the project root (or the environment) at
server startup.

| Variable                   | Default        | Purpose                                                       |
| -------------------------- | -------------- | ------------------------------------------------------------- |
| `OLLAMA_API_KEY`           | —              | **Required** for the AI. Ollama cloud API key.                |
| `OLLAMA_MODEL`             | `gpt-oss:20b`  | Model name; a trailing `-cloud` is stripped for direct cloud calls. |
| `OLLAMA_URL`               | `https://ollama.com/api/chat` | Override the upstream endpoint (also enables a self-hosted / plain-`http` Ollama). |
| `PORT`                     | `8787`         | HTTP port for the Node server.                                |
| `NODE_ENV`                 | `development`  | `production` enables quotas and static hosting of `dist/`.    |
| `READING_COOLDOWN_HOURS`   | `4`            | Cooldown between paid readings, in hours.                      |
| `TRUST_PROXY`              | unset          | Set to `true` **only** behind a trusted reverse proxy that correctly overwrites `X-Forwarded-For`. |
| `LOG_DIR`                  | `./logs`       | Where usage + active-reading files are written.               |

---

## 📂 Project structure

```
.
├── index.html             Vite entry (mount point + fonts)
├── vite.config.ts         Vue plugin + /api proxy → :8787 (dev)
├── tsconfig.json
├── package.json
│
├── src/                   Vue 3 + TypeScript frontend
│   ├── main.ts            App entry
│   ├── styles.css         Global styles (a11y: focus / reduced-motion)
│   ├── App.vue            Outer shell — intro / reading phases
│   ├── components/        SiteIntro · ReadingView · CardSlot ·
│   │                      Reflection · AiReading · ReadingFooter · Toast
│   ├── store/             reading.ts — singleton state machine
│   ├── composables/       useToast
│   └── lib/               cards · cardImages · guidance · spread ·
│                          markdown · api · types
│
├── public/cards/          78 card images (WebP)
├── server/
│   ├── server.js          Zero-dependency Node backend (proxy + static)
│   ├── tarot-knowledge.json   78-card keywords + upright/reversed refs
│   └── third-party/       vendored deck data (MIT attributions)
│
└── test/                  Regression suite (`npm test`)
    ├── server.validation.test.js
    └── server.integration.test.js
```

---

## 🧪 Tests

The backend has a growing regression suite run with the built-in Node test
runner (no extra dependency):

```bash
npm test
```

- **`test/server.validation.test.js`** — unit tests for request validation,
  static-path containment, rate-limit identity, model-output parsing, cooldown/
  expiry math, cache headers, and failure-detail hygiene.
- **`test/server.integration.test.js`** — boots the real server against a local
  mock Ollama and asserts the full lifecycle end-to-end: successful reading →
  `previous-reading`, `429` cooldown per identity, `409` concurrent in-flight
  rejection, and abandoned requests storing nothing / consuming no quota.

The integration tests use `OLLAMA_URL` + `LOG_DIR` env overrides, so they run
entirely offline and never touch your real logs or API key.

---

## 🛡️ Privacy & data

- **No accounts, no personal data.** Rate limiting is keyed by a truncated
  SHA-256 hash of the client IP — raw IPs are never stored.
- **Costs are kept honest.** The AI model is only called for a *completed*
  reading. Failures are free and don't consume quota.
- **Four-hour retention.** The last completed reading is kept (server-side in
  `logs/active-readings.json` and in `localStorage` on the client) only long
  enough to reopen it during the cooldown, then expires.
- **Private analytics.** Usage lines are appended to `logs/usage-YYYY-MM.jsonl`
  and are git-ignored by default.

### Required privacy check before a multi-instance deployment

Rate limiting currently keyed by IP is deliberately sufficient for an
early-stage, single-instance deployment. Before scaling to multiple instances
or needing nuanced shared-network policies, revisit the identity scheme (a
shared store will be required).

---

## 🙏 Credits

- The 78-card upright/reversed references are grounded in the open
  [coderdoder-mode/Mystic](https://github.com/coderdoder-mode/Mystic) dataset
  (MIT), vendored under `server/third-party/`.
- Card art: Rider–Waite Smith deck images served as WebP.
- Chinese spread integration, tone, and safety boundaries are defined by this
  project.

---

## 📄 License

Released under the **MIT license** (declared in `package.json`). The bundled
third-party card dataset and art carry their own MIT attributions under
`server/third-party/`.