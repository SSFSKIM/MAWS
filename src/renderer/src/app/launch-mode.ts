// The launch mode main decided at app ready (`session.launchMode`), for the registrations that wait on it: C5's stub
// creator in mode `scenario`, C10's composition in mode `index`. It is the local machine's (`mawsd`'s spine on the daemon
// shape), so a page that asked it once in an upgrade's `mawsd` restart kept New chat disabled for the app's life
// (2026-10-31): it is asked until main answers (../ipc/until-answered.ts). `take` runs once; the returned function stops
// the asking.
import type { CommandOutput, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { askUntilAnswered } from '../ipc/until-answered';

export function onLaunchMode(take: (mode: CommandOutput<'session.launchMode'>['mode']) => void, client: MawsBridge = ipc): () => void {
  let live = true;
  const stop = askUntilAnswered(client, async () => {
    const result = await client.invoke('session.launchMode', undefined);
    if (!result.ok) {
      console.warn('[shell] session.launchMode unavailable; asked again when the machine is heard', result.error);
      return false;
    }
    if (live) take(result.value.mode);
    return true;
  });
  return () => {
    live = false;
    stop();
  };
}
