// The machine chip (P5 O6 M5; P5 Decision Log 28, T1 and T2): `@<name>` in secondary text on another machine's row,
// "offline" in its place while that machine is offline, nothing on this machine's row while it is up. P5 O7 M2: its title
// says when the machine removed this device. P5 O8 M7b: `name`, what to call a machine the roster doesn't hold (a project
// channel's cached entries of a machine, signed out), in place of its ref.
import { greyWords, machineChipText, useMachineMark } from './machine-mark';

export function MachineChip({ address, name, className = '' }: { address: string; name?: string; className?: string }) {
  const mark = useMachineMark(address, name);
  const text = machineChipText(mark);
  if (text === null) return null;
  return (
    <span data-machine-chip title={mark.offline ? greyWords(mark) : mark.name} className={`shrink-0 truncate text-ui-sm ${mark.offline ? 'text-fg-faint' : 'text-fg-muted'} ${className}`}>
      {text}
    </span>
  );
}
