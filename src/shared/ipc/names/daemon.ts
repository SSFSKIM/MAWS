// X2 `daemon.*` names without their schemas (`../names.ts`; P5 O2 M5). Every command is main-only: the renderer never
// invokes the daemon's namespace (main reaches it through its `machine` host, M7), so none is bridged.
export const commands = [] as const;

export const events = [] as const;

export const mainOnlyCommands = ['daemon.status', 'daemon.restart', 'daemon.endpoint', 'daemon.e2eSeam', 'daemon.e2eRender' /* P5 O5 M4 */] as const;
