// The owner's Send to, main's half (P4-B5; P5 O4 M2, docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces
// §G; D14, D15, D29, D38). Delivery is the machine's (src/services/delivery/, composed with the spine), but for the
// export, which stays the app's step until O5 brings exports to the machine: `delivery.send` exports here and hands the
// export's path to the machine's `delivery.deliver` (main-only), which admits it, sends it and removes it.
//
// - Before anything is exported, the machine's `delivery.status` for the target is read and a state that cannot send is
//   answered with no export (D38: a machine without gws reads Drive `absent`); `delivery.deliver` checks again, the
//   machine staying the authority. Notion takes Markdown alone, in Notion's dialect.
// - A run is held here for its export phase (by `runId`, one per artifact and target at a time). A cancel meanwhile is
//   answered here through the router's seam before `delivery.cancel` (D15): the run is marked, the export is let finish
//   (the export service takes no signal and runs under its own budget; O5's to change), then its file is removed and
//   nothing is handed off (D29). Once handed off the run is the machine's, and so is its cancel (a tombstone, if the
//   cancel overtakes the hand-off).
// - A hand-off that fails as a command (the machine unreachable, too slow) may have been sent: it says so, and the
//   export's file is removed here.
import { rm } from 'node:fs/promises';
import { mainClient } from '../ipc/clients';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { DeliveryFailure, DeliverySendAnswer, DeliveryStatus } from '@shared/ipc/schema/delivery';
import type { ServicesBus } from '@shared/spine/bus';
import type { BeforeHook, MainHandler } from '../ipc/router';

const WORDS_MAX = 300;

export interface DeliverySendDeps {
  register(name: 'delivery.send', handler: MainHandler<'delivery.send'>): void;
  before(names: readonly CommandName[], hook: BeforeHook): () => void; // the router's seam (beforeCommand)
  exportArtifact(input: CommandInput<'artifacts.export'>, options?: { dialect?: 'notion' }): Promise<CommandOutput<'artifacts.export'>>; // X31's export service, as the library exports
  call(name: 'artifacts.get', input: CommandInput<'artifacts.get'>): Promise<CommandResult<'artifacts.get'>>; // the engine host's
  invoke: ServicesBus['invoke']; // main's own route: delivery.status and delivery.deliver, the machine's
  log?: (line: string) => void;
}

interface Run {
  cancelled: boolean;
}

const failure = (why: DeliveryFailure, extra: { maybeSent?: boolean; message?: string } = {}): DeliverySendAnswer => ({ ok: false, why, ...(extra.maybeSent && { maybeSent: true }), ...(extra.message && { message: extra.message.slice(0, WORDS_MAX) }) });
const words = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, WORDS_MAX);

// D38: why the machine's state of the target refuses a send before the export, or null when it may go on. A Notion
// source the page named is the delivery's to judge (it keeps the handles); with none named, the status found none.
function refusalOf(status: DeliveryStatus, named: boolean): DeliverySendAnswer | null {
  if (status.target === 'notion') {
    if (status.state === 'unavailable') return failure('unavailable');
    if (status.state === 'none' && !named) return failure('none');
    return null;
  }
  switch (status.state) {
    case 'ready':
      return null;
    case 'absent':
    case 'needsSetup':
      return failure(status.state);
    case 'failed':
      return failure('failed', status.message ? { message: status.message } : {});
    default: // signedOut, expired, noDrive: gws's own sign-in
      return failure('auth');
  }
}

export function registerDeliverySend({ register, before, exportArtifact, call, invoke, log = (line) => console.warn(`[delivery] ${line}`) }: DeliverySendDeps): () => void {
  const runs = new Map<string, Run>(); // by run id, in their export phase
  const active = new Set<string>(); // artifact and target with a run in its export phase
  const asMain = { client: mainClient };

  async function send(input: CommandInput<'delivery.send'>): Promise<DeliverySendAnswer> {
    const { runId, target, artifactId, format, versionId, board } = input;
    if (target === 'notion' && format !== 'md') return failure('invalid');
    const slot = `${artifactId}\0${target}`;
    if (runs.has(runId) || active.has(slot)) return failure('busy');
    const run: Run = { cancelled: false };
    runs.set(runId, run);
    active.add(slot);
    let path: string | null = null;
    let handed = false;
    try {
      const got = await call('artifacts.get', { artifactId, prepare: false });
      if (run.cancelled) return failure('cancelled');
      if (!got.ok) return failure('unavailable');
      const artifact = got.value.artifact;
      if (!artifact) return failure('deleted');
      const status = await invoke('delivery.status', { target, artifactId }, asMain);
      if (run.cancelled) return failure('cancelled');
      if (!status.ok) return failure('unavailable');
      const refused = refusalOf(status.value, input.source !== undefined);
      if (refused) return refused;
      let exported: CommandOutput<'artifacts.export'>;
      try {
        exported = await exportArtifact({ artifactId, format, ownFile: true, ...(versionId !== undefined && { versionId }), ...(board !== undefined && { board }) }, target === 'notion' ? { dialect: 'notion' } : undefined);
      } catch (error) {
        return run.cancelled ? failure('cancelled') : failure('export', { message: words(error) });
      }
      path = exported.path;
      if (run.cancelled) return failure('cancelled'); // D29: the export finished; its file goes below, nothing is handed off
      // the hand-off: from here the run, and its cancel, are the machine's
      runs.delete(runId);
      active.delete(slot);
      handed = true;
      const answer = await invoke('delivery.deliver', { ...input, exportPath: path, revision: exported.revision, title: artifact.title }, asMain);
      if (answer.ok) {
        path = null; // the machine removes what it admitted
        return answer.value;
      }
      log(`the ${target} delivery of ${artifactId} was not answered by the machine: ${answer.error.code}`);
      if (answer.error.code === 'invalid_input') return failure('failed');
      return failure(answer.error.code === 'timeout' ? 'timeout' : 'unavailable', { maybeSent: true });
    } catch (error) {
      log(`the ${target} delivery of ${artifactId} failed: ${words(error)}`);
      return failure('failed', { maybeSent: handed });
    } finally {
      if (!handed) {
        runs.delete(runId);
        active.delete(slot);
      }
      if (path !== null) await rm(path, { force: true }).catch(() => log(`an export for ${target} was not removed`));
    }
  }

  register('delivery.send', (input) => send(input));
  return before(['delivery.cancel'], async (_name, input) => {
    const run = runs.get((input as CommandInput<'delivery.cancel'>).runId);
    if (!run) return undefined; // the machine's: a run it holds, or a tombstone for one handed off meanwhile
    run.cancelled = true;
    return { ok: true, value: { cancelled: true } };
  });
}
