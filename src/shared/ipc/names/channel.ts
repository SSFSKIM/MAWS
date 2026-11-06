// X2 `channel.*` names without their schemas (`../names.ts`; P5 O8 M7b). Exactly the keys of `../schema/channel.ts`.
// `channel.history` is main-only: main and the endpoint read the journal, never a window.
export const commands = [] as const;

export const events = ['channel.changed'] as const;

export const mainOnlyCommands = ['channel.history'] as const;
