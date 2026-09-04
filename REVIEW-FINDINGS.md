# Interim project review findings

Reviewed 2026-09-04. No application changes are included in this document.

## 1. [x] Enforce quotas on the server

**Priority: critical**

**Status: resolved for the early-stage single-instance deployment, 2026-09-04.**
The server now keys cooldowns by a truncated hashed IP rather than a resettable
cookie and rejects a second request for the same identity while one is already
generating. This uses no accounts or database. Revisit it before a multi-instance
deployment or when a more nuanced shared-network policy is needed.

The four-hour quota is keyed only by a client-controlled cookie. Clearing or
blocking that cookie produces a new identity; the documented hashed-IP fallback
is only logged and is not used for quota decisions. Simultaneous requests from
the same identity can also pass the check before any request completes, causing
multiple paid model calls.

Improve this with a durable, privacy-conscious rate-limit identity and an
in-flight reservation/lock per identity.

Affected: `server/server.js` (`getClientId`, `ipHash`, `handleReading`).

## 2. [x] Validate and normalize AI-reading requests

**Priority: high**

**Status: resolved 2026-09-04.** The API now validates and normalizes these
fields before calling the model, and regression tests cover valid, malformed,
oversized, forged, duplicate, and incorrectly positioned requests.

`POST /api/reading` accepts arbitrary question and card values and interpolates
them into the model prompt. Validate server-side: bounded question length,
exactly three unique cards, canonical allowed names/indexes, and boolean card
orientation. Build the prompt only from the normalized result.

Affected: `server/server.js` (`buildMessages`, `handleReading`).

## 3. [x] Make static file handling safe and resilient

**Priority: high**

**Status: resolved 2026-09-04.** Static paths are now decoded safely and
resolved against `dist/` with a separator-aware containment check. Malformed
encoding returns `400`; attempts to leave `dist/` return `403`; regression tests
cover both cases.

`decodeURIComponent()` can throw for malformed paths and currently escapes the
request handler, potentially terminating the Node process. The `startsWith(DIST)`
path check is also not a robust containment check (`dist-private` has the same
prefix). Catch decoding errors and use `path.resolve` plus separator-aware
containment validation.

Affected: `server/server.js` (`serveStatic`).

## 4. [x] Fulfil the four-hour data-retention promise

**Priority: high**

**Status: resolved 2026-09-04.** Saved browser readings now expire with a
timer, are removed on app load if expired or malformed, are cleared when fresh
server quota confirms the cooldown ended, and are removed before a new reading
begins.

The server prunes expired active readings, but the browser saves the question,
cards, and AI response in `localStorage` indefinitely. The UI states that this
data is deleted after four hours. Remove expired local data whenever fresh quota
data shows the cooldown has ended, and when beginning a fresh reading.

Affected: `src/store/reading.ts`, `src/components/SiteIntro.vue`.

## 5. Reduce card image transfer and add caching

**Priority: high (performance)**

The 78 PNG card files total about 112 MB (about 1.44 MB each). A three-card
reading can transfer more than 4 MB of images, and the production static server
does not send cache headers. Produce right-sized WebP or AVIF files, use
responsive image sources, and provide long-lived immutable caching for versioned
assets.

Affected: `public/cards/`, `src/lib/cardImages.ts`, `server/server.js`.

## 6. Keep upstream failure details on the server

**Priority: medium**

The API returns raw Ollama/provider error details to the browser. Return only a
safe user-facing message; retain diagnostic detail in server logs.

Affected: `server/server.js` (`handleReading` error path).

## 7. Add regression tests for critical behavior

**Priority: medium**

There is currently no automated test suite. Cover request validation, cooldown
and concurrent requests, abandoned requests, previous-reading expiry, malformed
static URLs, and model-output validation before shipping backend changes.

Affected: project tooling and `server/server.js`.

## Documentation corrections

- The README says cards are determined before the first flip, but the client
  draws each one as it is flipped.
- The README says JSONL logs rebuild cooldown state after restart, while the
  implementation reloads `logs/active-readings.json`.
