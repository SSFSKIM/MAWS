// MAWS's own folders (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B and
// decision 8), which no write of the files service reaches: the profile, the bundle the daemon runs from, and the bundle
// each attached app told in `machine.client` (`told`, read at each call). Each as its real path, once; a folder that does
// not resolve is left out, and a told value counts only as an absolute path to a folder whose real name is `*.app`.
import { realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { bundleOf } from '@shared/files/bundle';

const realOf = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

const isBundle = (real: string): boolean => {
  const name = basename(real);
  if (name.length <= '.app'.length || !name.endsWith('.app')) return false;
  try {
    return statSync(real).isDirectory();
  } catch {
    return false;
  }
};

export function ownFolders(profile: string, execPath: string, told: () => readonly string[]): () => string[] {
  const daemonBundle = bundleOf(execPath);
  return () => {
    const folders = new Set<string>();
    for (const path of [profile, daemonBundle]) {
      const real = path === null ? null : realOf(path);
      if (real !== null) folders.add(real);
    }
    for (const path of told()) {
      const real = isAbsolute(path) ? realOf(path) : null;
      if (real !== null && isBundle(real)) folders.add(real);
    }
    return [...folders];
  };
}
