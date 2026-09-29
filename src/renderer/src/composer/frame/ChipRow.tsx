// The chip row above the box (C7 execution document, "Composer frame"): one left-aligned row with the location (its
// popover carries the branch picker and the additional directories) and `+ dir`. No project chip: the tab names the
// project.
import type { FrameBindings } from './bindings';
import { AddDirChip } from './AddDirChip';
import { LocationChip } from './LocationChip';

export function ChipRow({ bindings, cwd, dirty, onOpen }: { bindings: FrameBindings; cwd: string; dirty: boolean; onOpen?(): void }) {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <LocationChip location={bindings.location} branch={bindings.branch} directories={bindings.directories.value} dirty={dirty} onOpen={onOpen} />
      <AddDirChip directories={bindings.directories} cwd={cwd} />
    </div>
  );
}
