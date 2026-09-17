// Turn the old mock file dump into a short reading view. Saved records stay intact.
export function legacyReadingView(cycle) {
  if (cycle.adapter !== 'local-mock' || !cycle.response?.startsWith('Local mock assistant · workspace inspection')) return null;
  const blocks = cycle.response.split(/\n\n/).filter(block => /^(transactions|contacts|analytics)\/index\.js/.test(block));
  const notes = blocks.map(block => {
    if (block.startsWith('transactions/')) return /status:\s*'pending'/.test(block)
      ? 'Transactions\nOne example order is waiting for review.\nNext idea: sketch the approval flow.'
      : 'Transactions\nThe mock transaction file was checked.\nNext idea: outline the review flow.';
    if (block.startsWith('contacts/')) return 'Contacts\nThe mock customer file was checked.\nNext idea: choose the details to show beside an order.';
    return 'Analytics\nThe mock dashboard file was checked.\nNext idea: sketch the summary cards.';
  });
  return `Here’s the quick version.\n\n${notes.join('\n\n')}\n\nMock walkthrough only. No files were changed.`;
}
