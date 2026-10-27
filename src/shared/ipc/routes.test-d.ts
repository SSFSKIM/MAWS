// Compile-time suite (P5 O6 M2): a `path` command names its machine in the bridge's required form, an `addressed` or a
// `machine-wide` one needs no options; until M4 switches the required form on, the client's invoke takes it optionally.
import { describe, expectTypeOf, it } from 'vitest';
import type { AppSessionId } from '../graph/ids';
import type { MachineRef } from '../machine/ref';
import type { PathCommandName } from './routes';
import type { CommandInput, CommandName, InvokeOptions, InvokeRest, MachineOptions, MawsBridge } from './schema';

declare const machine: MachineRef;
declare const id: AppSessionId;
declare function required<N extends CommandName>(name: N, input: CommandInput<N>, ...opts: MachineOptions<N>): void;
declare const bridge: MawsBridge;

describe('the machine an invoke names', () => {
  it('requires it of a path command in the required form, and of no other', () => {
    // @ts-expect-error a path command names its machine
    required('git.watch', { directory: '/work' });
    required('git.watch', { directory: '/work' }, { machine });
    required('session.get', { appSessionId: id }); // addressed: its address names the machine
    required('settings.get', undefined); // machine-wide: the local machine by default
    required('settings.get', undefined, { machine });
  });

  it('keeps the path class a subset of the names, not every name', () => {
    expectTypeOf<'git.watch'>().toMatchTypeOf<PathCommandName>();
    expectTypeOf<'session.get'>().not.toMatchTypeOf<PathCommandName>();
  });

  it('takes it optionally on the client until M4', () => {
    expectTypeOf<InvokeRest<'git.watch'>>().toEqualTypeOf<[opts?: InvokeOptions]>();
    void bridge.invoke('git.watch', { directory: '/work' });
    void bridge.invoke('session.get', { appSessionId: id });
  });
});
