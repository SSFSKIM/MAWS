import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { useModelCatalogue } from './list-models';

afterEach(() => delete (window as { maws?: PreloadBridge }).maws);

const catalogue = (displayName: string) => ({ models: [{ value: 'claude/astra', displayName }], source: 'cached', at: null });

it('a catalogue read still in flight when the process becomes ready is read again, so the pre-launch answer does not stand', async () => {
  const fake = fakeClient();
  window.maws = fake.client as unknown as PreloadBridge; // P5 O6 M2: main's side
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ ready }) => useModelCatalogue(TEST_MACHINE, 'gateway', ready), { wrapper, initialProps: { ready: false } });
  await waitFor(() => expect(fake.pending('engine.models')).toBe(1)); // the first read, not answered yet
  hook.rerender({ ready: true });
  await waitFor(() => expect(fake.pending('engine.models')).toBe(2)); // a second read, not the first one reused
  await act(() => fake.reply('engine.models', catalogue('before the launch')));
  await act(() => fake.reply('engine.models', catalogue('Astra')));
  await waitFor(() => expect(hook.result.current?.[0]?.displayName).toBe('Astra'));
});
