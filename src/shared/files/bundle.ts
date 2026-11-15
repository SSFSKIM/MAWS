// The app bundle a process runs from (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md,
// §B and decision 8): the outermost folder named `*.app` among the ancestors of its executable, which the files service
// never writes (one of MAWS's own folders). Main tells the daemon its own (`machine.client`'s `bundle`); the daemon reads
// its own. Pure: a path read as written, no disk.

// Whether a folder's name is a bundle's: it ends in `.app` in any case (the default Mac volume ignores case, and the real
// path keeps a name's case as the disk has it), and is more than the suffix. The one test of it, `bundleOf`'s and
// `ownFolders`' alike.
export const isBundleName = (name: string): boolean => name.length > '.app'.length && name.slice(-'.app'.length).toLowerCase() === '.app';

// The outermost ancestor of `execPath` whose name is a bundle's; null when none is (a development run's Node).
export function bundleOf(execPath: string): string | null {
  if (!execPath.startsWith('/')) return null;
  const parts = execPath.split('/');
  const at = parts.slice(0, -1).findIndex(isBundleName); // every ancestor, the executable itself left out
  return at === -1 ? null : parts.slice(0, at + 1).join('/');
}
