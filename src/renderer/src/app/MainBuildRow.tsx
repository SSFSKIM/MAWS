// The Diagnostics strip's app build row (E11's sitting, owner-notes 00-consolidated-plan §2.7): which main is answering,
// by its version, commit and build time (`host.status`'s `mainBuild`, stamped by electron.vite.config.ts), on a row of
// its own, apart from the supervisor's bundle comparison and pid.
import { builtAtLabel } from '@shared/app/build-time';
import type { HostStatus } from '@shared/ipc/schema/host';
import { useHosts } from '../stores/hosts';
import { MAIN_BUILD_ROW } from './copy';

export function describeMainBuild(status: HostStatus | null): string {
  if (!status) return MAIN_BUILD_ROW.unknown;
  const { version, commit, builtAt } = status.mainBuild;
  return MAIN_BUILD_ROW.line(version, commit, builtAtLabel(builtAt));
}

export function MainBuildRow() {
  const status = useHosts((s) => s.supervisor);
  return (
    <output aria-label={MAIN_BUILD_ROW.label} className="font-mono">
      {describeMainBuild(status)}
    </output>
  );
}
