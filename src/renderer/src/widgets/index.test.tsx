import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registeredWidgetNames, slashWidget, WIDGET_COMMANDS } from '../composer/mentions/widgets';
import { resetCatalogStore } from '../stores/catalog';
import { useSessions } from '../stores/sessions';
import { WIDGET_FOOT } from './copy';
import { registerAllWidgets } from './index';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
const NAMES = WIDGET_COMMANDS.map((w) => w.name);

describe('widget registration covers every WIDGET_COMMANDS name', () => {
  it('registers exactly the declared names, and its disposer removes them', () => {
    expect(registeredWidgetNames().size).toBe(0);
    const off = registerAllWidgets();
    expect([...registeredWidgetNames()].sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) expect(slashWidget(name)?.title, name).toBeTruthy();
    off();
    expect(registeredWidgetNames().size).toBe(0);
  });
});

describe('every widget renders its fixture response', () => {
  let backend: WidgetBackend;
  let off: () => void;
  beforeEach(() => {
    const scenario = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
    backend = createWidgetBackend({ root: ROOT, statuses: scenario.engine });
    window.maws = backend.bridge();
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]), records: new Map(scenario.sessions.map((r) => [r.appId, r])) });
    off = registerAllWidgets();
  });
  afterEach(() => {
    cleanup();
    off();
    resetCatalogStore();
    useSessions.setState({ engine: new Map(), records: new Map() });
    delete (window as { maws?: MawsBridge }).maws;
  });

  // What each widget shows once its read answered: a line of the pinned fixture.
  const SHOWS: Record<string, string> = {
    permissions: 'Bash(git log --oneline)',
    usage: '$0.0208',
    config: 'dialogExpiry',
    plugins: 'doperpowers',
    mcp: 'openaiDeveloperDocs',
    sandbox: 'disabled · supported',
    hooks: 'echo MAWS_POSTHOOK',
    memory: 'Project instructions',
    skills: '/deep-research',
    agents: 'Fast read-only search agent for locating code',
    status: 'http://127.0.0.1:8641',
    context: '30,433 of 200,000 · 15% · autocompact at 167,000',
    export: '2026-09-28-022217-reply-with-exactly-ok.txt',
    diff: '0 files · +0 −0 · working tree',
    model: 'From gateway',
    effort: 'Engine default',
    fast: 'Fast mode is for Opus', // the scenario session is on Sonnet
    compact: '30,433 of 200,000 · 15% · autocompact at 167,000',
    resume: 'Usage reset countdown',
    rename: 'New title',
  };

  it.each(NAMES)('%s opens with its body and its foot', async (name) => {
    const widget = slashWidget(name)!;
    const Component = widget.component;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <Component appSessionId={ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    const footer = container.querySelector('footer')!;
    expect(footer.textContent).toContain(`Read with ${WIDGET_FOOT[name].readWith}`);
    expect(footer.textContent).toContain(WIDGET_FOOT[name].editedWhere!.replaceAll('`', ''));
    if (SHOWS[name]) await waitFor(() => expect(screen.getAllByText((_, el) => el?.textContent?.includes(SHOWS[name]) === true && el.children.length === 0).length).toBeGreaterThan(0));
  });

  it("asks each read with the widget's own arguments", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Context = slashWidget('context')!.component;
    render(
      <QueryClientProvider client={client}>
        <Context appSessionId={ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(backend.calls.find((c) => c.subtype === 'get_context_usage')?.input).toEqual({ appSessionId: ID, detail: 'full' }));
  });
});
