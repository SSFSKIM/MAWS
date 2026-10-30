// X2 `clientPort.*` names without their schemas (`../names.ts`; P5 O3-D). The answer is main-only: main answers a request
// of `mawsd`'s through its Electron port, never a window; the request is an event to a client of the services front.
export const commands = [] as const;

export const events = ['clientPort.request'] as const;

export const mainOnlyCommands = ['clientPort.answer'] as const;
