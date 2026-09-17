# External assistant integration

Tempo ships with an instrumented composer and a local mock assistant. A real
chat host can send the same lifecycle events. **Do not infer timing from file
modification times, Git branches, or a chat's directory.**

Set a strong `TIMER_API_TOKEN` in the server environment for trusted local host
integrations. The normal UI uses a separate process-scoped CSRF token. Do not
place the adapter token in frontend source, URLs, or a committed `.env` file.

Send JSON to `POST http://127.0.0.1:4317/api/action` with the header
`X-Timer-Token: <your token>`. No client-supplied timestamps are accepted: the
server timestamps each received event. Host-to-server latency is consequently
included at the event boundaries. This API is local-only.

| `action` | Additional properties | Result |
| --- | --- | --- |
| `createProject` | `name`, optional `description` | Project; does not itself activate |
| `activateProject` | `projectId` (or `null` to deactivate) | Explicitly changes future work attribution |
| `createConversation` | `projectId`, `title` | Conversation under an existing project |
| `draft` | `conversationId`, `text`, `focused` | Starts/updates/pauses composition; heartbeat at least every 3 seconds while focused |
| `pauseDraft` | `conversationId` | Settles the focused interval |
| `discardDraft` | `conversationId` | Discards text and unsubmitted composition |
| `submit` | `conversationId`, `text`, `requestKey`, `external: true`, optional `areas` | Cycle; assistant time starts |
| `finish` | `cycleId`, optional `response`, optional `failed` | Ends assistant work and starts waiting, or records failure |

Use a unique stable `requestKey` for each submission and reuse it when retrying a
lost acknowledgement. A duplicate submission does not create another cycle.
`finish` is idempotent. `areas` is optional metadata, limited to `transactions`,
`contacts`, and `analytics`; it never controls project attribution. The response
envelope is `{ result, state, serverNow }`; errors return `{ error }` with a 4xx
or 503 status. `GET /api/state` retrieves current local records and `GET
/api/export` downloads a complete portable audit log.

## Host example

```js
import { TimerClient } from './lib/client.mjs';

const timer = new TimerClient({ token: process.env.TIMER_API_TOKEN });
const project = await timer.event('createProject', {
  name: 'Improve the customer onboarding journey',
});
await timer.event('activateProject', { projectId: project.id });
const chat = await timer.event('createConversation', {
  projectId: project.id, title: 'Investigate the transaction flow',
});

// In the actual host, wire this to its first input, edits, focus/blur and
// a 3-second focused-composer heartbeat. Do not ask the human to operate it.
await timer.event('draft', {
  conversationId: chat.id, text: 'Inspect the transaction flow', focused: true,
});

// In the host's submit callback:
const requestKey = crypto.randomUUID();
const cycle = await timer.event('submit', {
  conversationId: chat.id,
  text: 'Inspect the transaction flow',
  requestKey,
  external: true,
  areas: ['transactions', 'contacts'],
});
try {
  const response = await yourAssistant.run('Inspect the transaction flow');
  // Call only after streaming AND tools have finished.
  await timer.event('finish', { cycleId: cycle.id, response });
} catch (error) {
  await timer.event('finish', {
    cycleId: cycle.id, response: String(error.message), failed: true,
  });
}
```

`yourAssistant` above is an integration point, not a bundled AI SDK. Keep the
adapter token on the host side. Existing external cycles that have not received
`finish` keep running while this server is alive; hosts must send a failed finish
on cancellation/disconnection. Server restart recovery marks them interrupted
using the last saved heartbeat. Clock changes on the local machine can affect
wall-clock measurements; this prototype does not implement distributed clock
synchronization.
