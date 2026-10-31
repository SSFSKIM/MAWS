// A read of the local machine's that the page must not take as empty when it fails (2026-10-31). The local machine's
// commands are `mawsd`'s on the daemon shape, and an app swapped onto a new build first meets the old `mawsd`, then asks it
// to restart onto its own bundle (src/main/hosts/daemon.ts, the build check): what the page reads in that window is
// answered `host_unavailable`. `ask` reads and applies what it may, resolving whether it was answered; until it is, it is
// asked again each time main says the local machine's host was heard (`host.status`, emitted at each ready of the
// machine host and each change of the spine's availability; the git store's `retryUnanswered` rides it too), and at
// once when one was heard while an ask was out, whose failure may be older than the host's return. A rejection counts
// as unanswered. The returned function stops the asking; an ask already out still settles, so `ask` guards what it
// applies.
import type { MawsBridge } from '@shared/ipc/schema';

export function askUntilAnswered(client: MawsBridge, ask: () => Promise<boolean>): () => void {
  let live = true;
  let asking = false;
  let heard = false;
  const settled = (answered: boolean) => {
    asking = false;
    if (!live) return;
    if (answered) stop();
    else if (heard) run();
  };
  const run = () => {
    asking = true;
    heard = false;
    void ask().then(settled, () => settled(false));
  };
  const offHeard = client.on('host.status', (_status, { machine }) => {
    if (machine !== client.localMachine) return;
    if (asking) heard = true;
    else run();
  });
  const stop = () => {
    live = false;
    offHeard();
  };
  run();
  return stop;
}
