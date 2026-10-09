// `/sandbox` on 2.1.295's answer (P2-B execution document §5.11; U3 F4, findings-pass3-p2-b-u3.txt): the answer adds
// `mode`, `overrides_locked`, `no_sandbox_allowed`, `unix_sockets`, `allow_all_unix_sockets` and
// `ignored_glob_patterns` beside the fields the first read uses, and none of them changes it: "Sandbox off", "Not turned
// on in your settings", Details beneath, utility-sized, and no control that writes settings (owner decision 5).
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { slashWidget } from '../composer/mentions/widgets';
import { useSessions } from '../stores/sessions';
import { registerAllWidgets } from './index';
import { present, SandboxWidget } from './SandboxWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;

// U3 F4's `get_sandbox_dialog`, as the installed 2.1.295 answered it under a scratch home
const ANSWER_2_1_295 = {
  supported: true,
  locked: false,
  overrides_locked: false,
  enabled: false,
  enabled_in_settings: false,
  mode: 'disabled',
  auto_allow_available: true,
  no_sandbox_allowed: true,
  unsandboxed_fallback: true,
  dependencies: { errors: [], warnings: [] },
  excluded_commands: [],
  restrictions: {
    fs_deny_read: [],
    fs_allow_read: [],
    fs_allow_write: [],
    fs_deny_write: [],
    network_allowed_domains: [],
    network_denied_domains: [],
    network_managed: false,
    unix_sockets: [],
    allow_all_unix_sockets: false,
    ignored_glob_patterns: [],
  },
};

let backend: WidgetBackend;
beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  backend.script('session.getSandboxDialog', () => ANSWER_2_1_295);
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('/sandbox on 2.1.295', () => {
  it('reads the answer as it read 2.1.29x’s: Sandbox off, not turned on in your settings, its settings under Details', () => {
    const view = present(ANSWER_2_1_295);
    expect(view).toMatchObject({ headline: 'Sandbox off', reason: 'Not turned on in your settings', outside: null, locked: false, excluded: [], restrictions: [] });
    expect(view.rows).toEqual([
      { label: 'In your settings', value: 'off' },
      { label: 'Set by policy', value: 'no' },
      { label: 'Auto-allow', value: 'available' },
      { label: 'Unsandboxed fallback', value: 'allowed' },
    ]);
    expect(view.dependencies).toEqual({ errors: [], warnings: [] });
  });

  it('draws the first read with Details beneath and offers no control that writes settings, in the utility box', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SandboxWidget appSessionId={ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    const frame = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-widget="sandbox"]')!;
      expect(el.textContent).toContain('Sandbox off');
      return el;
    });
    expect(frame.textContent).toContain('Not turned on in your settings');
    expect(within(frame).getByText('Details').tagName).toBe('SUMMARY');
    expect(frame.getAttribute('data-widget-size')).toBe('utility');
    // the only control is the frame's close: no switch, checkbox, field or other button
    expect(within(frame).queryAllByRole('switch')).toEqual([]);
    expect(within(frame).queryAllByRole('checkbox')).toEqual([]);
    expect(within(frame).queryAllByRole('textbox')).toEqual([]);
    expect(within(frame).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([screen.getByRole('button', { name: /^Close / }).getAttribute('aria-label')]);
    const off = registerAllWidgets();
    try {
      expect(slashWidget('sandbox')?.size ?? 'utility').toBe('utility');
      expect(slashWidget('skills')?.size).toBe('library');
      expect(slashWidget('plugins')?.size).toBe('library');
    } finally {
      off();
    }
  });
});
