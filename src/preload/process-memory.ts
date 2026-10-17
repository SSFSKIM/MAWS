// P3-E (E2 M6; parent Decision Log 42(5), E2's execution Decision Log 38): the dashboard scale gate's view of the
// renderer's own memory. Electron documents `process.getProcessMemoryInfo()` for renderer processes, in kilobytes, its
// `private` field "more representative of the actual pre-compression memory usage of the process on macOS", and lists
// it among the APIs a sandboxed renderer keeps (https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo).
// The app window's preload exposes it to the page as `window.__maws_processMemory` only when its own
// `process.env.MAWS_E2E` is '1' (an e2e launch), wrapping that one call: no other process or env surface.

export const PROCESS_MEMORY_GLOBAL = '__maws_processMemory';

/** Exposes the e2e-only getter through `bridge` when `env` marks an e2e launch; otherwise nothing. */
export function exposeProcessMemory<T>(env: Record<string, string | undefined>, bridge: { exposeInMainWorld(key: string, api: unknown): void }, getProcessMemoryInfo: () => Promise<T>): void {
  if (env.MAWS_E2E !== '1') return;
  bridge.exposeInMainWorld(PROCESS_MEMORY_GLOBAL, () => getProcessMemoryInfo());
}
