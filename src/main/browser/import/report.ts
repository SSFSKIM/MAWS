// The report's skip counts and host lists (E4b Design §10; Decision Log 22): every reason present with its count, and
// per reason at most 20 distinct hosts, never a name, value, path or title. A row without a host (an empty `host_key`,
// an unparsable URL) is counted but listed nowhere, since the report's schema admits no empty host.
import { IMPORT_HOSTS_MAX } from '@shared/browser/import';

const HOST_MAX = 255;

export class SkipTally<R extends string> {
  readonly skipped: Record<R, number>;
  readonly hosts: Partial<Record<R, string[]>> = {};

  // `onHost` hears each host as it enters a reason's list: the import logs those lines, and only those.
  constructor(
    reasons: readonly R[],
    private readonly onHost: (reason: R, host: string) => void = () => {},
  ) {
    this.skipped = Object.fromEntries(reasons.map((reason) => [reason, 0])) as Record<R, number>;
  }

  add(reason: R, host: string | null = null, count = 1): void {
    if (count <= 0) return;
    this.skipped[reason] += count;
    if (!host || host.length > HOST_MAX) return;
    const list = (this.hosts[reason] ??= []);
    if (list.length >= IMPORT_HOSTS_MAX || list.includes(host)) return;
    list.push(host);
    this.onHost(reason, host);
  }
}
