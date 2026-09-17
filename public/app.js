import { legacyReadingView } from './notes.js';
const $ = selector => document.querySelector(selector);
const app = $('#app');
const dialog = $('#dialog');
const IDLE = 300_000;
const paths = {
  logo: '<path d="M4 5h16M12 5v15M7 10h10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6M12 2v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 2 8 3v6c0 6-8 11-8 11S4 17 4 11V5z"/><path d="m8 11 3 3 5-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 2M12 17h.01"/>',
  folder: '<path d="M3 6V4h6l3 3h9v13H3V6Z"/>',
  cube: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/>',
  human: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  cycle: '<path d="M3 10a9 9 0 0 1 15-5l3 3M21 3v5h-5M21 14A9 9 0 0 1 6 19l-3-3M3 21v-5h5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  send: '<path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  file: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.clock}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let state, token, serverOffset = 0, lastServerNow = 0;
let selected = localStorage.getItem('tempo.selected'), page = 'overview', tab = 'overview', conversationId;
let historyFilter = '', historyLimit = 6, menuOpen = false, online = true;
let renderSignature = '', draftDebounce, queue = Promise.resolve(), submitting = false;
let workspaceFiles = null, toastTimer;
let areas = new Set(['transactions', 'contacts', 'analytics']);
const now = () => Date.now() + serverOffset;
const duration = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h}h ${String(m).padStart(2,'0')}m ${String(s % 60).padStart(2,'0')}s` : m ? `${m}m ${String(s % 60).padStart(2,'0')}s` : `${s}s`;
};
const short = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2,'0')}m` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2,'0')}s`;
};
const bigTime = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}<span class="unit">h</span>${String(Math.floor(s % 3600 / 60)).padStart(2,'0')}<span class="unit">m</span>` : `${Math.floor(s / 60)}<span class="unit">m</span>${String(s % 60).padStart(2,'0')}<span class="unit">s</span>`;
};
const date = ms => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(ms);
const time = ms => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(ms);
const stamp = ms => ms == null ? '—' : `${date(ms)}, ${time(ms)}`;
const chat = id => state.conversations.find(c => c.id === id);
const selectedProject = () => state.projects.find(p => p.id === selected);
const projectCycles = id => state.cycles.filter(c => c.projectId === id);
const assistantMs = c => Math.max(0, (c.finishedAt ?? now()) - c.submittedAt);
const waitMs = c => c.finishedAt === null ? 0 : Math.max(0, Math.min(c.endedAt ?? now(), c.finishedAt + IDLE) - c.finishedAt);
function totals(id, conversation) {
  const cycles = projectCycles(id).filter(c => !conversation || c.conversationId === conversation);
  const human = cycles.reduce((s, c) => s + c.humanMs, 0);
  const assistant = cycles.reduce((s, c) => s + assistantMs(c), 0);
  const waiting = cycles.reduce((s,c) => s + waitMs(c), 0);
  const draft = Object.values(state.drafts).find(d => d.projectId === id && d.startedAt !== null);
  const status = draft ? 'composition' : cycles.some(c => c.finishedAt === null) ? 'assistant' : cycles.some(c => c.finishedAt !== null && c.endedAt === null && now() < c.finishedAt + IDLE) ? 'waiting' : 'stopped';
  return { human, assistant, waiting, work: human + assistant, count: cycles.length, stops: cycles.filter(c => c.endReason === 'idle').length, status, draft };
}
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500);
}
function accept(data) {
  if (data.serverNow >= lastServerNow) {
    state = data.state; lastServerNow = data.serverNow; serverOffset = data.serverNow - Date.now();
    if (data.csrfToken) token = data.csrfToken;
    if (!state.projects.some(p => p.id === selected)) selected = state.activeProjectId || state.projects[0]?.id;
  }
}
function action(actionName, input = {}) {
  const next = queue.then(async () => {
    const response = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timer-Token': token }, body: JSON.stringify({ action: actionName, ...input }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save your change.');
    accept(data);
    return data.result;
  });
  queue = next.catch(() => {});
  return next;
}
const stateSignature = () => JSON.stringify({ active: state.activeProjectId, projects: state.projects, conversations: state.conversations, cycles: state.cycles.map(({ heartbeatAt, ...cycle }) => cycle) });
async function sync(force = false) {
  try {
    const response = await fetch('/api/state');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The local server is unavailable.');
    accept(data);
    if (!online) { online = true; force = true; }
    const signature = stateSignature();
    if (force || signature !== renderSignature) { renderSignature = signature; render(); }
    updateLive();
  } catch (error) {
    if (online) { online = false; if (state) render(); else app.innerHTML = `<div class="empty"><h1>Couldn’t open the workspace</h1><p>${esc(error.message)}</p><button class="btn primary" data-action="retry">Try again</button></div>`; }
  }
}
function sidebar() {
  return `<aside class="sidebar" aria-label="Workspace navigation"><div class="brand"><span class="brand-mark">${icon('logo')}</span>tempo<span class="muted" style="font-weight:400">.</span></div>
    <button class="icon-btn mobile-nav-close" data-action="menu" aria-label="Close navigation">${icon('close')}</button><div class="workspace-label"><span class="box-icon">${icon('cube')}</span><span>Mock workspace</span></div>
    <nav class="nav"><button class="${page === 'overview' ? 'selected' : ''}" data-page="overview">${icon('grid')}Project overview</button><button class="${page === 'workspace' ? 'selected' : ''}" data-page="workspace">${icon('chat')}Work with assistant</button><button class="${page === 'files' ? 'selected' : ''}" data-page="files">${icon('folder')}Workspace files</button></nav>
    <div class="sidebar-label"><span class="eyebrow">Projects <span style="margin-left:5px;color:#9da791">${state.projects.length}</span></span><button class="icon-btn" aria-label="Create project" data-action="new-project">${icon('plus')}</button></div>
    <div class="project-list">${state.projects.map(p => `<button class="project-nav ${p.id === selected ? 'selected' : ''}" data-project="${p.id}" ${p.id === selected ? 'aria-current="true"' : ''}><span class="project-dot"></span><span><span class="project-name">${esc(p.name)}</span><span class="project-meta"><span data-project-total="${p.id}">${short(totals(p.id).work)}</span>${state.activeProjectId === p.id ? '<span class="badge active" style="padding:0 4px;font-size:10px">Active</span>' : p.sample ? '<span>Example</span>' : ''}</span></span></button>`).join('')}</div>
    <button class="btn ghost new-project" data-action="new-project">${icon('plus')}New project</button>
    <div class="sidebar-bottom"><button class="help-button" data-action="method">${icon('help')}How timing works</button><div class="profile"><span class="avatar">YO</span><span>Your workspace<br><span class="small muted">Local & private</span></span>${icon('shield')}</div></div></aside>`;
}
function heading(p) {
  const active = state.activeProjectId === p.id;
  return `<div class="page-heading"><div><div class="heading-tags"><span class="eyebrow">${page === 'overview' ? 'Project overview' : page === 'workspace' ? 'Project workspace' : 'Mock workspace'}</span>${active ? '<span class="badge active"><span class="dot"></span>Active project</span>' : ''}${p.sample ? '<span class="badge sample">Example data</span>' : ''}</div><h1>${esc(p.name)}</h1><p>${esc(p.description || 'All the work for this project, in one place.')}</p></div><div class="heading-actions">${!active ? `<button class="btn primary" data-action="activate" data-id="${p.id}">${icon('clock')}Make active</button>` : `<button class="btn" data-action="deactivate">${icon('pause')}Deactivate</button>`}${page !== 'workspace' ? `<button class="btn ${active ? 'primary' : ''}" data-page="workspace">Open workspace ${icon('arrow')}</button>` : ''}</div></div>`;
}
function stats(p) {
  const t = totals(p.id);
  return `<div class="stats"><div class="stat"><div class="stat-label">Counted work${icon('clock')}</div><div class="stat-value" data-metric="work">${bigTime(t.work)}</div><div class="stat-foot">Human + assistant · wait excluded</div></div><div class="stat"><div class="stat-label"><span><i class="color-key human"></i>Human composition</span>${icon('human')}</div><div class="stat-value" data-metric="human">${bigTime(t.human)}</div><div class="stat-foot">${t.count} submitted request${t.count === 1 ? '' : 's'}</div></div><div class="stat"><div class="stat-label"><span><i class="color-key assistant"></i>Assistant work</span>${icon('sparkle')}</div><div class="stat-value" data-metric="assistant">${bigTime(t.assistant)}</div><div class="stat-foot">From submission to response</div></div><div class="stat"><div class="stat-label">Work cycles${icon('cycle')}</div><div class="stat-value">${String(t.count).padStart(2,'0')}</div><div class="stat-foot">${t.stops} stopped after 5m of waiting</div></div></div>`;
}
function statusContent(p) {
  const t = totals(p.id), cycles = projectCycles(p.id), last = cycles.at(-1);
  const label = { composition: 'Composing request', assistant: 'Assistant working', waiting: 'Waiting for you', stopped: 'Stopped' }[t.status];
  let description = 'Ready when you are. Send a request to begin.';
  let footer = 'No time is accruing';
  if (t.status === 'composition') { description = 'You’re writing. This time counts when you send.'; footer = `Draft · ${duration(t.draft.elapsedMs + now() - t.draft.startedAt)}`; }
  else if (t.status === 'assistant') { description = 'The assistant is on it. Time is counting.'; footer = 'Live · assistant time is counting'; }
  else if (t.status === 'waiting') {
    const waiting = cycles.findLast(c => c.finishedAt !== null && c.endedAt === null);
    description = 'Your turn. Send a request, or this cycle stops after five minutes.';
    footer = `${duration(Math.max(0, waiting.finishedAt + IDLE - now()))} until idle stop`;
  } else if (last?.endReason === 'idle') { description = 'No new request for five minutes. The clock stopped.'; footer = `Stopped ${stamp(last.endedAt)}`; }
  else if (last?.endReason === 'interrupted') { description = 'The assistant was interrupted. Time saved before the interruption still counts.'; footer = `Interrupted ${stamp(last.endedAt)}`; }
  else if (last?.endReason === 'failed') { description = 'That request failed. Its time is still in the history.'; footer = 'Start another request when ready'; }
  return `<div class="status-top"><span class="eyebrow">Current status</span>${icon(t.status === 'stopped' ? 'pause' : 'clock')}</div><div class="status-main ${t.status !== 'stopped' ? 'running' : ''}"><span class="dot ${t.status === 'assistant' ? 'pulse' : ''}"></span>${label}</div><p class="status-description">${description}</p><div class="status-bottom"><span>${footer}</span><button class="btn lime" data-page="workspace">${t.status === 'stopped' ? 'Continue work' : 'View conversation'} ${icon('arrow')}</button></div>`;
}
function overview(p) {
  const t = totals(p.id), humanPercent = t.work ? Math.round(t.human / t.work * 100) : 0;
  const chats = state.conversations.filter(c => c.projectId === p.id);
  return `${stats(p)}<div class="overview-grid"><section class="panel composition-panel"><div class="panel-heading"><div><h2>What took the time?</h2><p>Your work, split clearly.</p></div><button class="icon-btn" aria-label="Explain counted work" data-action="method">${icon('help')}</button></div><div class="composition-body"><div class="donut ${t.work ? '' : 'empty'}" style="--human-angle:${humanPercent * 3.6}deg" role="img" aria-label="Human ${humanPercent} percent, assistant ${t.work ? 100 - humanPercent : 0} percent"><div class="donut-center"><strong data-donut-total>${short(t.work)}</strong><span>counted work</span></div></div><div class="legend"><div class="legend-row"><i class="color-key human"></i><span>Human<small>${humanPercent}% of work</small></span><strong data-legend="human">${short(t.human)}</strong></div><div class="legend-row"><i class="color-key assistant"></i><span>Assistant<small>${t.work ? 100 - humanPercent : 0}% of work</small></span><strong data-legend="assistant">${short(t.assistant)}</strong></div><div class="legend-row"><i class="color-key wait"></i><span>Waiting<small>Not counted</small></span><strong data-legend="waiting">${short(t.waiting)}</strong></div></div></div><div class="panel-note">${icon('help')}Waiting doesn’t add to your total.</div></section><section class="panel status-panel" id="live-status" aria-label="Current project status">${statusContent(p)}</section></div>${history(p)}
    <section class="panel contributions"><div class="panel-heading"><div><h2>Time by conversation</h2><p>Different chats. The same project.</p></div><span class="badge">${chats.length} conversation${chats.length === 1 ? '' : 's'}</span></div>${chats.length ? `<div class="contribution-list">${chats.map(c => {
      const ct = totals(p.id, c.id);
      return `<div class="contribution-card"><button class="contribution-title" data-conversation="${c.id}">${icon('chat')}${esc(c.title)}</button><div class="contribution-total">${short(ct.work)}<span>${ct.count} cycle${ct.count === 1 ? '' : 's'}</span></div><div class="split-bar" aria-label="Human and assistant contribution"><i class="human" style="width:${ct.work ? ct.human / ct.work * 100 : 0}%"></i><i class="assistant" style="width:${ct.work ? ct.assistant / ct.work * 100 : 0}%"></i></div></div>`;
    }).join('')}</div>` : '<div class="empty" style="padding:30px"><p>No conversations yet. Start one to begin.</p></div>'}</section>`;
}
function cycleStatus(c) {
  const value = c.finishedAt === null ? 'assistant' : c.endedAt === null ? 'waiting' : c.endReason;
  const labels = { assistant: 'Working', waiting: 'Waiting', idle: 'Idle stop · 5m', continued: 'Continued', interrupted: 'Interrupted', failed: 'Failed' };
  return `<span class="status-pill ${value}">${icon(value === 'idle' ? 'pause' : value === 'continued' ? 'cycle' : 'clock')}${labels[value] || 'Stopped'}</span>`;
}
function history(p) {
  const all = projectCycles(p.id), filtered = all.filter(c => !historyFilter || c.conversationId === historyFilter);
  const shown = [...filtered].reverse().slice(0, historyLimit);
  const chats = state.conversations.filter(c => c.projectId === p.id);
  return `<section class="panel history"><div class="panel-heading"><div><h2>Cycle history <span class="badge" style="margin-left:6px">${all.length}</span></h2><p>Each request, from typing to stop.</p></div><div class="history-controls"><select id="history-filter" aria-label="Filter history by conversation"><option value="">All conversations</option>${chats.map(c => `<option value="${c.id}" ${historyFilter === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></div></div>${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Cycle</th><th>Request / conversation</th><th><i class="color-key human"></i>Human</th><th><i class="color-key assistant"></i>Assistant</th><th>Wait</th><th>Outcome</th><th><span class="small">Audit</span></th></tr></thead><tbody>${shown.map(c => `<tr><td class="cycle-number">${String(all.indexOf(c) + 1).padStart(2,'0')}</td><td><div class="cycle-title" title="${esc(c.request)}">${esc(c.request)}</div><div class="cycle-subtitle">${esc(chat(c.conversationId)?.title)} · ${date(c.submittedAt)}</div></td><td title="${c.humanMs} ms">${duration(c.humanMs)}</td><td data-cycle-assistant="${c.id}" title="${assistantMs(c)} ms">${duration(assistantMs(c))}</td><td class="muted" data-cycle-wait="${c.id}">${duration(waitMs(c))}</td><td>${cycleStatus(c)}</td><td><button class="icon-btn" aria-label="Audit cycle ${all.indexOf(c) + 1}" data-audit="${c.id}">${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>Showing ${shown.length} of ${filtered.length} cycles${historyLimit < filtered.length ? ' <button class="btn sm ghost" data-action="more-history">Show more</button>' : ''}</span><span>Rounded to seconds · exact values in audit</span></div>` : `<div class="empty"><div class="empty-icon">${icon('cycle')}</div><h2>${historyFilter ? 'No cycles in this conversation' : 'Ready for your first request?'}</h2><p>Open the workspace and start typing. Timing is automatic.</p><button class="btn primary" data-page="workspace">Open workspace ${icon('arrow')}</button></div>`}</section>`;
}
function conversations(p) {
  const chats = state.conversations.filter(c => c.projectId === p.id);
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h2>Contributions by conversation</h2><button class="btn primary" data-action="new-conversation">${icon('plus')}New conversation</button></div><div class="conversation-grid">${chats.map(c => {
    const t = totals(p.id, c.id);
    return `<section class="panel"><h3>${icon('chat')} ${esc(c.title)}</h3><p>${t.count} cycle${t.count === 1 ? '' : 's'} · created ${date(c.createdAt)}</p><div class="conversation-metrics"><div><strong>${short(t.human)}</strong><span>HUMAN</span></div><div><strong>${short(t.assistant)}</strong><span>ASSISTANT</span></div><div><strong>${short(t.work)}</strong><span>TOTAL WORK</span></div></div><button class="btn" data-conversation="${c.id}">Open conversation ${icon('arrow')}</button></section>`;
  }).join('') || '<section class="panel empty"><h2>No conversations yet</h2><p>Create a conversation for this initiative. You can add more as the work moves.</p></section>'}</div>`;
}
function workspace(p) {
  const chats = state.conversations.filter(c => c.projectId === p.id);
  if (!chats.some(c => c.id === conversationId)) conversationId = chats[0]?.id;
  const current = chat(conversationId), draft = state.drafts[conversationId], cycles = projectCycles(p.id).filter(c => c.conversationId === conversationId);
  const busy = projectCycles(p.id).some(c => c.finishedAt === null), active = state.activeProjectId === p.id;
  const otherDraft = Object.values(state.drafts).find(d => d.projectId === p.id && d.conversationId !== conversationId && d.text.trim());
  return `<div class="banner">${icon('sparkle')}<span>Mock assistant · quick notes from the sample apps.</span></div><div class="workspace-grid"><aside class="panel workspace-sidebar"><div><h3>Conversations</h3><div class="conversation-buttons">${chats.map(c => `<button class="conversation-button ${c.id === conversationId ? 'selected' : ''}" data-conversation="${c.id}">${icon('chat')}${esc(c.title)}</button>`).join('')}</div><button class="btn sm ghost" data-action="new-conversation">${icon('plus')}New conversation</button></div><div><h3 style="margin-top:12px">Workspace context</h3><div class="area-options">${['transactions','contacts','analytics'].map(area => `<label><input type="checkbox" name="area" value="${area}" ${areas.has(area) ? 'checked' : ''}>${icon('folder')}${area}</label>`).join('')}</div></div><div class="workspace-info">Pick the apps to look at. Time stays with <strong>${esc(p.name)}</strong>.</div></aside><section class="panel chat-panel"><div class="chat-header"><h2>${esc(current?.title || 'Start a conversation')}</h2><span class="badge ${active ? 'active' : ''}">${active ? 'Timing enabled' : 'Project inactive'}</span></div><div class="messages" id="messages">${cycles.length ? cycles.map(c => `<div class="message user"><div class="message-head"><span class="avatar">YO</span>You<small>${duration(c.humanMs)} composing · ${time(c.submittedAt)}</small></div><p>${esc(c.request)}</p></div><div class="message assistant-message"><div class="message-head"><span class="avatar">${icon('sparkle')}</span>${c.adapter === 'external' ? 'External assistant' : c.sample ? 'Example assistant' : 'Local mock assistant'}<small>${c.finishedAt === null ? 'Working…' : `${duration(assistantMs(c))} working`}</small></div>${assistantReply(c)}</div>`).join('') : `<div class="message empty-message">${icon('chat')}What should we look at?<br><span class="small">Try “What’s in these apps?”</span></div>`}</div>${!current ? `<div class="locked-composer">Give this conversation a name to begin.<br><button class="btn primary" data-action="new-conversation">${icon('plus')}New conversation</button></div>` : !active ? `<div class="locked-composer">Make this project active to start.<br><button class="btn primary" data-action="activate" data-id="${p.id}">Make this project active</button></div>` : otherDraft ? `<div class="locked-composer">You have an unfinished draft in another conversation.<br><button class="btn" data-conversation="${otherDraft.conversationId}">Return to draft</button></div>` : busy ? `<div class="locked-composer">${icon('sparkle')} Working on it. You can send another request when it’s done.</div>` : `<form class="composer" id="composer"><textarea id="request" aria-label="Compose a request" maxlength="10000" placeholder="What would you like to work on?" ${!online ? 'disabled' : ''}>${esc(draft?.text || '')}</textarea><div class="composer-footer"><span class="composer-meta" id="composition-clock">${icon('clock')}Type to start timing</span><div class="composer-actions"><button type="button" class="btn sm ghost" data-action="discard-draft" title="Discard unsubmitted text">Discard</button><button type="submit" id="send-request" class="btn primary" ${!online ? 'disabled' : ''}>Send ${icon('send')}</button></div></div></form>`}</section></div>`;
}
function files() {
  return `<div class="page-heading"><div><div class="heading-tags"><span class="eyebrow">Workspace notes</span><span class="badge">Mock apps</span></div><h1>What’s in the workspace?</h1><p>Three small apps. One project can touch them all.</p></div></div><section class="panel"><div class="panel-heading"><h2>${icon('folder')} App notes</h2><span class="badge">Read only</span></div><div class="file-list">${workspaceFiles ? workspaceFiles.map(file => `<article class="file-card"><h3>${icon('folder')} ${esc(file.area[0].toUpperCase() + file.area.slice(1))}</h3><div class="file-notes">${readingNotes((file.notes || 'Notes are not available yet.').replace(/^# [^\n]+\n+/, ''))}</div><details class="source-details"><summary>View source file <span>${esc(file.path)}</span></summary><pre>${esc(file.content)}</pre></details></article>`).join('') : '<p class="muted">Loading app notes…</p>'}</div></section>`;
}
function readingNotes(text) {
  return String(text).split(/\n\s*\n/).filter(Boolean).map(block => {
    if (/^Next idea:/.test(block)) return `<p class="next-idea"><strong>Next idea</strong>${esc(block.replace(/^Next idea:\s*/, ''))}</p>`;
    return `<p>${esc(block)}</p>`;
  }).join('');
}
function assistantReply(c) {
  if (c.finishedAt === null) return '<p class="pulse">Taking a look…</p>';
  const readingView = legacyReadingView(c);
  return `<div class="reply-notes">${readingNotes(readingView || c.response)}</div>${readingView ? `<details class="source-details"><summary>View original saved reply</summary><pre>${esc(c.response)}</pre></details>` : ''}`;
}
function welcome() {
  return `<div class="page-heading"><div><div class="heading-tags"><span class="eyebrow">Your workspace</span></div><h1>Good work starts with an initiative.</h1><p>Name what you’re working toward. Tempo will keep the time together.</p></div></div><section class="panel welcome"><div class="empty"><div class="empty-icon">${icon('clock')}</div><h2>One project. The whole picture.</h2><p>See how much time went into your requests, how long the assistant worked, and where each cycle stopped.</p><div class="empty-actions"><button class="btn primary" data-action="new-project">${icon('plus')}Create your first project</button><button class="btn" data-action="samples">Explore example data ${icon('arrow')}</button></div></div><div class="welcome-steps"><div><div class="step-number">01 / NAME IT</div><h3>Define the initiative</h3><p>A goal, not a folder. Pick the project before timing begins.</p></div><div><div class="step-number">02 / WORK NATURALLY</div><h3>Type. Send. Continue.</h3><p>Composition and assistant work are recorded automatically.</p></div><div><div class="step-number">03 / SEE THE STORY</div><h3>Trust every total</h3><p>Audit each cycle. Waiting ends after five minutes.</p></div></div></section>`;
}
function render() {
  if (!state) return;
  renderSignature = stateSignature();
  const p = selectedProject();
  const textarea = $('#request');
  const preserve = textarea ? { value: textarea.value, focused: document.activeElement === textarea, start: textarea.selectionStart, end: textarea.selectionEnd, conversation: conversationId } : null;
  const oldMessages = $('#messages');
  const nearBottom = !oldMessages || oldMessages.scrollHeight - oldMessages.scrollTop - oldMessages.clientHeight < 90;
  const oldScroll = oldMessages?.scrollTop || 0;
  app.innerHTML = `<div class="shell ${menuOpen ? 'menu-open' : ''}">${sidebar()}<main class="main"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="menu" aria-label="Toggle navigation">${icon('menu')}</button><span>Workspace</span><span>/</span><strong>${page === 'overview' ? 'Project overview' : page === 'workspace' ? 'Work with assistant' : 'Workspace files'}</strong></div><div class="top-actions"><span class="save-status">${icon('check')}${online ? 'Saved on this device' : 'Disconnected'}</span><a class="btn" href="/api/export" download>${icon('down')}Export log</a></div></header><div class="content">${!online ? '<div class="banner connection-error" role="alert">The local server is unavailable or could not save. Timing controls are disabled until it reconnects. Your saved records are safe.</div>' : ''}${page === 'files' ? files() : p ? `${heading(p)}${page === 'overview' ? `<div class="tabs" role="tablist" aria-label="Project views"><button class="tab ${tab === 'overview' ? 'selected' : ''}" role="tab" aria-selected="${tab === 'overview'}" data-tab="overview">Overview</button><button class="tab ${tab === 'conversations' ? 'selected' : ''}" role="tab" aria-selected="${tab === 'conversations'}" data-tab="conversations">Conversations <span class="count">${state.conversations.filter(c => c.projectId === p.id).length}</span></button><span class="date-note">All time · ${p.sample ? 'Illustrative records' : `Since ${date(p.createdAt)}`}</span></div>${tab === 'overview' ? overview(p) : conversations(p)}` : workspace(p)}` : welcome()}<div class="footer-note"><span>${icon('shield')}Saved on your computer.</span><span>Total work = you + assistant. Waiting is separate.</span></div></div></main></div>`;
  if (menuOpen) {
    const backdrop = document.createElement('button');
    backdrop.className = 'nav-backdrop';
    backdrop.dataset.action = 'menu';
    backdrop.setAttribute('aria-label', 'Close navigation');
    $('.shell').prepend(backdrop);
  }
  const nextTextarea = $('#request');
  if (preserve && nextTextarea && preserve.conversation === conversationId) {
    nextTextarea.value = preserve.value;
    if (preserve.focused) { nextTextarea.focus({ preventScroll: true }); nextTextarea.setSelectionRange(preserve.start, preserve.end); }
  }
  const messages = $('#messages');
  if (messages) messages.scrollTop = nearBottom ? messages.scrollHeight : oldScroll;
  bindComposer();
  updateLive();
}
function updateLive() {
  if (!state || !online) return;
  for (const el of document.querySelectorAll('[data-project-total]')) el.textContent = short(totals(el.dataset.projectTotal).work);
  const p = selectedProject();
  if (!p) return;
  const t = totals(p.id);
  for (const el of document.querySelectorAll('[data-metric]')) el.innerHTML = bigTime(t[el.dataset.metric]);
  for (const el of document.querySelectorAll('[data-legend]')) el.textContent = short(t[el.dataset.legend]);
  if ($('[data-donut-total]')) $('[data-donut-total]').textContent = short(t.work);
  const donut = $('.donut');
  if (donut) {
    const percentage = t.work ? Math.round(t.human / t.work * 100) : 0;
    donut.style.setProperty('--human-angle', `${percentage * 3.6}deg`);
    donut.classList.toggle('empty', !t.work);
    donut.setAttribute('aria-label', `Human ${percentage} percent, assistant ${t.work ? 100 - percentage : 0} percent`);
    const shares = document.querySelectorAll('.legend-row small');
    if (shares[0]) shares[0].textContent = `${percentage}% of work`;
    if (shares[1]) shares[1].textContent = `${t.work ? 100 - percentage : 0}% of work`;
  }
  if ($('#live-status')) $('#live-status').innerHTML = statusContent(p);
  for (const el of document.querySelectorAll('[data-cycle-assistant]')) { const c = state.cycles.find(c => c.id === el.dataset.cycleAssistant); if (c) el.textContent = duration(assistantMs(c)); }
  for (const el of document.querySelectorAll('[data-cycle-wait]')) { const c = state.cycles.find(c => c.id === el.dataset.cycleWait); if (c) el.textContent = duration(waitMs(c)); }
  const draft = state.drafts[conversationId], clock = $('#composition-clock');
  if (clock) clock.innerHTML = `${icon('clock')}${draft ? `${duration(draft.elapsedMs + (draft.startedAt === null ? 0 : now() - draft.startedAt))} composing${draft.startedAt === null ? ' · paused' : ''}` : 'Type to start timing'}`;
}
async function saveDraft(focused) {
  const textarea = $('#request');
  if (!textarea || !conversationId || submitting || !online) return;
  const target = conversationId;
  await action('draft', { conversationId: target, text: textarea.value, focused: focused ?? (document.activeElement === textarea && !document.hidden) });
  updateLive();
}
async function leaveComposer() {
  clearTimeout(draftDebounce);
  if ($('#request') && !submitting && online) await saveDraft(false);
}
function bindComposer() {
  const textarea = $('#request');
  if (!textarea) return;
  textarea.addEventListener('input', () => {
    clearTimeout(draftDebounce);
    if (!state.drafts[conversationId]) saveDraft(true).catch(error => notify(error.message));
    else draftDebounce = setTimeout(() => saveDraft(true).catch(error => notify(error.message)), 250);
  });
  textarea.addEventListener('focus', () => { if (textarea.value) saveDraft(true).catch(error => notify(error.message)); });
  textarea.addEventListener('blur', () => { clearTimeout(draftDebounce); saveDraft(false).catch(error => notify(error.message)); });
  textarea.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('#composer').requestSubmit(); } });
  $('#composer').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !textarea.value.trim()) { if (!textarea.value.trim()) textarea.focus(); return; }
    const text = textarea.value;
    clearTimeout(draftDebounce);
    $('#send-request').disabled = true;
    submitting = true;
    try {
      await action('draft', { conversationId, text, focused: false });
      await action('submit', { conversationId, text, areas: [...areas], requestKey: crypto.randomUUID() });
      textarea.value = '';
      render();
    } catch (error) { notify(error.message); if ($('#send-request')) $('#send-request').disabled = false; }
    finally { submitting = false; }
  });
}
function openDialog(title, body) {
  dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-btn" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;
  dialog.showModal();
}
function projectDialog() {
  openDialog('What are you working on?', `<p>A project is a named initiative. It can span any number of apps, files, and conversations.</p><form id="project-form"><div class="field"><label for="project-name">Project name <span class="muted">· required</span></label><input id="project-name" name="name" placeholder="e.g. Launch the customer insights dashboard" required maxlength="100" autofocus><small>Give the project a name you’ll recognize.</small></div><div class="field"><label for="project-description">Short description <span class="muted">· optional</span></label><textarea id="project-description" name="description" maxlength="500" placeholder="What should be different when this work is done?"></textarea></div><div class="form-error" id="form-error" role="alert"></div><div class="dialog-footer"><button class="btn" type="button" data-action="close-dialog">Cancel</button><button class="btn primary" type="submit">Create project ${icon('arrow')}</button></div></form>`);
  $('#project-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter; button.disabled = true;
    try {
      const form = new FormData(event.target);
      const p = await action('createProject', { name: form.get('name'), description: form.get('description') });
      selected = p.id; localStorage.setItem('tempo.selected', selected); page = 'overview'; tab = 'overview'; historyFilter = '';
      // Creation never silently reassigns an unfinished request.
      if (!Object.values(state.drafts).some(d => d.text.trim())) await action('activateProject', { projectId: p.id });
      await action('createConversation', { projectId: p.id, title: 'Getting started' });
      dialog.close(); render(); notify('Project ready. Start whenever you like.');
    } catch (error) { $('#form-error').textContent = error.message; button.disabled = false; }
  });
}
function conversationDialog() {
  if (!selectedProject()) return projectDialog();
  openDialog('A new conversation', `<p>Its time will roll up to <strong>${esc(selectedProject().name)}</strong>.</p><form id="conversation-form"><div class="field"><label for="conversation-name">Conversation name</label><input id="conversation-name" name="title" placeholder="e.g. Explore the transaction flow" required maxlength="100" autofocus></div><div class="form-error" id="form-error" role="alert"></div><div class="dialog-footer"><button class="btn" type="button" data-action="close-dialog">Cancel</button><button class="btn primary" type="submit">Create conversation</button></div></form>`);
  $('#conversation-form').addEventListener('submit', async event => {
    event.preventDefault(); event.submitter.disabled = true;
    try {
      const c = await action('createConversation', { projectId: selected, title: new FormData(event.target).get('title') });
      conversationId = c.id; page = 'workspace'; dialog.close(); render();
    } catch (error) { $('#form-error').textContent = error.message; event.submitter.disabled = false; }
  });
}
function methodDialog() {
  openDialog('How the timer works', `<p>Time belongs to a named project. Conversation and folder changes don’t create a new initiative.</p><div class="timing-rule"><span class="rule-icon">${icon('human')}</span><div><h3>1. Compose a request</h3><p>Timing starts with your first edit and runs while the composer is focused. Leaving it pauses the draft. Only submitted requests count toward the total; discarded drafts don’t.</p></div></div><div class="timing-rule"><span class="rule-icon">${icon('sparkle')}</span><div><h3>2. Let the assistant work</h3><p>We count from request submission until the response finishes, including tool work. The built-in assistant is a local mock that inspects the selected files.</p></div></div><div class="timing-rule"><span class="rule-icon">${icon('clock')}</span><div><h3>3. Continue, or let it stop</h3><p>After the response, the cycle waits for the next submitted request on this project, across all conversations. At exactly five minutes it stops. Waiting and idle gaps are excluded from counted work.</p></div></div><div class="audit-formula">Counted work = submitted human composition + assistant work</div><p class="small">Records persist in a local data file, across browser and server restarts. A server interruption keeps assistant time only through its last saved heartbeat. On an unexpected browser disconnect, an unsubmitted draft pauses at its last heartbeat. External chats require the documented event API; they are not monitored automatically.</p>`);
}
function auditDialog(id) {
  const c = state.cycles.find(c => c.id === id), p = state.projects.find(p => p.id === c.projectId);
  const work = c.humanMs + assistantMs(c);
  openDialog(`Cycle ${String(projectCycles(p.id).indexOf(c) + 1).padStart(2,'0')} · the audit trail`, `<p>${esc(chat(c.conversationId)?.title)}${c.sample ? ' · illustrative example data' : ''}</p><div class="audit-formula"><strong>${duration(work)} counted work</strong><p class="small">${duration(c.humanMs)} human + ${duration(assistantMs(c))} assistant<br>${duration(waitMs(c))} waiting · excluded from total</p><p class="small muted">Exact values: ${c.humanMs} ms + ${assistantMs(c)} ms</p></div><div class="audit-timestamps"><div><span>First composition input</span><strong>${stamp(c.compositionStartedAt)}</strong></div><div><span>Request submitted / assistant started</span><strong>${stamp(c.submittedAt)}</strong></div><div><span>Assistant finished</span><strong>${c.finishedAt === null ? 'Working now' : stamp(c.finishedAt)}</strong></div><div><span>Cycle ended</span><strong>${c.endedAt === null ? 'Still open' : stamp(c.endedAt)}</strong></div><div><span>End reason</span><strong>${cycleStatus(c)}</strong></div><div><span>Workspace areas</span><strong>${esc(c.areas.join(', ') || 'All mock apps')}</strong></div><div><span>Assistant source</span><strong>${esc(c.adapter)}</strong></div></div><p class="small muted">Human time sums focused composition intervals. It can be shorter than the gap between first input and submission. ${c.endReason === 'idle' ? 'The idle stop is exactly 300,000 ms after the assistant finished.' : ''}</p><div class="audit-prompt">${esc(c.request)}</div>`);
  if (c.compositionIntervals?.length) {
    $('.audit-prompt').insertAdjacentHTML('beforebegin', '<details class="audit-intervals"><summary>Inspect focused composition intervals</summary>' + c.compositionIntervals.map(interval => '<div><span>' + time(interval.startedAt) + ' → ' + time(interval.endedAt) + '</span><strong>' + (interval.endedAt - interval.startedAt) + ' ms</strong></div>').join('') + '</details>');
  }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action],[data-page],[data-project],[data-tab],[data-conversation],[data-audit]');
  if (!button) return;
  try {
    if (button.dataset.project) { await leaveComposer(); selected = button.dataset.project; localStorage.setItem('tempo.selected', selected); historyFilter = ''; historyLimit = 6; conversationId = null; menuOpen = false; render(); }
    else if (button.dataset.page) {
      await leaveComposer(); page = button.dataset.page; menuOpen = false;
      if (page === 'files' && !workspaceFiles) { const response = await fetch('/api/workspace'); if (!response.ok) throw new Error('Could not load workspace files.'); workspaceFiles = await response.json(); }
      render();
    }
    else if (button.dataset.tab) { tab = button.dataset.tab; render(); }
    else if (button.dataset.conversation) { await leaveComposer(); conversationId = button.dataset.conversation; selected = chat(conversationId).projectId; page = 'workspace'; render(); }
    else if (button.dataset.audit) auditDialog(button.dataset.audit);
    else switch (button.dataset.action) {
      case 'new-project': await leaveComposer(); projectDialog(); break;
      case 'new-conversation': await leaveComposer(); conversationDialog(); break;
      case 'method': await leaveComposer(); methodDialog(); break;
      case 'close-dialog': dialog.close(); break;
      case 'activate': await action('activateProject', { projectId: button.dataset.id }); render(); notify('Active project changed. Existing time stays where it belongs.'); break;
      case 'deactivate': await leaveComposer(); await action('activateProject', { projectId: null }); render(); notify('Project deactivated. Submit or activate a project to continue work.'); break;
      case 'discard-draft': {
        clearTimeout(draftDebounce);
        await action('discardDraft', { conversationId });
        if ($('#request')) $('#request').value = '';
        render(); notify('Draft discarded. No human time was added.'); break;
      }
      case 'samples': button.disabled = true; await action('addSamples'); selected = state.projects.find(p => p.sample).id; render(); notify('Example projects loaded. They are clearly labeled and not active.'); break;
      case 'more-history': historyLimit += 10; render(); break;
      case 'menu': menuOpen = !menuOpen; render(); break;
      case 'retry': online = true; await sync(true); break;
    }
  } catch (error) { notify(error.message); button.disabled = false; }
});
document.addEventListener('change', event => {
  if (event.target.id === 'history-filter') { historyFilter = event.target.value; historyLimit = 6; render(); }
  if (event.target.name === 'area') { if (event.target.checked) areas.add(event.target.value); else areas.delete(event.target.value); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuOpen) { menuOpen = false; render(); $('.mobile-menu')?.focus(); }
  if (event.target.matches('[data-tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    tab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'conversations' : tab === 'overview' ? 'conversations' : 'overview';
    render(); document.querySelector(`[data-tab="${tab}"]`).focus();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) leaveComposer().catch(() => {}); else sync(); });
window.addEventListener('blur', () => { if ($('#request')) saveDraft(false).catch(() => {}); });
window.addEventListener('focus', () => { if ($('#request') === document.activeElement) saveDraft(true).catch(() => {}); });
window.addEventListener('pagehide', () => {
  clearTimeout(draftDebounce);
  const textarea = $('#request');
  if (!textarea || !token || !conversationId || submitting) return;
  fetch('/api/action', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Timer-Token': token }, body: JSON.stringify({ action: 'draft', conversationId, text: textarea.value, focused: false }) }).catch(() => {});
});
setInterval(() => { if (!document.hidden) sync(); }, 1500);
setInterval(() => {
  if (!document.hidden && document.hasFocus() && document.activeElement === $('#request') && $('#request')?.value && !submitting) saveDraft(true).catch(error => notify(error.message));
}, 3000);
setInterval(updateLive, 1000);
await sync(true);
