import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyReadingView } from '../public/notes.js';

test('legacy mock replies get a plain reading view without changing saved records',()=>{
  const cycle={adapter:'local-mock',response:"Local mock assistant · workspace inspection\n\nI inspected 1 mock app:\n\ntransactions/index.js — 2 lines\nexport const transactions = [{ status: 'pending' }];\n\nNo files changed."};
  const before=JSON.stringify(cycle);
  const result=legacyReadingView(cycle);
  assert.match(result,/One example order is waiting/);
  assert.match(result,/Next idea/);
  assert.doesNotMatch(result,/export const|index\.js/);
  assert.equal(JSON.stringify(cycle),before);
});
test('new or external replies are not rewritten as mock notes',()=>{
  assert.equal(legacyReadingView({adapter:'external',response:'The real response'}),null);
  assert.equal(legacyReadingView({adapter:'local-mock',response:'Here’s what I found.'}),null);
});
