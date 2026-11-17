// A file outside a session's folders on another machine, in the window (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; decisions 11 to 13 and 18).
import type { AppSessionId } from '@shared/graph/ids';
import type { RemoteStanding } from '@shared/ipc/remote-unavailable';
import type { MachineRef } from '@shared/machine/ref';

export function takesRemoteRoute(appSessionId: AppSessionId): boolean {
  void appSessionId;
  return false;
}

export function useTakesRemoteRoute(appSessionId: AppSessionId): boolean {
  void appSessionId;
  return false;
}

export function outsideUnavailable(standing: RemoteStanding | null, command: 'files.chooseOutside' | 'files.writeOutside' | 'files.readOutside'): string | null {
  void standing;
  void command;
  return null;
}

export function openedThere(machine: MachineRef): { has(path: string): boolean; add(path: string): void } {
  void machine;
  return { has: () => false, add: () => {} };
}

export function forgetOpenedThere(): void {}
