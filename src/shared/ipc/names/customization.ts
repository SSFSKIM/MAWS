// UX2-K: configured metadata only; no process launch, mutations or connection state.
export const commands = ['customization.inventory'] as const;
export const events = [] as const;
// P4-AGG M4: configured servers' endpoints for main's catalog alone; never bridged (a URL may carry a secret).
export const mainOnlyCommands = ['customization.serverEndpoints'] as const;
