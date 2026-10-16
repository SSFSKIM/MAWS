// The deck shell's commands to main and the store (P3-C M6; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10,
// D13): Present asks main to open the deck's audience window (and a presenter window with a second display) from the
// slide shown; the Theme panel names the deck's design system on its artifact (`designSystemId`; null follows the deck's
// Space and the owner's defaults). A failure to present is a toast; a refused switch rejects, for the panel to show.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { toastFailure } from '../../library/dialogs';

export async function presentDeck(artifactId: string, slideId: string | null, client: MawsBridge = ipc): Promise<void> {
  const result = await client.invoke('presentations.present', { artifactId, ...(slideId !== null && { slideId }) });
  if (!result.ok) toastFailure(`The presentation could not start: ${result.error.message}`);
}

export async function chooseDeckSystem(artifactId: string, designSystemId: string | null, client: MawsBridge = ipc): Promise<void> {
  const result = await client.invoke('artifacts.update', { artifactId, designSystemId });
  if (!result.ok) throw new Error(result.error.message);
}
