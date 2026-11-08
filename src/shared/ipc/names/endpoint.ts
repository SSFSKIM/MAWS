// X2 `endpoint.*` names without their schemas (`../names.ts`; P5 O8 M6b). Exactly the keys of `../schema/endpoint.ts`.
// Both are main-only: main asks this machine's own endpoint through `mawsd`'s machine socket, never a window.
export const commands = [] as const;

export const events = [] as const;

export const mainOnlyCommands = ['endpoint.local.act', 'endpoint.local.call'] as const;
