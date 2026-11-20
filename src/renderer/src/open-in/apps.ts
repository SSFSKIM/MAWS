// The apps "Open in" lists (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decision 3):
// main's answer (`layout.openInApps`, the rows this Mac has in the menu's order), asked again whenever a menu that holds
// the item opens; main keeps its own answer for a minute. Until the first answer, `apps` is null.
import { create } from 'zustand';
import type { OpenInApp, OpenInAppId } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';

export const useOpenInApps = create<{ apps: readonly OpenInApp[] | null }>()(() => ({ apps: null }));

export async function refreshOpenInApps(): Promise<void> {
  const answer = await ipc.invoke('layout.openInApps', {}).catch(() => null);
  if (answer?.ok) useOpenInApps.setState({ apps: answer.value.apps });
}

// The rows in groups (editors, terminals, Finder), each group in main's order, so a separator falls between two groups.
const TERMINALS: ReadonlySet<OpenInAppId> = new Set(['terminal', 'iterm', 'ghostty']);
export function openInGroups(apps: readonly OpenInApp[]): OpenInApp[][] {
  const groupOf = (app: OpenInApp) => (app.id === 'finder' ? 2 : TERMINALS.has(app.id) ? 1 : 0);
  return [0, 1, 2].map((group) => apps.filter((app) => groupOf(app) === group)).filter((group) => group.length > 0);
}
