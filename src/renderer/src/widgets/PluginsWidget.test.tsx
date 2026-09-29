import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { PluginsWidget } from './PluginsWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PluginsWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );

describe('plugins widget', () => {
  it('lists what a ready process loaded, with no caption', () => {
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    expect(screen.queryByText(/last reported/)).toBeNull();
  });

  it('keeps an exited session’s last list and says it is what the session last reported', () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'exited' }]]) });
    mount();
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    expect(screen.getByText('The session is not running · the plugins it last reported')).toBeTruthy();
  });
});
