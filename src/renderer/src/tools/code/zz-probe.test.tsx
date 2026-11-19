// temporary probe: what the window draws, beside what the rule names
import { cleanup, fireEvent, render } from '@testing-library/react';
import { it, vi } from 'vitest';
import { linkPaths } from '@shared/files/named';
import { Markdown } from '../../transcript';
import { TranscriptActionsProvider } from '../../transcript/view/context';

const S = [
  'x `y\n2) [r](/s) `', 'x `y\n2. [r](/s) `', 'x `y\n-\n[r](/s) `', 'x `y\n- \n[r](/s) `', 'x `y\n1.\n[r](/s) `', 'x `y\n1. [r](/s) `',
  'a | b\n-|-\n2) x | y | [r](/s)', 'a | b\n-|-\n1. x | y | [r](/s)', 'a | b\n-|-\n- x | y | [r](/s)', 'a | b\n-|-\n-\n[r](/s)', 'a | b\n-|-\n`x\n2) y`\n[r](/s)',
  '> p `x\n2) [r](/s) `', '> p `x\n-\n[r](/s) `', '- a `x\n2. [r](/s) `', '1. a `x\n2. [r](/s) `', '1. a `x\n3) [r](/s) `', '- a `x\n-\n[r](/s) `', '- a `x\n+ [r](/s) `',
  'x `y\n    [r](/s) `', 'x `y\n===\n[r](/s) `', 'x `y\n---\n[r](/s) `', '- a\n\n  x `y\n  2) [r](/s) `',
];
it('probe', async () => {
  render(<Markdown markdown="load" live={false} />);
  await new Promise((r) => setTimeout(r, 500));
  cleanup();
  for (const markdown of S) {
    const openFile = vi.fn();
    const { container } = render(<TranscriptActionsProvider actions={{ openFile }}><Markdown markdown={markdown} live={false} /></TranscriptActionsProvider>);
    for (const chip of container.querySelectorAll('[data-chip="path"]')) fireEvent.click(chip);
    console.log(`PROBE ${JSON.stringify(markdown)} window=${JSON.stringify(openFile.mock.calls.map(([p]) => p))} rule=${JSON.stringify(linkPaths(markdown))}`);
    cleanup();
  }
});
