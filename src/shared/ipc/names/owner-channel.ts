// X2 `ownerChannel.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/owner-channel.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an
// entry added there adds its name here.
export const commands = ['ownerChannel.state', 'ownerChannel.answered', 'ownerChannel.cancel', 'ownerChannel.markRead'] as const;

export const events = ['ownerChannel.changed'] as const;
