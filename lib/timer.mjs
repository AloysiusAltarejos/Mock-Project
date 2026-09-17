import { randomUUID } from 'node:crypto';

export const IDLE_MS = 300_000;
export const DRAFT_LEASE_MS = 15_000;
export const initialState = () => ({ version: 1, activeProjectId: null, projects: [], conversations: [], cycles: [], drafts: {} });
const id = () => randomUUID();
const fail = message => { throw new Error(message); };
const clean = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} must be 1–${max} characters.`);
  return value.trim();
};
export const projectById = (state, value) => state.projects.find(p => p.id === value) || fail('Project not found.');
export const conversationById = (state, value) => state.conversations.find(c => c.id === value) || fail('Conversation not found.');

export function createProject(state, { name, description = '' }, now) {
  name = clean(name, 100, 'Project name');
  if (typeof description !== 'string' || description.length > 500) fail('Description must be at most 500 characters.');
  const project = { id: id(), name, description: description.trim(), createdAt: now, sample: false };
  state.projects.push(project);
  return project;
}

export function activateProject(state, projectId, now) {
  if (projectId !== null) projectById(state, projectId);
  if (projectId === null && state.cycles.some(c => c.finishedAt === null)) fail('Let the assistant finish before deactivating the workspace.');
  if (Object.values(state.drafts).some(d => d.text.trim() && d.projectId !== projectId)) fail('Submit or discard your draft before changing the active project.');
  reconcile(state, now);
  state.activeProjectId = projectId;
}

export function createConversation(state, { projectId, title }, now) {
  projectById(state, projectId);
  const conversation = { id: id(), projectId, title: clean(title, 100, 'Conversation name'), createdAt: now };
  state.conversations.push(conversation);
  return conversation;
}

function settleDraft(draft, now) {
  if (draft.startedAt !== null) {
    const end = Math.max(draft.startedAt, now);
    (draft.intervals ||= []).push({ startedAt: draft.startedAt, endedAt: end });
    draft.elapsedMs += end - draft.startedAt;
    draft.startedAt = null;
  }
}

// Time is attached to immutable project and conversation IDs, never a path.
export function editDraft(state, { conversationId, text, focused = true }, now) {
  const conversation = conversationById(state, conversationId);
  if (!state.activeProjectId || conversation.projectId !== state.activeProjectId) fail('Activate this project before composing a request.');
  if (typeof text !== 'string' || text.length > 10_000) fail('Requests must be at most 10,000 characters.');
  if (state.cycles.some(c => c.projectId === conversation.projectId && c.finishedAt === null)) fail('Wait for the assistant to finish before composing the next request.');
  if (Object.values(state.drafts).some(d => d.conversationId !== conversationId && d.text.trim())) fail('Submit or discard your other draft first.');
  reconcile(state, now);
  if (!text) { delete state.drafts[conversationId]; return null; }
  const draft = state.drafts[conversationId] || {
    projectId: conversation.projectId, conversationId, firstInputAt: now,
    elapsedMs: 0, startedAt: null, lastSeenAt: now, text: '', intervals: [],
  };
  if (!focused) settleDraft(draft, now);
  else if (draft.startedAt === null) draft.startedAt = now;
  draft.text = text;
  draft.lastSeenAt = now;
  state.drafts[conversationId] = draft;
  return draft;
}

export function pauseDraft(state, conversationId, now) {
  const draft = state.drafts[conversationId];
  if (draft) { settleDraft(draft, now); draft.lastSeenAt = now; }
}

export function submitRequest(state, { conversationId, text, areas = [], requestKey }, now) {
  // Retrying an acknowledged-or-lost request must not create a second cycle.
  if (requestKey !== undefined && (typeof requestKey !== 'string' || !requestKey || requestKey.length > 200)) fail('A request key must be 1–200 characters.');
  if (requestKey) {
    const previous = state.cycles.find(c => c.requestKey === requestKey);
    if (previous) {
      if (previous.conversationId !== conversationId || previous.request !== text?.trim()) fail('This request key belongs to a different request.');
      return previous;
    }
  }
  clean(text, 10_000, 'Request');
  const conversation = conversationById(state, conversationId);
  if (state.activeProjectId !== conversation.projectId) fail('Activate this project before submitting.');
  if (!Array.isArray(areas) || areas.some(a => !['transactions', 'contacts', 'analytics'].includes(a))) fail('Unknown workspace area.');
  if (state.cycles.some(c => c.projectId === conversation.projectId && c.finishedAt === null)) fail('The assistant is already working on this project.');
  reconcile(state, now);
  const draft = state.drafts[conversationId];
  if (!draft || draft.projectId !== conversation.projectId) fail('Compose your request before submitting.');
  settleDraft(draft, now);
  for (const cycle of state.cycles) {
    if (cycle.projectId === conversation.projectId && cycle.finishedAt !== null && cycle.endedAt === null) {
      cycle.endedAt = now;
      cycle.endReason = 'continued';
    }
  }
  const cycle = {
    id: id(), projectId: conversation.projectId, conversationId, requestKey: requestKey || id(),
    compositionStartedAt: draft.firstInputAt, submittedAt: now, humanMs: draft.elapsedMs,
    compositionIntervals: draft.intervals || [],
    finishedAt: null, heartbeatAt: now, endedAt: null, endReason: null,
    request: text.trim(), response: '', areas: [...new Set(areas)], adapter: 'local-mock',
  };
  delete state.drafts[conversationId];
  state.cycles.push(cycle);
  return cycle;
}

export function finishRequest(state, cycleId, response, now, outcome = 'completed') {
  const cycle = state.cycles.find(c => c.id === cycleId) || fail('Cycle not found.');
  if (cycle.finishedAt !== null) return cycle;
  cycle.finishedAt = Math.max(cycle.submittedAt, now);
  cycle.response = String(response).slice(0, 30_000);
  cycle.outcome = outcome;
  if (outcome !== 'completed') { cycle.endedAt = cycle.finishedAt; cycle.endReason = outcome; }
  return cycle;
}

export function reconcile(state, now, recovering = false) {
  let changed = false;
  for (const cycle of state.cycles) {
    if (recovering && cycle.finishedAt === null) {
      finishRequest(state, cycle.id, 'The server stopped before this response finished. Work is counted only through its last saved heartbeat.', cycle.heartbeatAt, 'interrupted');
      changed = true;
    }
    if (cycle.finishedAt !== null && cycle.endedAt === null && now >= cycle.finishedAt + IDLE_MS) {
      cycle.endedAt = cycle.finishedAt + IDLE_MS;
      cycle.endReason = 'idle';
      changed = true;
    }
  }
  for (const draft of Object.values(state.drafts)) {
    if (draft.startedAt !== null && (recovering || now - draft.lastSeenAt >= DRAFT_LEASE_MS)) {
      settleDraft(draft, draft.lastSeenAt);
      changed = true;
    }
  }
  return changed;
}

export function totals(state, projectId, now) {
  const cycles = state.cycles.filter(c => c.projectId === projectId);
  const humanMs = cycles.reduce((sum, c) => sum + c.humanMs, 0);
  const assistantMs = cycles.reduce((sum, c) => sum + Math.max(0, (c.finishedAt ?? now) - c.submittedAt), 0);
  const waitingMs = cycles.reduce((sum, c) => sum + (c.finishedAt === null ? 0 : Math.max(0, Math.min(c.endedAt ?? now, c.finishedAt + IDLE_MS) - c.finishedAt)), 0);
  const composing = Object.values(state.drafts).find(d => d.projectId === projectId && d.startedAt !== null);
  const status = composing ? 'composition' : cycles.some(c => c.finishedAt === null) ? 'assistant' : cycles.some(c => c.finishedAt !== null && c.endedAt === null && now < c.finishedAt + IDLE_MS) ? 'waiting' : 'stopped';
  return { humanMs, assistantMs, workMs: humanMs + assistantMs, waitingMs, cycleCount: cycles.length, idleStops: cycles.filter(c => c.endReason === 'idle').length, status };
}

export function addSamples(state, now) {
  if (state.projects.some(p => p.sample)) fail('Example projects are already available.');
  const start = now - 2 * 86_400_000;
  const specs = [
    ['Launch the customer insights dashboard', 'Bring transactions and customer activity into one useful view.', ['Shape the dashboard', 'Connect customer data', 'Polish the experience']],
    ['Simplify transaction reviews', 'Make the review flow clearer across the mock product.', ['Review workflow']],
    ['Improve contact search', 'Explore a faster way to find the right customer.', ['Search interaction']],
  ];
  const created = [];
  specs.forEach(([name, description, titles], pi) => {
    const p = createProject(state, { name, description }, start - 60_000);
    p.sample = true;
    created.push(p);
    const chats = titles.map(title => createConversation(state, { projectId: p.id, title }, start));
    const durations = pi === 0 ? [[182,421],[95,308],[213,567],[146,392],[87,264],[174,489]] : pi === 1 ? [[123,347],[71,260]] : [[98,203]];
    const prompts = ['Outline the dashboard across our three apps.', 'Inspect the transaction fields for the overview.', 'Connect customer activity to the analytics view.', 'Review the empty states and summary cards.', 'Check the contact details used in the dashboard.', 'Bring the final review together across apps.'];
    let cursor = start + pi * 3_600_000;
    durations.forEach(([human, assistant], i) => {
      const submittedAt = cursor + human * 1000;
      const finishedAt = submittedAt + assistant * 1000;
      const continued = i % 3 !== 2 && i !== durations.length - 1;
      const wait = continued ? ((durations[i + 1]?.[0] || 40) + 35) * 1000 : IDLE_MS;
      state.cycles.push({ id: id(), projectId: p.id, conversationId: chats[Math.min(Math.floor(i / 2), chats.length - 1)].id,
        compositionStartedAt: cursor, submittedAt, humanMs: human * 1000, compositionIntervals: [{ startedAt: cursor, endedAt: submittedAt }], finishedAt, heartbeatAt: finishedAt,
        endedAt: finishedAt + wait, endReason: continued ? 'continued' : 'idle', outcome: 'completed',
        request: prompts[i], response: 'Illustrative sample response. This record is example data, not measured work.',
        areas: i % 2 ? ['transactions', 'analytics'] : ['contacts', 'analytics'], adapter: 'sample', sample: true,
      });
      // Composition may overlap the previous wait. Waiting is never counted as work.
      cursor = continued ? finishedAt + wait - (durations[i + 1]?.[0] || 0) * 1000 : finishedAt + wait + 1_200_000;
    });
  });
  return created;
}
