// The offer audit's contract (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 "The offer audit
// and its contract", and the architect's ruling on m8-2b, item 2): every command addressed by an app session that crosses
// a machine link (the link surface, src/main/machines/link-surface.ts) reaches a session on another machine in exactly
// one of three ways, or is drawn disabled there with its reason:
// - offered: a row of the machine's offer table (src/endpoint/offers.ts);
// - answered by main: main's adapters answer it themselves with no row (`ANSWERED_IN_MAIN`,
//   src/main/machines/remote/answered-in-main.ts);
// - declared: `REMOTE_UNAVAILABLE` (src/shared/ipc/remote-unavailable.ts), the words its control is greyed with.
// And the device's half of an offer: a command reaches the machine only through `dispatchOverLink`
// (src/main/machines/remote/dispatch.ts), which refuses anything graded above plain `list`/`view` as act-required before
// any round trip, unless the lane B adapter takes it first (its `handles`). So every act row is one the adapter handles,
// and every call row it doesn't handle is graded plain `list` or `view`.
//
// Each failure names the command and what it lacks.
import { afterAll, describe, expect, it } from 'vitest';
import { gradeOf } from '@shared/ipc/grades';
import { REMOTE_NEEDS, REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { REGISTRY } from '@shared/ipc/registry';
import { routeOf } from '@shared/ipc/routes';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { addressedPaths } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { OFFERS } from '../../src/endpoint/offers';
import type { MainContext } from '../../src/main/ipc/router';
import { routeLaneA, type RemoteLaneA } from '../../src/main/lane-a/remote';
import { createRemoteLaneB } from '../../src/main/lane-b/remote';
import { onLink } from '../../src/main/machines/link-surface';
import { ANSWERED_IN_MAIN } from '../../src/main/machines/remote/answered-in-main';
import type { RemoteLink } from '../../src/main/machines/remote/link';

const NAMES = Object.keys(REGISTRY.commands) as CommandName[];
const isCommand = (name: string): name is CommandName => Object.hasOwn(REGISTRY.commands, name);
/** Whether every valid input names an app session (an `addressed` command with an `AppSessionId` among its ids). */
const bySession = (name: CommandName) => routeOf(name) === 'addressed' && addressedPaths(REGISTRY.commands[name].input, 'lower').some((path) => path.split(' ')[1]!.split('|').includes('AppSessionId'));
const offered = (name: string) => Object.hasOwn(OFFERS.commands, name);
const declared = (name: string) => Object.hasOwn(REMOTE_UNAVAILABLE, name);
const answeredInMain = (name: string) => Object.hasOwn(ANSWERED_IN_MAIN, name);

// The lane B adapter as the composition root makes it, for its `handles` alone (nothing is dispatched; no link is up).
const MACHINE = 'M0000000000000000000000' as MachineRef;
const laneB = createRemoteLaneB({ local: MACHINE, layout: { get: () => null, onChange: () => () => {} }, remote: () => null, onRemote: () => () => {}, emit: () => {}, log: () => {} });
afterAll(() => laneB.stop());

/** Whether lane A's adapter takes `name` for an RL2 machine: the router's own `routeLaneA`, asked with stand-ins. */
async function laneATakes(name: CommandName): Promise<boolean> {
  let taken = false;
  const done = async () => ({ ok: true, value: undefined }) as CommandResult<CommandName>;
  const adapter: RemoteLaneA = { dispatch: async () => ((taken = true), done()), stop: () => {} };
  await routeLaneA(done, () => ({}) as RemoteLink, adapter)(MACHINE, name, {}, {} as MainContext);
  return taken;
}

describe('every session command across a machine link', () => {
  const sessionCommands = NAMES.filter((name) => onLink(name) && bySession(name));

  it('is exactly one of offered, answered by main, or declared remote-unavailable', () => {
    const wrong = sessionCommands.flatMap((name) => {
      const ways = [offered(name) && 'offered (src/endpoint/offers.ts)', answeredInMain(name) && 'answered by main (ANSWERED_IN_MAIN)', declared(name) && 'declared (REMOTE_UNAVAILABLE)'].filter((way) => way !== false);
      if (ways.length === 1) return [];
      return [ways.length === 0 ? `${name}: none of an offer row, an ANSWERED_IN_MAIN entry or a REMOTE_UNAVAILABLE entry` : `${name}: ${ways.join(' and ')}`];
    });
    expect(wrong).toEqual([]);
  });
});

describe('the device’s half of an offer', () => {
  it('handles every act row of a registry command in the lane B adapter (else the device refuses it act-required)', () => {
    // An endpoint name (`forward.open`, `machine.browserControl`, `sminos.*`, …) is no registry command: no window asks it
    // through the router, so `dispatchOverLink` never meets it; its adapter seals it by name.
    const unhandled = Object.entries(OFFERS.commands)
      .filter(([name, row]) => row.kind === 'act' && isCommand(name) && !laneB.handles(name))
      .map(([name]) => `${name}: an act row the lane B adapter doesn’t handle (ENGINE_HOST_ACTS, MACHINE_ACTS, …)`);
    expect(unhandled).toEqual([]);
  });

  it('grades every call row on the link that the adapter doesn’t handle plain `list` or `view` (else act-required)', () => {
    // A row off the link (`daemon.status`, `connectors.callback`, the dashboards' asset holds) is main's own call to the
    // machine, never a window's through `dispatchOverLink`.
    const overGraded = Object.entries(OFFERS.commands)
      .filter(([name, row]) => row.kind === 'call' && isCommand(name) && onLink(name) && !laneB.handles(name))
      .filter(([name]) => gradeOf(name) !== 'list' && gradeOf(name) !== 'view')
      .map(([name]) => `${name}: a call row graded ${JSON.stringify(gradeOf(name))}, which dispatchOverLink refuses act-required`);
    expect(overGraded).toEqual([]);
  });
});

describe('what main answers itself (ANSWERED_IN_MAIN)', () => {
  it('names only commands an adapter takes, none offered or declared, each with its reason', async () => {
    const wrong: string[] = [];
    for (const [name, reason] of Object.entries(ANSWERED_IN_MAIN)) {
      if (!isCommand(name)) wrong.push(`${name}: no registry command`);
      else if (!laneB.handles(name) && !(await laneATakes(name))) wrong.push(`${name}: neither the lane B adapter nor lane A’s takes it`);
      if (offered(name)) wrong.push(`${name}: also offered (src/endpoint/offers.ts)`);
      if (declared(name)) wrong.push(`${name}: also declared (REMOTE_UNAVAILABLE)`);
      if (reason.trim() === '') wrong.push(`${name}: no reason`);
    }
    expect(wrong).toEqual([]);
  });

  it('lists every command an adapter takes that no row offers', async () => {
    const missing: string[] = [];
    for (const name of NAMES) {
      if (offered(name) || answeredInMain(name)) continue;
      if (laneB.handles(name) || (await laneATakes(name))) missing.push(`${name}: an adapter answers it with no offer row, and ANSWERED_IN_MAIN doesn’t say so`);
    }
    expect(missing).toEqual([]);
  });
});

// The UX wave (U9, UC-7.2): an offer that came after an older build's names the capability its endpoint lists once it
// serves it, which the device reads before it sends (REMOTE_NEEDS).
describe('REMOTE_NEEDS', () => {
  it('names only offered commands, each with a capability the endpoint lists', () => {
    const listed: readonly string[] = ENDPOINT_CAPABILITIES;
    const wrong = Object.entries(REMOTE_NEEDS).flatMap(([name, capability]) => [
      ...(offered(name) ? [] : [`${name}: needs ${capability} but no row offers it`]),
      ...(capability !== undefined && listed.includes(capability) ? [] : [`${name}: needs ${capability}, which ENDPOINT_CAPABILITIES doesn’t list`]),
    ]);
    expect(wrong).toEqual([]);
  });
});

describe('REMOTE_UNAVAILABLE', () => {
  it('declares nothing offered or answered by main', () => {
    const both = Object.keys(REMOTE_UNAVAILABLE).flatMap((name) => [...(offered(name) ? [`${name}: declared and offered`] : []), ...(answeredInMain(name) ? [`${name}: declared and answered by main`] : [])]);
    expect(both).toEqual([]);
  });

  it('declares only registry commands that cross a link, each with the words its control shows', () => {
    for (const [name, words] of Object.entries(REMOTE_UNAVAILABLE)) {
      expect(onLink(name), name).toBe(true);
      expect(words, name).toMatch(/^Not on another machine yet: \S/);
    }
  });

  it('declares the machine-wide `mods.list`, which names no one session (a PR tracker line)', () => {
    expect(bySession('mods.list')).toBe(false);
    expect(REMOTE_UNAVAILABLE['mods.list']).toBeDefined();
  });
});
