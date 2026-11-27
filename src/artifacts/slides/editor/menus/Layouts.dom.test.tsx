// P3-C final fix wave (B5; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10, "New slide from layout"): a
// design system's layout thumbnail draws the pictures it names from the system's own assets, and picking it names the
// system, whose assets the inserted slide copies.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemHostContext } from '../../../design-system/apply';
import { writeSystem } from '../../../design-system/model';
import type { ArtifactHost, DocumentHandle } from '../../../host';
import { defaultSystem, HOUSE_KEY } from '../../../types/design_system/defaults';
import { newDoc } from '../../../yjs';
import { LayoutsMenu } from './Layouts';

const BRANDED = `<section id="branded" style="background:#ffffff">
<img id="logo" src="assets/logo.png" alt="Logo" style="position:absolute; left:64px; top:64px; width:200px; height:80px">
<h1 id="t" style="font-size:96px">Title</h1>
</section>`;

afterEach(cleanup);

describe('a design system’s layout thumbnail (final fix wave B5)', () => {
  it('draws its pictures from the system’s assets, and the pick names the system', async () => {
    const doc = newDoc();
    const house = defaultSystem(HOUSE_KEY)!.files;
    writeSystem(doc, { ...house, 'layouts/branded.html': BRANDED }, { route: 'derived', at: Date.UTC(2026, 9, 13) }, { name: 'Harbor' });
    const handle = { doc, state: () => ({ phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false }), subscribe: () => () => {}, close: () => {} } as unknown as DocumentHandle;
    const host = { open: vi.fn(async () => handle), assetUrl: (id: string, ref: string) => `maws-artifact://${id}/live/${ref}` } as unknown as ArtifactHost;
    const onPick = vi.fn();
    render(
      <DesignSystemHostContext.Provider value={host}>
        <LayoutsMenu system={{ id: 'sys-1' }} disabled={false} scope={(children) => children} onPick={onPick} />
      </DesignSystemHostContext.Provider>,
    );
    const trigger = screen.getByRole('button', { name: 'From layout' });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    });
    const item = await vi.waitFor(() => {
      const found = document.querySelector('[data-layout="branded"]');
      if (!found) throw new Error('not listed yet');
      return found as HTMLElement;
    });
    expect(item.querySelector('img')!.getAttribute('src')).toBe('maws-artifact://sys-1/live/assets/logo.png');
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onPick).toHaveBeenCalledWith({ slide: expect.objectContaining({ id: 'branded' }), system: 'sys-1' });
  });
});

// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3; G421): the menu's wait is the quiet
// spinner, and every read settles: "No layouts" for a system without any or none at all, "Layouts could not be read"
// with the reason for a failed one. At the deck's limit the trigger is greyed with the limit as its reason (G423).
describe('the From layout menu’s states (G421)', () => {
  const open = async () => {
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'From layout' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    });
  };
  const withHost = (host: ArtifactHost, system: { id: string } | null) =>
    render(
      <DesignSystemHostContext.Provider value={host}>
        <LayoutsMenu system={system} disabled={false} scope={(children) => children} onPick={() => {}} />
      </DesignSystemHostContext.Provider>,
    );

  it('waits with the quiet spinner, no words', async () => {
    withHost({ open: () => new Promise(() => {}), assetUrl: () => null } as unknown as ArtifactHost, { id: 'slow' });
    await open();
    expect(screen.getByRole('menu').textContent).toBe('');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeTruthy();
  });

  it('a failed read says so with its reason; no system at all reads No layouts', async () => {
    withHost({ open: async () => Promise.reject(new Error('gone')), assetUrl: () => null } as unknown as ArtifactHost, { id: 'broken' });
    await open();
    await vi.waitFor(() => expect(screen.getByRole('menu').textContent).toBe('Layouts could not be read: gone'));
    cleanup();
    withHost({ open: () => new Promise(() => {}), assetUrl: () => null } as unknown as ArtifactHost, null);
    await open();
    expect(screen.getByRole('menu').textContent).toBe('No layouts');
  });

  // the whole-branch review's fix wave: a deck whose placement is not read yet is not a deck with no system: the menu
  // waits with the quiet spinner, and a read that failed says so with its reason, never a false No layouts
  it('waits while the deck’s placement is read, and says a failed read with its reason', async () => {
    render(<LayoutsMenu system={null} systemUnread="reading" disabled={false} scope={(children) => children} onPick={() => {}} />);
    await open();
    expect(screen.getByRole('menu').textContent).toBe('');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeTruthy();
    cleanup();
    render(<LayoutsMenu system={null} systemUnread={{ failed: 'offline' }} disabled={false} scope={(children) => children} onPick={() => {}} />);
    await open();
    expect(screen.getByRole('menu').textContent).toBe('Layouts could not be read: offline');
  });

  it('at the deck’s limit the trigger is greyed, still focusable, the limit its reason', () => {
    render(<LayoutsMenu system={null} disabled={false} unavailable="A deck holds at most 500 slides: delete one to add another." scope={(children) => children} onPick={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'From layout' });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect(trigger.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
