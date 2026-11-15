// The app bundle a process runs from (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md,
// §B and decision 8): the outermost folder named `*.app` among the ancestors of its executable, which the files service
// never writes (one of MAWS's own folders). Main tells the daemon its own (`machine.client`'s `bundle`); the daemon reads
// its own. Pure: a path read as written, no disk.

export const isBundleName = (name: string): boolean => name.length > '.app'.length && name.endsWith('.app'); // red stub

// The outermost ancestor of `execPath` whose name ends in `.app`; null when none does (a development run's Node).
export function bundleOf(execPath: string): string | null {
  if (!execPath.startsWith('/')) return null;
  const parts = execPath.split('/');
  // every ancestor, the executable itself left out; a name that is only `.app` is no bundle
  const at = parts.slice(0, -1).findIndex((name) => name.length > '.app'.length && name.endsWith('.app'));
  return at === -1 ? null : parts.slice(0, at + 1).join('/');
}
