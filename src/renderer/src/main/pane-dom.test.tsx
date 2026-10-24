import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { focusPaneElement } from './pane-dom';

afterEach(cleanup);

it('returns to the portaled main strip rather than a selected tool tab inside the pane', () => {
  render(<>
    <div data-chrome-pane="0"><div role="tablist"><button role="tab" aria-selected="true">Main tab</button></div></div>
    <section id="pane-0">
      <div role="tabpanel"><div role="tablist"><button role="tab" aria-selected="true">Document tool tab</button></div></div>
    </section>
  </>);
  screen.getByRole('tab', { name: 'Document tool tab' }).focus();
  focusPaneElement(0);
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Main tab' }));
});

it('constrains the legacy pane lookup to its shell strip, not a nested selected tool tab', () => {
  render(<section id="pane-1">
    <div role="tabpanel"><div role="tablist"><button role="tab" aria-selected="true">Browser tool tab</button></div></div>
    <div data-pane-strip><div role="tablist"><button role="tab" aria-selected="true">Legacy main tab</button></div></div>
  </section>);
  focusPaneElement(1);
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Legacy main tab' }));
});

it('keeps the empty pane fallback when no shell tab exists', () => {
  render(<section id="pane-0"><div role="tabpanel"><button disabled>Unavailable</button><button>Overview</button></div></section>);
  focusPaneElement(0);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Overview' }));
});
