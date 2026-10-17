// @vitest-environment happy-dom
// The session view's chunk loader: loaded once when first wanted and shared after; a failed load says so, is not kept
// (a retry fetches again), and a retry that succeeds draws the module.
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { moduleLoader, useLoadedModule } from './module-loader';

it('loads only when wanted, reports a failure, fetches again on retry, and shares what it loaded', async () => {
  const load = vi.fn<() => Promise<{ name: string }>>().mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module')).mockResolvedValue({ name: 'view' });
  const loader = moduleLoader(load);
  const idle = renderHook(() => useLoadedModule(loader, false));
  expect(load).not.toHaveBeenCalled();
  idle.unmount();

  const hook = renderHook(() => useLoadedModule(loader, true));
  await waitFor(() => expect(hook.result.current.failed).toBe('Failed to fetch dynamically imported module'));
  expect(hook.result.current.module).toBeNull();

  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.module).toEqual({ name: 'view' }));
  expect(hook.result.current.failed).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);

  // A later view (navigating back) draws it at once, with no load of its own.
  const later = renderHook(() => useLoadedModule(loader, true));
  expect(later.result.current.module).toEqual({ name: 'view' });
  expect(load).toHaveBeenCalledTimes(2);
});
