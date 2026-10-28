// The machine chip (P5 O6 M5; P5 Decision Log 28, T1 and T2): `@<name>` in secondary text on another machine's row,
// "offline" in its place while that machine is offline, nothing on this machine's row while it is up.
import { MACHINE_OFFLINE, machineChipText, useMachineMark } from './machine-mark';

export function MachineChip({ address, className = '' }: { address: string; className?: string }) {
  const mark = useMachineMark(address);
  const text = machineChipText(mark);
  if (text === null) return null;
  return (
    <span data-machine-chip title={mark.offline ? MACHINE_OFFLINE : mark.name} className={`shrink-0 truncate text-ui-sm ${mark.offline ? 'text-fg-faint' : 'text-fg-muted'} ${className}`}>
      {text}
    </span>
  );
}
