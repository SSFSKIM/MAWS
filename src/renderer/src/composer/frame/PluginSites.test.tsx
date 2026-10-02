// R2: the composer's plugin sites over the trees 2.1.287 answered in pass3/mods-surface-render-sites (the band, the mode
// slot, the hint) and the working label's text from the Spinner site: present only while a plugin hooks the site.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { loadJournal } from '../../../../../test/support/fixtures';
import { resetSurfaceRegistry, useSpinnerText } from '../../engine-surface';
import { useSessions } from '../../stores/sessions';
import { PluginBand, PluginHint, PluginModeSlot } from './PluginSites';

const ID = 'app-r2' as AppSessionId;
const ENGINE = { tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: false };

// The render answers the fixture recorded, by component (the first of each).
function recorded(): Record<string, unknown> {
  const rows = loadJournal('pass3', 'mods-surface-render-sites');
  const asked = new Map<string, string>();
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const f = row.frame as { type?: string; request_id?: string; request?: { subtype?: string; component?: string }; response?: { request_id?: string; response?: unknown } };
    if (row.direction === 'out' && f.type === 'control_request' && f.request?.subtype === 'ui_render') asked.set(f.request_id!, f.request.component!);
    if (row.direction === 'in' && f.type === 'control_response' && asked.has(f.response!.request_id!)) out[asked.get(f.response!.request_id!)!] ??= f.response!.response;
  }
  return out;
}
const ANSWERS = recorded();

let fake: FakeClient;
const attach = () => act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...status(ID), uiSurface: { clientId: 'maws-main' } } }));
beforeEach(() => {
  resetSurfaceRegistry();
  useSessions.setState({ engine: new Map() });
});
afterEach(cleanup);

function Spinner({ working }: { working: boolean }) {
  return <p data-testid="label">{useSpinnerText(ID, working) ?? 'Working for 3s'}</p>;
}

describe('the composer’s plugin sites (R2)', () => {
  it('draw the band, the mode slot and the hint while a plugin hooks them, as the fixture answered', async () => {
    fake = fakeClient({ 'session.ui.render': (input: { component: string }) => ANSWERS[input.component] ?? ENGINE });
    attach();
    render(
      <>
        <PluginBand appSessionId={ID} working={false} />
        <PluginModeSlot appSessionId={ID} />
        <PluginHint appSessionId={ID} isDraft={false} isWorking={false} />
      </>,
    );
    // the default client is the app's; these sites take it from `window.maws`
    expect(await screen.findByRole('region', { name: 'From plugins' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'From plugins' }).textContent).toContain('MODS_PROBE_BAND presses=0');
    expect(screen.getByRole('button', { name: 'Press' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeTruthy();
    expect(screen.getByLabelText('Plugin modes').textContent).toBe('MODS_PROBE_MODE modes=0');
    expect(screen.getByLabelText('Plugin hint').textContent).toBe('MODS_PROBE_HINT draft=false working=false');
    expect(fake.invoked('session.ui.render').map((i) => (i as { component: string }).component).sort()).toEqual(['AbovePrompt', 'PromptHint', 'SessionMode']);
  });

  it('draw nothing where no plugin hooks the site, and the words a hook gave by rewriting the props', async () => {
    fake = fakeClient({ 'session.ui.render': (input: { component: string }) => (input.component === 'SessionMode' ? { tree: { type: 'engine', ref: 0 }, props: { modes: ['kairos', 'focus'] }, rewritten: true, hooked: true } : ENGINE) });
    attach();
    const { container } = render(
      <>
        <PluginBand appSessionId={ID} working={false} />
        <PluginModeSlot appSessionId={ID} />
        <PluginHint appSessionId={ID} isDraft isWorking />
      </>,
    );
    expect((await screen.findByLabelText('Plugin modes')).textContent).toBe('kairos & focus');
    expect(container.querySelector('[data-plugin-band]')).toBeNull();
    expect(container.querySelector('[data-plugin-hint]')).toBeNull();
  });

  it('give the working label a plugin’s text only while a turn works', async () => {
    fake = fakeClient({ 'session.ui.render': (input: { component: string }) => ANSWERS[input.component] ?? ENGINE });
    attach();
    const view = render(<Spinner working={false} />);
    expect(screen.getByTestId('label').textContent).toBe('Working for 3s');
    expect(fake.invoked('session.ui.render')).toEqual([]);
    view.rerender(<Spinner working />);
    await act(async () => {});
    expect(screen.getByTestId('label').textContent).toBe('MODS_PROBE_SPIN Working requesting');
    expect(fake.invoked('session.ui.render')).toEqual([{ appSessionId: ID, component: 'Spinner', instanceId: 'main', props: { word: 'Working', message: null, suffix: '…', mode: 'requesting' } }]);
  });
});

beforeEach(() => {
  // the sites use the app's client, which reads `window.maws`
  Object.defineProperty(window, 'maws', { configurable: true, get: () => fake?.client });
});
