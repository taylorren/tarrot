// server/start.js — the actual process entry point (used by `npm run server`
// and by pm2). Kept separate from server.js so tests can import `server`
// without auto-starting it, and so pm2 doesn't need to rely on process.argv[1]
// (pm2 wraps the entry in its own ProcessContainerFork.js).
import { start } from './server.js';

start();
