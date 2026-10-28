// Compile-time suite (P5 O6 M2, M4): a `path` command names its machine in the bridge's required form, an `addressed` or a
// `machine-wide` one needs no options; the client's invoke takes that form since M4.
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

  it('requires it of a path command on the client, and of no other (M4)', () => {
    expectTypeOf<InvokeRest<'git.watch'>>().toEqualTypeOf<[opts: { machine: MachineRef }]>();
    expectTypeOf<InvokeRest<'session.get'>>().toEqualTypeOf<[opts?: InvokeOptions]>();
    // @ts-expect-error a path command names its machine
    void bridge.invoke('git.watch', { directory: '/work' });
    void bridge.invoke('git.watch', { directory: '/work' }, { machine });
    void bridge.invoke('session.get', { appSessionId: id });
    void bridge.invoke('settings.get', undefined);
  });
});
