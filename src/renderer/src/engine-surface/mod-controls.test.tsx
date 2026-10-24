// Recorded no-inference engine 2.1.309 shapes: fixtures/p4/p4-ux1c-mod-controls.jsonl.
// The scratch plugin reproduces doperpowers PR 363 at d17d9b7, control()/spanRows().
// Engine 2.1.309 cli.pretty.js:106790-106955, 134132-134201, 134883-134897, 135267-135301.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { SurfaceTree } from './SurfaceTree';
import { parseTree } from './tree';
import journal from '../../../../spikes/protocol-probe/fixtures/p4/p4-ux1c-mod-controls.jsonl?raw';

const ID = 'mod-controls' as AppSessionId;
afterEach(cleanup);
const fixtureTree = journal.trim().split('\n').map((line) => JSON.parse(line)).find((row) => row.frame.event === 'mod_controls_tree').frame.tree as { type: string; props: Record<string, unknown>; children: unknown[] };
function setup(raw: unknown) {
  const fake = fakeClient({ 'session.ui.press': { handled: true, element: null } });
  const site = { appSessionId: ID, component: 'AbovePrompt' as const, instanceId: 'controls', client: fake.client };
  const draw = (value: unknown) => <SurfaceTree tree={parseTree(value)!} site={site} />;
  const view = render(draw(raw));
  return { fake, view, redraw: (value: unknown) => view.rerender(draw(value)) };
}

it('renders authored fold arrows and band caption while presses keep their plugin addresses', () => {
  const { fake, view } = setup(fixtureTree);
  const buttons = screen.getAllByRole('button');
  expect(buttons.map((button) => button.textContent)).toEqual(['› working record', '‹ fold to report', 'full transcript ›']);
  expect(view.container.textContent).toContain('to-human view · full transcript ›');
  buttons.forEach((button) => fireEvent.click(button));
  expect(fake.invoked('session.ui.press')).toEqual([
    { appSessionId: ID, plugin: 'mod-controls-probe', handle: 447397900, key: 'record' },
    { appSessionId: ID, plugin: 'mod-controls-probe', handle: 447397901, key: 'fold' },
    { appSessionId: ID, plugin: 'mod-controls-probe', handle: 447397902, key: 'mode' },
  ]);
});

it('a control brightens from anywhere in its keyed row without inverting, and keeps focus when rows reorder', () => {
  const { redraw } = setup(fixtureTree);
  const button = screen.getByRole('button', { name: 'working record' });
  button.focus();
  fireEvent.mouseEnter(screen.getByText('Record ·').closest('[data-surface="box"]')!);
  expect(button.style.color).toBe('var(--fg)');
  expect(button.style.backgroundColor).toBe('transparent');
  redraw({ ...fixtureTree, children: [...fixtureTree.children.slice(0, 2), fixtureTree.children[3], fixtureTree.children[2], fixtureTree.children[4]] });
  expect(screen.getByRole('button', { name: 'working record' })).toBe(button);
  expect(document.activeElement).toBe(button);
  fireEvent.mouseLeave(screen.getByText('Record ·').closest('[data-surface="box"]')!);
  expect(button.style.color).toBe('');
});

it('keeps Markdown as a single authored body and resolves the engine’s claude theme colour through tokens', () => {
  const { view } = setup(fixtureTree);
  expect(screen.getByText('message').style.color).toBe('var(--accent)');
  expect(view.container.querySelectorAll('[data-surface="markdown"]')).toHaveLength(1);
  expect([...view.container.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['First', 'Second']);
  expect(view.container.querySelector('code')?.textContent).toBe('⚠ Critical ───');
});
