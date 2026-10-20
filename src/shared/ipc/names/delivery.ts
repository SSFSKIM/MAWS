// X2 `delivery.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/delivery.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P4-B5.
export const commands = ['delivery.status', 'delivery.connect', 'delivery.send', 'delivery.cancel', 'delivery.receipts'] as const;

export const events = ['delivery.receipt'] as const;
