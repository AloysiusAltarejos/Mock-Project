import test from 'node:test';
import assert from 'node:assert/strict';
import * as timer from '../lib/timer.mjs';

function fixture() {
  const state = timer.initialState();
  const project = timer.createProject(state, { name: 'Launch a dashboard', description: 'Across apps' }, 1000);
  const conversation = timer.createConversation(state, { projectId: project.id, title: 'Research' }, 2000);
  return { state, project, conversation };
}
function request(f, start = 3000, submitted = 8000, conversation = f.conversation) {
  timer.activateProject(f.state, f.project.id, start);
  timer.editDraft(f.state, { conversationId: conversation.id, text: 'Inspect both apps.' }, start);
  return timer.submitRequest(f.state, { conversationId: conversation.id, text: 'Inspect both apps.', areas: ['transactions','contacts'] }, submitted);
}

test('a project requires a nonempty bounded name before any timing', () => {
  const state = timer.initialState();
  for (const name of ['', '  ', 'x'.repeat(101), null]) assert.throws(() => timer.createProject(state, { name }, 1));
  assert.equal(state.projects.length, 0);
  assert.equal(state.cycles.length, 0);
});
test('inactive projects cannot accrue draft or assistant time', () => {
  const f = fixture();
  assert.throws(() => timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Hi' }, 3000), /Activate/);
  assert.throws(() => timer.submitRequest(f.state, { conversationId: f.conversation.id, text: 'Hi' }, 4000), /Activate/);
  assert.equal(timer.totals(f.state, f.project.id, 9999999).workMs, 0);
});
test('human composition is committed only on submission; work excludes waiting', () => {
  const f = fixture();
  timer.activateProject(f.state, f.project.id, 2000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Hello' }, 3000);
  assert.equal(timer.totals(f.state, f.project.id, 7000).humanMs, 0);
  assert.equal(timer.totals(f.state, f.project.id, 7000).status, 'composition');
  const c = timer.submitRequest(f.state, { conversationId: f.conversation.id, text: 'Hello' }, 8000);
  assert.equal(c.humanMs, 5000);
  assert.equal(timer.totals(f.state, f.project.id, 9000).status, 'assistant');
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  const t = timer.totals(f.state, f.project.id, 21000);
  assert.equal(t.humanMs, 5000);
  assert.equal(t.assistantMs, 3000);
  assert.equal(t.workMs, 8000);
  assert.equal(t.waitingMs, 10000);
  assert.equal(t.status, 'waiting');
});
test('focus loss pauses composition and a discarded draft adds no work', () => {
  const f = fixture();
  timer.activateProject(f.state, f.project.id, 2000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'A' }, 3000);
  timer.pauseDraft(f.state, f.conversation.id, 7000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'A new request' }, 100000);
  const c = timer.submitRequest(f.state, { conversationId: f.conversation.id, text: 'A new request' }, 105000);
  assert.equal(c.humanMs, 9000);
  assert.deepEqual(c.compositionIntervals, [{ startedAt: 3000, endedAt: 7000 }, { startedAt: 100000, endedAt: 105000 }]);
  assert.equal(c.compositionIntervals.reduce((sum, interval) => sum + interval.endedAt - interval.startedAt, 0), c.humanMs);
  timer.finishRequest(f.state, c.id, 'Done', 108000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Discard me' }, 110000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: '' }, 111000);
  assert.equal(timer.totals(f.state, f.project.id, 112000).humanMs, 9000);
});
test('five-minute stop is exact even if reconciliation happens hours later', () => {
  const f = fixture(), c = request(f);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  timer.reconcile(f.state, 310999);
  assert.equal(c.endedAt, null);
  timer.reconcile(f.state, 311000);
  assert.equal(c.endedAt, 311000);
  assert.equal(c.endReason, 'idle');
  timer.reconcile(f.state, 99_000_000);
  assert.equal(c.endedAt, 311000);
  const t = timer.totals(f.state, f.project.id, 99_000_000);
  assert.equal(t.waitingMs, 300000);
  assert.equal(t.workMs, 8000);
  assert.equal(t.status, 'stopped');
});
test('typing alone does not cancel the idle deadline; submitting does', () => {
  const f = fixture(), c = request(f);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Still typing' }, 300000);
  timer.reconcile(f.state, 311000);
  assert.equal(c.endReason, 'idle');
  assert.equal(timer.totals(f.state, f.project.id, 311000).status, 'composition');
  const next = timer.submitRequest(f.state, { conversationId: f.conversation.id, text: 'Still typing' }, 312000);
  assert.equal(next.humanMs, 12000);
  assert.equal(c.endedAt, 311000);
});
test('next request across conversations closes the same project wait', () => {
  const f = fixture(), c = request(f);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  const other = timer.createConversation(f.state, { projectId: f.project.id, title: 'Implementation' }, 15000);
  const next = request(f, 20000, 24000, other);
  assert.equal(c.endReason, 'continued');
  assert.equal(c.endedAt, next.submittedAt);
  timer.finishRequest(f.state, next.id, 'Done', 28000);
  const t = timer.totals(f.state, f.project.id, 29000);
  assert.equal(t.cycleCount, 2);
  assert.equal(t.humanMs, 9000);
  assert.equal(t.assistantMs, 7000);
  assert.equal(f.state.conversations.length, 2);
});
test('continuing after idle starts a new cycle without counting the idle gap', () => {
  const f = fixture(), c = request(f);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  const next = request(f, 9000000, 9005000);
  assert.equal(c.endReason, 'idle');
  assert.equal(c.endedAt, 311000);
  timer.finishRequest(f.state, next.id, 'Done', 9008000);
  assert.equal(timer.totals(f.state, f.project.id, 9008000).workMs, 16000);
});
test('a submission exactly on the deadline leaves a visible idle stop', () => {
  const f = fixture(), c = request(f);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  request(f, 306000, 311000);
  assert.equal(c.endReason, 'idle');
});
test('explicit project changes never move recorded time or stop another project wait', () => {
  const f = fixture(), c = request(f);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  const p2 = timer.createProject(f.state, { name: 'Another initiative' }, 12000);
  const chat2 = timer.createConversation(f.state, { projectId: p2.id, title: 'Another chat' }, 12000);
  timer.activateProject(f.state, p2.id, 13000);
  timer.editDraft(f.state, { conversationId: chat2.id, text: 'Other work' }, 14000);
  timer.submitRequest(f.state, { conversationId: chat2.id, text: 'Other work' }, 17000);
  assert.equal(c.projectId, f.project.id);
  assert.equal(c.endReason, null);
  assert.equal(timer.totals(f.state, f.project.id, 18000).workMs, 8000);
  assert.equal(timer.totals(f.state, p2.id, 18000).workMs, 4000);
});
test('unfinished drafts cannot be reassigned to another project', () => {
  const f = fixture();
  timer.activateProject(f.state, f.project.id, 2000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Draft' }, 3000);
  const p2 = timer.createProject(f.state, { name: 'Another initiative' }, 4000);
  assert.throws(() => timer.activateProject(f.state, p2.id, 5000), /Submit or discard/);
  assert.equal(f.state.activeProjectId, f.project.id);
});
test('deactivation cannot orphan a running assistant', () => {
  const f = fixture(), c = request(f);
  assert.throws(() => timer.activateProject(f.state, null, 9000), /Let the assistant finish/);
  assert.equal(f.state.activeProjectId, f.project.id);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  timer.activateProject(f.state, null, 12000);
  assert.equal(f.state.activeProjectId, null);
  assert.equal(timer.totals(f.state, f.project.id, 20000).workMs, 8000);
});
test('duplicate submissions and finish events are idempotent', () => {
  const f = fixture();
  timer.activateProject(f.state, f.project.id, 2000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Request' }, 3000);
  const input = { conversationId: f.conversation.id, text: 'Request', requestKey: 'same-request' };
  const c = timer.submitRequest(f.state, input, 5000);
  assert.equal(timer.submitRequest(f.state, input, 8000).id, c.id);
  timer.finishRequest(f.state, c.id, 'Done', 9000);
  timer.finishRequest(f.state, c.id, 'Duplicate', 11000);
  assert.equal(f.state.cycles.length, 1);
  assert.equal(c.finishedAt, 9000);
  assert.equal(c.response, 'Done');
});
test('simultaneous assistant requests in a project and unsafe area names are rejected', () => {
  const f = fixture();
  request(f);
  assert.throws(() => timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Concurrent' }, 9000), /Wait/);
  assert.throws(() => timer.submitRequest(f.state, { conversationId: f.conversation.id, text: 'Bad', areas: ['../../secrets'] }, 9000), /Unknown workspace/);
});
test('crash recovery stops assistant at last heartbeat, not at reopen time', () => {
  const f = fixture(), c = request(f);
  c.heartbeatAt = 10000;
  const reloaded = JSON.parse(JSON.stringify(f.state));
  timer.reconcile(reloaded, 99_000_000, true);
  assert.equal(reloaded.cycles[0].finishedAt, 10000);
  assert.equal(reloaded.cycles[0].endReason, 'interrupted');
  assert.equal(timer.totals(reloaded, f.project.id, 99_000_000).workMs, 7000);
});
test('stale composition lease stops at last activity and survives reload', () => {
  const f = fixture();
  timer.activateProject(f.state, f.project.id, 2000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Draft' }, 3000);
  timer.editDraft(f.state, { conversationId: f.conversation.id, text: 'Draft edited' }, 8000);
  timer.reconcile(f.state, 23000);
  const d = f.state.drafts[f.conversation.id];
  assert.equal(d.elapsedMs, 5000);
  assert.equal(d.startedAt, null);
  assert.equal(d.text, 'Draft edited');
});
test('persisted waiting cycles reconcile correctly when reopening beyond the deadline', () => {
  const f = fixture(), c = request(f);
  timer.finishRequest(f.state, c.id, 'Done', 11000);
  const state = JSON.parse(JSON.stringify(f.state));
  timer.reconcile(state, 99_000_000, true);
  assert.equal(state.cycles[0].endedAt, 311000);
  assert.equal(state.cycles[0].endReason, 'idle');
});
test('samples are labeled, inactive, reconcilable, and do not overlap assistant and composition', () => {
  const state = timer.initialState();
  timer.addSamples(state, 2_000_000_000);
  assert.equal(state.activeProjectId, null);
  assert.equal(state.projects.length, 3);
  for (const p of state.projects) {
    assert.equal(p.sample, true);
    const cycles = state.cycles.filter(c => c.projectId === p.id);
    assert.ok(cycles.every(c => c.sample && c.compositionStartedAt > p.createdAt));
    for (let i = 1; i < cycles.length; i++) assert.ok(cycles[i].compositionStartedAt >= cycles[i-1].finishedAt);
    for (const c of cycles.filter(c => c.endReason === 'idle')) assert.equal(c.endedAt - c.finishedAt, 300000);
  }
  assert.equal(timer.totals(state, state.projects[0].id, 2_000_000_000).workMs, 3_338_000);
});
