// The transcript surface's lazy components (./lazy.tsx). Once a chunk has loaded, a component draws in its first commit:
// React.lazy suspends the first instance it ever renders even when the import resolved long before, so the first
// consumer drew nothing for a commit (BtwView, the first after launch, then pinned its log's scroll to the questions
// alone). An instance mounted before its chunk arrives draws once it does, and is not remounted by a later render.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules()); // a fresh lazy.tsx: each case is the first to render its components
afterEach(() => {
  cleanup();
  vi.doUnmock('./view/markdown/Markdown');
});

const strong = (container: HTMLElement) => container.querySelector('[data-streamdown="strong"]');

it('draws Markdown in its first instance’s first commit once the chunk has loaded', async () => {
  const { Markdown } = await import('./lazy');
  await import('./view/markdown/Markdown'); // the chunk lazy.tsx started loading on evaluation
  await new Promise((resolve) => setTimeout(resolve, 0));
  const view = render(<Markdown markdown="An **answer**." live={false} />);
  expect(strong(view.container)?.textContent).toBe('answer');
}, 60_000);

it('draws an instance mounted before the chunk loads once it does, and keeps it through a later render', async () => {
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  vi.doMock('./view/markdown/Markdown', async (original) => {
    await arrived;
    return original();
  });
  const { Markdown } = await import('./lazy');
  const view = render(<Markdown markdown="An **answer**." live={false} />);
  expect(view.container.textContent).toBe('');
  arrive();
  await waitFor(() => expect(strong(view.container)).not.toBeNull(), { timeout: 30_000 });
  const drawn = strong(view.container);
  view.rerender(<Markdown markdown="An **answer**." live={false} />);
  expect(strong(view.container)).toBe(drawn); // the same node: not remounted onto the loaded module
}, 60_000);
