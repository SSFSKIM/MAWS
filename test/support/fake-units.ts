// Fake unit managers for `mawsd`'s installer and command line (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md,
// M6's Proves): one command runner standing in for `launchctl`, `systemctl --user`, `loginctl` and `sudo -n`, with the
// state each would keep (the jobs loaded in the user's launchd domain; the units enabled and active; lingering), every
// call recorded in order. No test reaches the machine's own managers.
import { basename } from 'node:path';
import type { CommandResult, CommandRunner } from '../../src/mawsd/units/unit';

const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
const fail = (status: number, stderr: string, stdout = ''): CommandResult => ({ status, stdout, stderr });

export class FakeManagers {
  readonly calls: string[] = [];
  // launchd
  readonly loaded = new Set<string>();
  bootoutLingers = 0; // how many `print`s still find a job after its bootout (launchd tears it down asynchronously)
  private lingering = new Map<string, number>();
  // systemd
  readonly enabled = new Set<string>();
  readonly active = new Set<string>();
  userManager = true; // false: `systemctl --user` reaches no user manager (a container)
  // loginctl
  linger = false;
  lingerNeedsSudo = false;
  sudoAllowed = true;

  // Scripted answers: a call beginning with `prefix` gets `result`, `times` times, before the fake's own logic answers it.
  private readonly scripted: { prefix: string; result: CommandResult; left: number }[] = [];
  script(prefix: string, result: Partial<CommandResult> & { status: number }, times = 1): void {
    this.scripted.push({ prefix, result: { stdout: '', stderr: '', ...result }, left: times });
  }

  // what the calls that change something were, in order
  changes(): string[] {
    const queries = [/^launchctl print /, / is-enabled /, / is-active /, / show-environment$/, /^loginctl show-user /];
    return this.calls.filter((call) => !queries.some((query) => query.test(call)));
  }

  readonly run: CommandRunner = (command, args) => {
    const call = [command, ...args].join(' ');
    this.calls.push(call);
    const scripted = this.scripted.find((entry) => entry.left > 0 && call.startsWith(entry.prefix));
    if (scripted) {
      scripted.left -= 1;
      return scripted.result;
    }
    if (command === 'launchctl') return this.launchctl(args);
    if (command === 'systemctl') return this.systemctl(args);
    if (command === 'loginctl') return this.loginctl(args, false);
    if (command === 'sudo' && args[0] === '-n' && args[1] === 'loginctl') return this.sudoAllowed ? this.loginctl(args.slice(2), true) : fail(1, 'sudo: a password is required');
    return fail(127, `${command}: not faked`);
  };

  private launchctl(args: readonly string[]): CommandResult {
    const [verb, ...rest] = args;
    const labelOf = (target: string) => target.split('/').slice(2).join('/');
    switch (verb) {
      case 'print': {
        const label = labelOf(rest[0]!);
        const left = this.lingering.get(label) ?? 0;
        if (left > 0) {
          this.lingering.set(label, left - 1);
          return ok(`${rest[0]} = {}`);
        }
        return this.loaded.has(label) ? ok(`${rest[0]} = {}`) : fail(113, `Could not find service "${label}" in domain for user gui: ${rest[0]!.split('/')[1]}`);
      }
      case 'bootstrap': {
        const label = basename(rest[1]!, '.plist');
        if (this.loaded.has(label) || (this.lingering.get(label) ?? 0) > 0) return fail(5, 'Bootstrap failed: 5: Input/output error');
        this.loaded.add(label);
        return ok();
      }
      case 'bootout': {
        const label = labelOf(rest[0]!);
        if (!this.loaded.delete(label)) return fail(3, 'Boot-out failed: 3: No such process');
        if (this.bootoutLingers > 0) this.lingering.set(label, this.bootoutLingers);
        return ok();
      }
      case 'kickstart':
        return this.loaded.has(labelOf(rest.at(-1)!)) ? ok() : fail(113, 'Could not find service');
      default:
        return fail(64, `launchctl ${verb}: not faked`);
    }
  }

  private systemctl(args: readonly string[]): CommandResult {
    if (args[0] !== '--user') return fail(64, 'only --user is faked');
    if (!this.userManager) return fail(1, 'Failed to connect to bus: No medium found');
    const [verb, ...rest] = args.slice(1);
    const unit = rest.at(-1)!;
    switch (verb) {
      case 'show-environment':
        return ok('HOME=/home/u\n');
      case 'daemon-reload':
        return ok();
      case 'is-enabled':
        return this.enabled.has(unit) ? ok('enabled\n') : fail(1, '', 'disabled\n');
      case 'is-active':
        return this.active.has(unit) ? ok('active\n') : fail(3, '', 'inactive\n');
      case 'enable':
        this.enabled.add(unit);
        if (rest[0] === '--now') this.active.add(unit);
        return ok();
      case 'disable':
        this.enabled.delete(unit);
        if (rest[0] === '--now') this.active.delete(unit);
        return ok();
      case 'restart':
      case 'start': // P5 O2 M7
        this.active.add(unit);
        return ok();
      default:
        return fail(64, `systemctl ${verb}: not faked`);
    }
  }

  private loginctl(args: readonly string[], root: boolean): CommandResult {
    const [verb] = args;
    if (verb === 'show-user') return ok(this.linger ? 'yes\n' : 'no\n');
    if (verb === 'enable-linger') {
      if (this.lingerNeedsSudo && !root) return fail(1, 'Could not enable linger: Access denied');
      this.linger = true;
      return ok();
    }
    return fail(64, `loginctl ${verb}: not faked`);
  }
}
