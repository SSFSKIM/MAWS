// Each command's budget on a machine link (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The link
// gives each call its command's budget"; the tracker row of 2026-10-31). A command whose own work runs past a link's
// default deadline (a cold machine's `artifacts.export`: a render host's start, then the export) is waited for its
// budget and a round trip, so the far side doesn't finish what this side gave up on. The table is the services'
// `COMMAND_BUDGETS_MS`, injected by the composition root (src/main/app.ts), so no link imports src/services/.
import type { CommandName } from '@shared/ipc/schema';

export type CommandBudgets = Readonly<Partial<Record<CommandName, number>>>;

/** The round trip a budgeted request is given past its command's own budget. */
export const RTT_MARGIN_MS = 1_000;

/** `name`'s deadline on a link: its budget and the round trip where the table names it, else undefined (the link's default). */
export function budgetedMs(budgets: CommandBudgets | undefined, name: string): number | undefined {
  const budget = budgets?.[name as CommandName];
  return budget === undefined ? undefined : budget + RTT_MARGIN_MS;
}
