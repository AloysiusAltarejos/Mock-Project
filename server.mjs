import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as timer from './lib/timer.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const PUBLIC = new Set(['/index.html', '/app.js', '/styles.css', '/favicon.svg', '/notes.js']);
const WORKSPACE = ['transactions', 'contacts', 'analytics'];

export function createApp({ dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'), demo = false, assistantDelay = 2200, adapterToken = process.env.TIMER_API_TOKEN } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const dataFile = path.join(dataDir, 'timer.json');
  const lockFile = path.join(dataDir, 'server.lock');
  // Prevent a second process from treating live requests as crash recovery.
  if (existsSync(lockFile)) {
    let owner;
    try { owner = Number(readFileSync(lockFile, 'utf8')); } catch { /* exclusive open below decides ownership */ }
    if (owner) {
      try { process.kill(owner, 0); throw new Error('This data directory is already open in a running timer server.'); }
      catch (error) { if (error.code === 'ESRCH') unlinkSync(lockFile); else throw error; }
    }
  }
  const lock = openSync(lockFile, 'wx', 0o600);
  writeFileSync(lock, String(process.pid));
  closeSync(lock);
  let released = false;
  const releaseLock = () => { if (!released) { released = true; try { unlinkSync(lockFile); } catch { /* already released */ } } };
  // Invalid data fails loudly; never silently replace recorded work.
  let state;
  try {
    state = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : timer.initialState();
    if (state.version !== 1 || !Array.isArray(state.projects) || !Array.isArray(state.cycles)) throw new Error('Unsupported or damaged data file. Restore your JSON backup.');
  } catch (error) { releaseLock(); throw error; }
  const csrfToken = randomBytes(32).toString('hex');
  let storageError = null;
  const jobs = new Set();
  function save() {
    try {
      writeFileSync(`${dataFile}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600, flush: true });
      renameSync(`${dataFile}.tmp`, dataFile);
      storageError = null;
    } catch (error) { storageError = 'Could not save work. Check disk space and data folder permissions.'; throw error; }
  }
  try {
    timer.reconcile(state, Date.now(), true);
    if (demo && !state.projects.length) timer.addSamples(state, Date.now());
    save();
  } catch (error) { releaseLock(); throw error; }
  function mutate(fn) {
    const before = structuredClone(state);
    try { const result = fn(); save(); return result; }
    catch (error) { state = before; throw error; }
  }
  function respond(res, code, payload) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  }
  async function mockAssistant(cycle) {
    const job = setTimeout(async () => {
      jobs.delete(job);
      try {
        const areas = cycle.areas.length ? cycle.areas : WORKSPACE;
        const files = await Promise.all(areas.map(async area => {
          // Read the mock code and its companion notes; never execute mock files.
          const [, notes] = await Promise.all([
            readFile(path.join(ROOT, 'mock-workspace/apps', area, 'index.js'), 'utf8'),
            readFile(path.join(ROOT, 'mock-workspace/apps', area, 'NOTES.md'), 'utf8'),
          ]);
          return notes.trim().replace(/^# /, '');
        }));
        const response = `Here’s what I found in ${areas.length === 1 ? 'that app' : 'those apps'}.\n\n${files.join('\n\n')}\n\nMock walkthrough only. No files were changed.`;
        mutate(() => timer.finishRequest(state, cycle.id, response, Date.now()));
      } catch (error) {
        try { mutate(() => timer.finishRequest(state, cycle.id, `Workspace inspection failed: ${error.message}`, Date.now(), 'failed')); }
        catch { /* surfaced by /api/state; never pretend the write succeeded */ }
      }
    }, assistantDelay);
    jobs.add(job);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return respond(res, 403, { error: 'Local access only.' });
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${host}`)) return respond(res, 403, { error: 'Cross-origin requests are not allowed.' });
    const url = new URL(req.url, `http://${host}`);
    try {
      if (timer.reconcile(state, Date.now())) save();
      if (req.method === 'GET' && url.pathname === '/api/state') {
        if (storageError) return respond(res, 503, { error: storageError });
        return respond(res, 200, { state, csrfToken, serverNow: Date.now(), workspace: WORKSPACE });
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        res.setHeader('Content-Disposition', 'attachment; filename="tempo-work-log.json"');
        return respond(res, 200, { exportedAt: new Date().toISOString(), rules: { idleMs: timer.IDLE_MS, countedWork: 'humanMs + assistantMs; wait excluded' }, ...state });
      }
      if (req.method === 'GET' && url.pathname === '/api/workspace') {
        const files = await Promise.all(WORKSPACE.map(async area => ({ area, path: `mock-workspace/apps/${area}/index.js`, content: await readFile(path.join(ROOT, 'mock-workspace/apps', area, 'index.js'), 'utf8'), notes: await readFile(path.join(ROOT, 'mock-workspace/apps', area, 'NOTES.md'), 'utf8') })));
        return respond(res, 200, files);
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return respond(res, 415, { error: 'JSON required.' });
        const provided = Buffer.from(String(req.headers['x-timer-token'] || ''));
        const expected = Buffer.from(csrfToken);
        const adapterExpected = Buffer.from(adapterToken || '');
        const external = adapterExpected.length > 0 && provided.length === adapterExpected.length && timingSafeEqual(provided, adapterExpected);
        if (!external && (provided.length !== expected.length || !timingSafeEqual(provided, expected))) return respond(res, 403, { error: 'Session expired. Refresh the dashboard.' });
        req.setEncoding('utf8');
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65_536) { respond(res, 413, { error: 'Request too large.' }); return; } }
        let input;
        try { input = JSON.parse(body); } catch { return respond(res, 400, { error: 'Invalid JSON.' }); }
        const now = Date.now();
        let startJob = null;
        const result = mutate(() => {
          switch (input.action) {
            case 'createProject': return timer.createProject(state, input, now);
            case 'activateProject': timer.activateProject(state, input.projectId, now); return null;
            case 'createConversation': return timer.createConversation(state, input, now);
            case 'draft': return timer.editDraft(state, input, now);
            case 'pauseDraft': timer.pauseDraft(state, input.conversationId, now); return null;
            case 'discardDraft': delete state.drafts[input.conversationId]; return null;
            case 'submit': {
              if (input.external && !external) throw new Error('External adapters require TIMER_API_TOKEN.');
              const previous = input.requestKey && state.cycles.find(c => c.requestKey === input.requestKey);
              const cycle = timer.submitRequest(state, input, now);
              if (!previous) { if (input.external) cycle.adapter = 'external'; else startJob = cycle; }
              return cycle;
            }
            case 'finish':
              if (!external) throw new Error('External adapters require TIMER_API_TOKEN.');
              if (state.cycles.find(c => c.id === input.cycleId)?.adapter !== 'external') throw new Error('Only external cycles may be completed by adapters.');
              return timer.finishRequest(state, input.cycleId, input.response || '', now, input.failed ? 'failed' : 'completed');
            case 'addSamples': return timer.addSamples(state, now);
            default: throw new Error('Unknown action.');
          }
        });
        if (startJob) mockAssistant(startJob);
        return respond(res, 200, { result, state, serverNow: Date.now() });
      }
      const asset = url.pathname === '/' ? '/index.html' : url.pathname;
      if (req.method === 'GET' && PUBLIC.has(asset)) {
        const content = await readFile(path.join(ROOT, 'public', asset));
        res.writeHead(200, { 'Content-Type': `${TYPES[path.extname(asset)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        return res.end(content);
      }
      respond(res, 404, { error: 'Not found.' });
    } catch (error) { respond(res, storageError ? 503 : 400, { error: storageError || error.message }); }
  });
  const pulse = setInterval(() => {
    try {
      let changed = timer.reconcile(state, Date.now());
      for (const cycle of state.cycles.filter(c => c.finishedAt === null)) { cycle.heartbeatAt = Date.now(); changed = true; }
      if (changed) save();
    } catch { /* next API read reports a storage error */ }
  }, 1000);
  pulse.unref();
  server.on('close', () => { clearInterval(pulse); for (const job of jobs) clearTimeout(job); releaseLock(); });
  server.on('error', () => { clearInterval(pulse); for (const job of jobs) clearTimeout(job); releaseLock(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  const app = createApp({ demo: process.argv.includes('--demo') });
  app.listen(port, '127.0.0.1', () => console.log(`Tempo is ready at http://127.0.0.1:${port}\nLocal records: ${process.env.DATA_DIR || path.join(ROOT, 'data')}`));
  app.on('error', error => { console.error(error.message); process.exitCode = 1; app.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
}
