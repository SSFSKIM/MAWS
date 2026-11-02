// X2 `daemon.*` names without their schemas (`../names.ts`; P5 O2 M5). Every command is main-only: the renderer never
// invokes the daemon's namespace (main reaches it through its `machine` host, M7), so none is bridged.
export const commands = [] as const;

export const events = ['daemon.engineHandover' /* P5 O16 M3c fix wave 2: mawsd's, on machine.sock; bridged as every event is */] as const;

export const mainOnlyCommands = ['daemon.status', 'daemon.restart', 'daemon.restartEngineHost' /* P5 O16 M3b */, 'daemon.endpoint', 'daemon.e2eSeam', 'daemon.e2eRender' /* P5 O5 M4 */] as const;
