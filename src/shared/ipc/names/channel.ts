// X2 `channel.*` names without their schemas (`../names.ts`; P5 O8 M7b). Exactly the keys of `../schema/channel.ts`.
// Both are main-only: main and the endpoint read the journal, never a window, which sees only `org.channel.*`.
export const commands = [] as const;

export const events = [] as const;

export const mainOnlyCommands = ['channel.history'] as const;

export const mainOnlyEvents = ['channel.changed'] as const;
