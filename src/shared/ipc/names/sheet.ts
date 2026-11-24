// X2 `sheet.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/sheet.ts`. The question sheet's C3, M2.
export const commands = ['sheet.list', 'sheet.read', 'sheet.put', 'sheet.body', 'sheet.upload'] as const;

export const events = ['sheet.changed'] as const;
