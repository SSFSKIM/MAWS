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
