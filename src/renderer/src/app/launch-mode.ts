// The launch mode main decided at app ready (`session.launchMode`), for the registrations that wait on it: C5's stub
// creator in mode `scenario`, C10's composition in mode `index`. The command is `machine`-owned, served by `mawsd`'s
// spine on the daemon shape, and an app swapped onto a new build first meets the old `mawsd`, then asks it to restart
// onto its own bundle (src/main/hosts/daemon.ts, the build check). A page that asked in that window was answered
// `host_unavailable` and, asking once, kept New chat disabled for the app's life (2026-10-31). So a failed ask is asked
// again when main next says the local machine's host was heard (`host.status`, emitted at each ready of the machine
// host and each change of the spine's availability; the git store's `retryUnanswered` rides it too), and at once when
// one was heard while the ask was out, whose failure may be older than the host's return. `take` runs once; the
// returned function stops the asking.
import type { CommandOutput, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';

export function onLaunchMode(take: (mode: CommandOutput<'session.launchMode'>['mode']) => void, client: MawsBridge = ipc): () => void {
  let live = true;
  let asking = false;
  let heard = false;
  const ask = () => {
    asking = true;
    heard = false;
    void client.invoke('session.launchMode', undefined).then((result) => {
      asking = false;
      if (!live) return;
      if (result.ok) {
        stop();
        take(result.value.mode);
      } else {
        console.warn('[shell] session.launchMode unavailable; asked again when the machine is heard', result.error);
        if (heard) ask();
      }
    });
  };
  const offHeard = client.on('host.status', (_status, { machine }) => {
    if (machine !== client.localMachine) return;
    if (asking) heard = true;
    else ask();
  });
  const stop = () => {
    live = false;
    offHeard();
  };
  ask();
  return stop;
}
