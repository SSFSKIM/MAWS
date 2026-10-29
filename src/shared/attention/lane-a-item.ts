// A lane A attention item, by its id (P5 O9 M6): `lane-a:<engineSession>:<request>`, a request a terminal or
// background-job session's bridge raised, which that terminal shows too. Neutral (P5 O3-C), since the spine's lane A
// list (src/services/lane-a/attention.ts) mints the ids and the client's notifier tells them in-app only.
export const LANE_A_ITEM_PREFIX = 'lane-a:';
export const isLaneAItem = (id: string): boolean => id.startsWith(LANE_A_ITEM_PREFIX);
