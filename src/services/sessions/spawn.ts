// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §O's `session.spawn`): a spawn from another device,
// composed on this machine from what the renderer does for a New chat: `session.create` with the project whose directory
// is the checkout and the location (the checkout, or a new worktree on a new branch of its name from HEAD),
// `session.intent.patch` with the model, effort and mode as sent, and `session.start` with the brief as the first
// message, all on the machine's own settings (the route and the launch profile `create` and `start` read). It answers
// once the start is `launching` (the record exists), with the requester written as `launchedBy` from the claim
// `machine.op` hands the handler. `create` waits on the service's boot, which wakes a parked engine host as a need
// (PR #411); nothing here loads anything on an event.
// 2026-11-06 (the New chat's machine first): `checkout: '~'` (HOME_CHECKOUT, a machine owner's alone: the endpoint's
// guard) is a chat in this machine's home with no project, as a local New chat's "Don't work in a project": its location
// `machineHome`, `os.homedir()`'s realpath read once (`$HOME`, else the account's), the home the trust card's `~` read and
// the folder list read too, and one the home-root rule drops (it drops the account's home beside it: machineHomes); a
// worktree needs a project's checkout.
import type { ProjectId } from '@shared/graph/ids';
import type { LaunchedBy } from '@shared/graph/session';
import { PermissionModeSchema } from '@shared/graph/enums';
import { EffortSchema } from '@shared/engine/launch-spec';
import type { HandlerContext } from '@shared/ipc/client';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { Location, SetupIntentPatch } from '@shared/sessions/intent';
import type { StartOutcome } from '@shared/sessions/setup';
import { HOME_CHECKOUT } from '@shared/ipc/schema/session';
import { machineHome } from '@shared/machine/machine-home';
import type { ServicesBus } from '@shared/spine/bus';
import { IntentRefused, type SessionService } from './service';
import { untilLaunching } from './until-launching';

type SpawnInput = CommandInput<'session.spawn'>;
type SpawnOutput = CommandOutput<'session.spawn'>;

export interface SpawnDeps {
  sessions: Pick<SessionService, 'create' | 'patch' | 'startSession' | 'discard'>;
  // the machine's projects, hidden ones included: a checkout is known when a row's directory is exactly it, as the
  // endpoint's checkout source reads them (src/mawsd/daemon.ts)
  projects(): ReadonlyArray<{ id: string; directory: string }>;
  home?: () => string; // the home a `~` spawn starts in: machineHome (a suite's fake one)
}

// the start guards' location verdicts that mean the named worktree or its branch is already there (intent-rules.ts)
const WORKTREE_EXISTS = new Set(['worktree path exists', 'branch exists']);

const refused = (reason: string): SpawnOutput => ({ status: 'refused', reason });

export function registerSpawn(bus: Pick<ServicesBus, 'register' | 'onEmitted'>, deps: SpawnDeps): void {
  bus.register('session.spawn', (input, context) => spawn(bus, deps, input, context));
}

async function spawn(bus: Pick<ServicesBus, 'onEmitted'>, deps: SpawnDeps, input: SpawnInput, context: HandlerContext): Promise<SpawnOutput> {
  const mode = PermissionModeSchema.safeParse(input.permission_mode);
  if (!mode.success) return refused(`permission_mode: ${input.permission_mode} is not a permission mode`);
  const effort = input.effort === undefined ? null : EffortSchema.safeParse(input.effort);
  if (effort !== null && !effort.success) return refused(`effort: ${input.effort} is not an effort level`);
  const home = input.checkout === HOME_CHECKOUT;
  if (home && input.worktree !== undefined) return refused('worktree: a new worktree needs a project’s checkout');
  const project = home ? null : deps.projects().find((row) => row.directory === input.checkout);
  if (project === undefined) return refused('unknown-checkout');

  const location: Location =
    home ? { kind: 'directory', path: (deps.home ?? machineHome)() }
    : input.worktree === undefined ? { kind: 'directory', path: input.checkout }
    : { kind: 'newWorktree', repoRoot: input.checkout, name: input.worktree, branch: { kind: 'new', name: input.worktree, base: 'HEAD' } };
  const { op } = context;
  const launchedBy: LaunchedBy | undefined = op && { member: op.member, device: op.device, opId: op.opId, action: (op.action ?? null) as LaunchedBy['action'] };
  const { appSessionId } = await deps.sessions.create({ projectId: project === null ? null : (project.id as ProjectId), location }, launchedBy && { launchedBy });

  // Until the start hands the intent to its setup, a refusal leaves nothing behind: the intent goes.
  const abandon = async (reason: string): Promise<SpawnOutput> => {
    await deps.sessions.discard(appSessionId);
    return refused(reason);
  };
  const patch: SetupIntentPatch = {
    permissionMode: mode.data,
    ...(input.model !== undefined && { model: input.model }),
    ...(effort !== null && { effort: effort.data }),
  };
  try {
    await deps.sessions.patch(appSessionId, patch);
  } catch (error) {
    if (error instanceof IntentRefused) return abandon(error.message);
    throw error;
  }

  const launching = untilLaunching((listener) => bus.onEmitted('session.setup', listener), appSessionId); // tapped before the start: its setup's events may precede its answer
  let outcome: StartOutcome;
  try {
    const message = input.brief === undefined ? null : { content: input.brief, display: input.brief };
    // P5 O7 M9: the trust card answered on the asking device (an owner's alone, the endpoint's policy) runs the attested
    // bootstrap the local start runs for an accepted card; MAWS writes no trust itself
    outcome = await deps.sessions.startSession(appSessionId, { message, options: input.trust === 'accepted' ? { trust: 'accepted' } : {} });
  } catch (error) {
    launching.cancel();
    if (error instanceof IntentRefused) return abandon(error.message);
    throw error;
  }
  if (outcome.status !== 'starting') {
    launching.cancel();
    return abandon(startRefusal(outcome));
  }
  // A setup that fails before its launch keeps its intent: the failure card on this machine resolves what it left (a
  // retained worktree), and the asker hears the setup's own error.
  const failure = await launching.done;
  return failure === null ? { status: 'ok', appSessionId } : refused(failure);
}

// What a start's guards answered instead of `starting`, as the spawn's refusal reason.
function startRefusal(outcome: Exclude<StartOutcome, { status: 'starting' }>): string {
  switch (outcome.status) {
    case 'needs_trust':
      return 'untrusted';
    case 'invalid':
      if (outcome.field === 'route') return outcome.message; // P5 O7 M9: route-unsupported, a sentence the asker shows as it is
      return outcome.field === 'location' && WORKTREE_EXISTS.has(outcome.message) ? 'worktree-exists' : `${outcome.field}: ${outcome.message}`;
    case 'missing_directory':
      return `the checkout's directory is missing: ${outcome.directory}`;
    case 'refused':
      return `${outcome.reason}: ${outcome.message}`;
    case 'relay_unreachable':
      return 'the relay is unreachable on this machine';
    default:
      return `the start answered ${outcome.status}`;
  }
}
