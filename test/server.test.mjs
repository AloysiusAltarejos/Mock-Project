import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { TimerClient } from '../lib/client.mjs';

async function start(dir, options = {}) {
  const server = createApp({ dataDir: dir, assistantDelay: 10, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const { csrfToken } = await (await fetch(`${url}/api/state`)).json();
  return { server, url, token: csrfToken, close: () => new Promise(resolve => server.close(resolve)),
    post: async input => {
      const response = await fetch(`${url}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timer-Token': csrfToken }, body: JSON.stringify(input) });
      const data = await response.json();
      return { status: response.status, ...data };
    },
  };
}
test('HTTP workflow persists cycles and conversations across a full server restart', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tempo-test-'));
  let app = await start(dir);
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  let response = await app.post({ action: 'createProject', name: 'A real initiative' });
  assert.equal(response.status, 200);
  const p = response.result;
  assert.equal(response.state.activeProjectId, null);
  const c = (await app.post({ action: 'createConversation', projectId: p.id, title: 'First chat' })).result;
  assert.equal((await app.post({ action: 'draft', conversationId: c.id, text: 'Inspect' })).status, 400);
  await app.post({ action: 'activateProject', projectId: p.id });
  await app.post({ action: 'draft', conversationId: c.id, text: 'Inspect across all mock apps' });
  response = await app.post({ action: 'submit', conversationId: c.id, text: 'Inspect across all mock apps', areas: ['transactions','contacts','analytics'], requestKey: 'test-request' });
  assert.equal(response.status, 200);
  const cycleId = response.result.id;
  for (let i = 0; i < 50; i++) {
    const data = await (await fetch(`${app.url}/api/state`)).json();
    if (data.state.cycles[0].finishedAt !== null) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const exported = await (await fetch(`${app.url}/api/export`)).json();
  assert.match(exported.cycles[0].response, /Transactions/);
  assert.match(exported.cycles[0].response, /Contacts/);
  assert.match(exported.cycles[0].response, /Analytics/);
  assert.match(exported.cycles[0].response, /Next idea:/);
  assert.doesNotMatch(exported.cycles[0].response, /export const|index\.js/);
  const workspace = await (await fetch(`${app.url}/api/workspace`)).json();
  assert.equal(workspace.length, 3);
  assert.match(workspace[0].notes, /One example order/);
  assert.match(workspace[0].content, /export const/);
  assert.ok(exported.cycles[0].finishedAt >= exported.cycles[0].submittedAt);
  await app.close();
  app = await start(dir);
  const restored = await (await fetch(`${app.url}/api/state`)).json();
  assert.equal(restored.state.cycles[0].id, cycleId);
  assert.equal(restored.state.projects[0].name, 'A real initiative');
  assert.equal(restored.state.conversations[0].id, c.id);
  assert.equal(restored.state.cycles[0].response, exported.cycles[0].response);
});
test('a second server cannot overwrite live records in the same data directory', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tempo-lock-'));
  const app = await start(dir);
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const before = await readFile(path.join(dir, 'timer.json'), 'utf8');
  assert.throws(() => createApp({ dataDir: dir }), /already open/);
  assert.equal(await readFile(path.join(dir, 'timer.json'), 'utf8'), before);
});
test('malformed persisted data fails loudly without erasing it', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tempo-corrupt-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'timer.json'), '{broken JSON');
  assert.throws(() => createApp({ dataDir: dir }));
  assert.equal(await readFile(path.join(dir, 'timer.json'), 'utf8'), '{broken JSON');
});
test('external host adapter can record a real lifecycle without running the mock', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tempo-adapter-'));
  const adapterToken = 'test-only-local-adapter-token';
  const app = await start(dir, { adapterToken });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const client = new TimerClient({ token: adapterToken, baseURL: app.url });
  const p = await client.event('createProject', { name: 'External initiative' });
  await client.event('activateProject', { projectId: p.id });
  const c = await client.event('createConversation', { projectId: p.id, title: 'External chat' });
  await client.event('draft', { conversationId: c.id, text: 'Do real work', focused: true });
  const input = { conversationId: c.id, text: 'Do real work', external: true, requestKey: 'external-001' };
  const cycle = await client.event('submit', input);
  assert.equal(cycle.adapter, 'external');
  assert.equal(cycle.finishedAt, null);
  assert.equal((await client.event('submit', input)).id, cycle.id);
  const finished = await client.event('finish', { cycleId: cycle.id, response: 'Host response' });
  assert.equal(finished.response, 'Host response');
  assert.ok(finished.finishedAt >= cycle.submittedAt);
  assert.equal(finished.endedAt, null);
  const badClient = new TimerClient({ token: 'wrong', baseURL: app.url });
  await assert.rejects(() => badClient.event('activateProject', { projectId: p.id }), /Session expired/);
  assert.throws(() => new TimerClient({ token: adapterToken, baseURL: 'https://example.com' }), /local server/);
});
test('server rejects CSRF, cross-origin requests, DNS rebinding, traversal, oversized bodies, and external spoofing', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tempo-security-'));
  const app = await start(dir);
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const post = headers => fetch(`${app.url}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ action: 'createProject', name: 'Forbidden' }) });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ 'X-Timer-Token': app.token, Origin: 'https://evil.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(`${app.url}/api/state`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(`${app.url}/data/timer.json`)).status, 404);
  assert.equal((await fetch(`${app.url}/%2e%2e/server.mjs`)).status, 404);
  assert.equal((await fetch(`${app.url}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timer-Token': app.token }, body: 'x'.repeat(70000) })).status, 413);
  assert.equal((await app.post({ action: 'finish', cycleId: 'anything' })).status, 400);
  const html = await fetch(app.url);
  assert.match(html.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(html.headers.get('X-Content-Type-Options'), 'nosniff');
});
