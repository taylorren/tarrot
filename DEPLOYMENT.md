# Deployment Guide

Production deployment of 小小问题 (Tarrot) using the architecture described here:

```
             ┌─────────────────────────────────────────────────────────┐
 Internet →  │   Nginx (TLS / public :80/:443)                        │
             │   - serves as TLS terminator + reverse proxy           │
             │   - sets X-Forwarded-For correctly                     │
             │   - forwards everything to the Node app on :PORT       │
             └───────────────────────────┬─────────────────────────────┘
                                         │ 127.0.0.1:8787
                             ┌───────────▼───────────┐
                             │  Node app (pm2)        │
                             │  server/server.js      │
                             │  - serves dist/ (prod) │
                             │  - /api/* endpoints    │
                             │  - proxies → Ollama    │
                             └────────────────────────┘
```

**Yes — you need a reverse proxy.** Nginx terminates TLS and hands all traffic to
the Node app. The Node app stays bound to `127.0.0.1` and is never exposed
directly.

> **Important:** because Nginx proxies from the local machine, the Node app sees
> every connection as `127.0.0.1` **unless** you set `TRUST_PROXY=true` and Nginx
> sends `X-Forwarded-For`. Setting `TRUST_PROXY=true` makes per-user rate
> limiting work correctly (it hashes the real client IP instead of `127.0.0.1`).
> Only set it when a trusted proxy that correctly overwrites `X-Forwarded-For` is
> in front — otherwise clients could spoof the header.
>
> The nginx samples in section 4 send `X-Forwarded-For: $remote_addr` (nginx's
> own view of the client), which is the correct, spoof-resistant choice for the
> simple `internet → nginx → Node` topology shown above. If you also put another
> known proxy in front of nginx (e.g., Cloudflare), use
> `$proxy_add_x_forwarded_for` instead **and** make that front proxy overwrite
> its own `X-Forwarded-For` — a deeper topic beyond this quickstart.

---

## 1. Prerequisites on the server

- **Node.js ≥ 20** (the project targets Node 24+; uses native `node --test` and
  zero runtime npm dependencies).
- **pm2** (process manager): `npm install -g pm2`
- **nginx**
- The app source checked out to a path, e.g. `/opt/tarrot` or `/srv/tarrot`.

---

## 2. Install & configure the app

**First-time setup — clone the repo** (skip this if the code is already on the
server):

```bash
sudo mkdir -p /opt/tarrot
sudo chown -R $USER /opt/tarrot        # so your user can git pull / deploy without sudo
cd /opt/tarrot

# HTTPS clone (SSH also works: git@github.com:taylorren/tarrot.git)
git clone https://github.com/taylorren/tarrot.git .
```

Then install and build:

```bash
cd /opt/tarrot
npm ci                       # install dev tooling (Vite, vue-tsc, etc.)
npm run build                # fresh production build into dist/
```

> **Note:** `dist/`, `logs/`, `node_modules/`, and `.env` are all git-ignored, so
> `git pull` will never clobber your built output, runtime logs, or secrets.

Create the environment file `.env` (already git-ignored):

```env
# Required
OLLAMA_API_KEY=your-ollama-cloud-key

# Optional — model default is gpt-oss:20b
#OLLAMA_MODEL=gpt-oss:20b

# Runs the app in production mode (serves dist/, enforces quotas).
NODE_ENV=production

# Port the Node app listens on (loopback only — see nginx).
PORT=8787

# REQUIRED behind nginx/reverse proxy so rate limiting sees real client IPs.
TRUST_PROXY=true

# Optional tuning
#READING_COOLDOWN_HOURS=4
#LOG_DIR=/opt/tarrot/logs
```

> `PORT` can stay at its default (`8787`) — nginx will be configured to match.

---

## 3. Run under pm2

Start the server with pm2 using an **ecosystem file** so settings survive restarts:

`ecosystem.config.js` (in the project root):

```js
module.exports = {
  apps: [
    {
      name: 'tarrot',
      cwd: '/opt/tarrot',
      script: 'server/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '8787',
        TRUST_PROXY: 'true',
        // OLLAMA_API_KEY etc. come from .env (loaded by the app)
      },
      instances: 1,               // single instance — see "Scaling" note below
      max_memory_restart: '300M',
      out_file: '/opt/tarrot/logs/pm2-out.log',
      error_file: '/opt/tarrot/logs/pm2-error.log',
      time: true,
    },
  ],
};
```

> The app also loads `.env` itself (`server/server.js` reads it), so you may put
> `OLLAMA_API_KEY` there instead of the ecosystem file. Either is fine; the
> ecosystem `env` block wins if both are set (its values are already in
> `process.env` before the app reads `.env`).

Start and check:

```bash
# pre-create the log dir the ecosystem file expects
mkdir -p /opt/tarrot/logs

pm2 start ecosystem.config.js
pm2 save                    # persist so `pm2 resurrect` restores it on boot
pm2 status

# Optional: re-launch on server reboot
pm2 startup                 # follow its printed command, then `pm2 save`
```

---

## 4. Configure nginx as a reverse proxy

Create a site config, e.g. `/etc/nginx/sites-available/tarrot`.

**Minimal HTTP config** to get started:

```nginx
server {
    listen 80;
    server_name tarrot.example.com;        # ← your domain

    client_max_body_size 16k;             # keep question payloads tiny

    location / {
        proxy_pass http://127.0.0.1:8787; # must match PORT in .env
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # IMPORTANT: $remote_addr (NOT $proxy_add_x_forwarded_for). The app
        # trusts the FIRST X-Forwarded-For entry. $remote_addr replaces any
        # client-supplied value, so a client can't spoof their identity and
        # reset their per-user rate limit.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        # AI readings take a while — don't let nginx kill them early.
        proxy_read_timeout       120s;
        proxy_send_timeout       120s;
    }
}
```

**HTTPS + HTTP→HTTPS redirect** (once TLS is set up — see section 5), replace the
above with:

```nginx
# Redirect everything to HTTPS
server {
    listen 80;
    server_name tarrot.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    # `http2 on;` requires nginx ≥ 1.25.1. On older builds use `listen 443 ssl http2;`
    # instead of these two lines.
    http2 on;
    server_name tarrot.example.com;

    ssl_certificate     /etc/letsencrypt/live/tarrot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tarrot.example.com/privkey.pem;

    client_max_body_size 16k;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;   # see note in HTTP block
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        proxy_read_timeout       120s;
        proxy_send_timeout       120s;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/tarrot /etc/nginx/sites-enabled/tarrot
sudo nginx -t
sudo systemctl reload nginx
```

### Why the app still serves static files (and that's fine)

The Node app already serves `dist/` with correct `Cache-Control` headers
(one-year immutable for hashed assets and card art, `no-cache` for HTML) and a
SPA fallback. So nginx doesn't need to serve static files — it can simply proxy
everything. If you *prefer* nginx to serve static assets directly, that also
works (see "Optional: nginx serving static assets" below), but it is **not
required**.

---

## 5. TLS (recommended)

```bash
sudo apt install certbot python3-certbot-nginx   # or dnf for RHEL-family
sudo certbot --nginx -d tarrot.example.com
sudo certbot renew --dry-run
```

After issuing certs, switch to the HTTPS config in section 4 (and optionally add
the HTTP→HTTPS redirect block).

---

## 6. Deployment / release runbook

**Full release** — pull the latest code, install, rebuild, test, then reload:

```bash
cd /opt/tarrot

# 1. Pull the latest code (stash local tweaks if any, or rely on git-ignored files)
git pull origin main

# 2. Fresh install + rebuild
npm ci
npm run build                 # rebuilds dist/ from scratch

# 3. Sanity-check before touching the live process
node --test                   # all 17 tests pass

# 4. Reload pm2 (graceful restart, keeps the same PID)
pm2 reload tarrot
pm2 status
```

**Quick fix-only release** (frontend-only change with no dependency changes —
skip `npm ci`):

```bash
cd /opt/tarrot
git pull origin main
npm run build
pm2 reload tarrot
```

**Rollback** if a release misbehaves:

```bash
cd /opt/tarrot
git log --oneline -5          # find a known-good commit
git checkout <good-sha>       # detached HEAD is fine for a rollback
npm ci && npm run build
pm2 reload tarrot
```

> `git pull` is safe against local state: `dist/`, `logs/`, `node_modules/`,
> and `.env` are git-ignored, so your build output, runtime data, and secrets
> survive every pull. The only conflict risk is a stray edited tracked file —
> resolve with `git stash` or `git checkout -- <file>`.

---

## 7. Verification

```bash
# Nginx serves the app and the SPA fallback works
curl -I https://tarrot.example.com/
curl -s -o /dev/null -w '%{http_code}\n' https://tarrot.example.com/some/spa/route

# API preflight returns quota in production (limit = 1)
curl -s https://tarrot.example.com/api/quota
# → {"used":0,"limit":1,"resetAt":0}

# An invalid reading request is rejected with 400 (no model call)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://tarrot.example.com/api/reading \
  -H 'Content-Type: application/json' -d '{"question":"hi"}'

# pm2
pm2 logs tarrot --lines 30
pm2 status
```

---

## 8. Operations notes

### Logs
- **App logs (pm2):** `/opt/tarrot/logs/pm2-{out,error}.log`
- **Usage analytics:** `logs/usage-YYYY-MM.jsonl` (JSONL, one record per request —
  see the README's *Privacy & data* section). Written into `LOG_DIR` (`./logs` by
  default). This is git-ignored and can be rotated:

  ```bash
  # simple monthly rotation
  mv /opt/tarrot/logs/usage-$(date -d 'last month' +%Y-%m).jsonl /backup/
  ```
- **Previous-reading store:** `logs/active-readings.json` (auto-expires after the
  cooldown, pruned every 60s).

### Restart / process health
pm2 supervises and restarts the app on crash. `pm2 startup` + `pm2 save` ensure it
comes back after a server reboot.

### Upgrading the rate-limit scheme
Current rate limiting is hashed-IP and intentionally **single-instance**. Do not
run multiple Node `instances` behind a load balancer until the identity store is
made shared (in-memory `Map`/`Set` would no longer be authoritative). See the
README *Privacy & data* note.

---

## 9. Optional: nginx serving static assets directly

If you'd rather offload static file serving to nginx (it can be faster than
Node for large bursts), add rules **before** the `location /` proxy block, which
`proxy_pass` to the Node app for everything not matched:

```nginx
# Hashed build assets + card art: long-lived immutable cache
location /assets/ {
    root /opt/tarrot/dist;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
location /cards/ {
    root /opt/tarrot/dist;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
# HTML: no-cache so new deploys are picked up
location = /index.html {
    root /opt/tarrot/dist;
    add_header Cache-Control "no-cache";
}
```

The Node app still handles `/api/*` and the SPA fallback. Keep the
`Cache-Control` values in sync with what the app already emits.

---

## 10. Environment variable reference

| Variable                   | Default        | Production note                              |
| -------------------------- | -------------- | -------------------------------------------- |
| `NODE_ENV`                 | `development`  | **Set `production`** for quotas + static hosting. |
| `PORT`                     | `8787`         | Bind port; must match `nginx proxy_pass`.    |
| `TRUST_PROXY`              | unset          | **Set `true`** behind nginx so rate limiting sees real IPs via `X-Forwarded-For`. |
| `OLLAMA_API_KEY`           | —              | **Required** for the AI.                     |
| `OLLAMA_MODEL`             | `gpt-oss:20b`  | Trailing `-cloud` is stripped for direct cloud calls. |
| `OLLAMA_URL`               | `https://ollama.com/api/chat` | Override upstream (e.g. self-hosted plain-http Ollama). |
| `READING_COOLDOWN_HOURS`   | `4`            | Cooldown between paid readings.              |
| `LOG_DIR`                  | `./logs`       | Where usage + active-reading files go.       |