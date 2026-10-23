// Only the persisted installation revision is seed attribution; keep reads independent of bundled default loading.
export const seedRevisionKey = (id: string): string => `designSystems.seedRevision.${id}`;
