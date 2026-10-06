// X2 `voice.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/voice.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'voice.status', 'voice.start', 'voice.stop', 'voice.cancel', 'voice.openPrivacySettings',
] as const;

export const events = [
  'voice.event',
] as const;
