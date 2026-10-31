// X2 `render.*` names without their schemas (`../names.ts`; P5 O5 M3). The answer is main-only: the render host answers
// `mawsd`'s requests over machine.sock, never a window; the request and the exit are events to that client.
export const commands = [] as const;

export const events = ['render.request', 'render.exit'] as const;

export const mainOnlyCommands = ['render.answer'] as const;
