// temporary probe: what the window draws, beside what the rule names
import { cleanup, fireEvent, render } from '@testing-library/react';
import { it, vi } from 'vitest';
import { linkPaths } from '@shared/files/named';
import { Markdown } from '../../transcript';
import { TranscriptActionsProvider } from '../../transcript/view/context';

const S = [
  '| a | b |\n|---|---|\n    [r](/s)', '| a | b |\n|---|---|\n    [r](/s) | x', '| a | b |\n|---|---|\n    x\n[r](/s)`',
  '  | a | b |\n|---|---|\n    [r](/secret)`\n1. x `y\n1.\n  |---|---|\n1. T',
  '- \n    `a\n  [r](/s)\nx `y', '- \n    [r](/s)', '-\n    `a\n[r](/s) `', '1.\n    `a\n[r](/s) `',
  '- T\n- - -\n1. \n- \n    `a\n  [r](/secret)\nx `y',
];
it('probe', async () => {
  render(<Markdown markdown="load" live={false} />);
  await new Promise((r) => setTimeout(r, 500));
  cleanup();
  for (const markdown of S) {
    const openFile = vi.fn();
    const { container } = render(<TranscriptActionsProvider actions={{ openFile }}><Markdown markdown={markdown} live={false} /></TranscriptActionsProvider>);
    for (const chip of container.querySelectorAll('[data-chip="path"]')) fireEvent.click(chip);
    console.log(`PROBE ${JSON.stringify(markdown)} window=${JSON.stringify(openFile.mock.calls.map(([p]) => p))} rule=${JSON.stringify(linkPaths(markdown))} html=${JSON.stringify(container.innerHTML.replace(/<[^>]*class="[^"]*"/g, '<x').slice(0, 300))}`);
    cleanup();
  }
});
