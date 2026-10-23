// The file-bind boundary shared by an agent's bind and the owner's reread: project containment, regular files,
// descriptor identity, no symlink races on macOS, and a bounded read.
import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { DATASET_LIMITS, type DatasetFormat } from '@artifacts/dashboard/datasets';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { pathUnderCwd, refuse, ToolRefusal } from './artifact-context';

const TOOL = 'artifact_dataset';
const FORMATS: Record<string, DatasetFormat> = { csv: 'csv', tsv: 'tsv', tab: 'tsv', json: 'json' };

/** The format a file's name gives it, by extension. */
export function datasetFormatOf(name: string): DatasetFormat | null {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? null : (FORMATS[name.slice(dot + 1).toLowerCase()] ?? null);
}

// A path under the working directory once every symlink on it and on the directory is resolved (`pathUnderCwd` checks
// the words; this checks where they lead), with the identity of the regular file found there.
export interface ValidatedDatasetFile {
  named: string;
  real: string;
  root: string;
  dev: number;
  ino: number;
  stamp: string;
}
const outsideCwd = (file: Pick<ValidatedDatasetFile, 'named' | 'real' | 'root'>) =>
  refuse(TOOL, { reason: 'invalid', path: file.named }, `${file.named} leads to ${file.real}, outside the working directory ${file.root}`);
const tooLarge = (named: string, size: number) =>
  refuse(TOOL, { reason: 'tooLarge', size, limit: DATASET_LIMITS.bytes }, `${named} is ${size} bytes; a dataset is at most ${DATASET_LIMITS.bytes}`);

export async function datasetFileUnder(cwd: string, path: string): Promise<ValidatedDatasetFile> {
  const named = pathUnderCwd(TOOL, cwd, path);
  const found = await stat(named).catch(() => null);
  if (!found?.isFile()) throw new ToolRefusal(TOOL_ERRORS.artifactNotAFile(TOOL, named));
  const [real, root] = await Promise.all([realpath(named), realpath(cwd)]);
  const inside = relative(root, real);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw outsideCwd({ named, real, root });
  // the resolved path itself, not followed: what the read must open
  const validated = await lstat(real).catch(() => null);
  if (!validated?.isFile()) throw outsideCwd({ named, real, root });
  if (validated.size > DATASET_LIMITS.bytes) throw tooLarge(named, validated.size);
  return { named, real, root, dev: validated.dev, ino: validated.ino, stamp: `${validated.dev}:${validated.ino}:${validated.size}:${validated.mtimeMs}:${validated.ctimeMs}` };
}

// macOS 11 and later: the kernel refuses a symlink anywhere on the path it walks, not only in its last component (as
// src/main/files/service.ts:109-116 opens a session's files). Node's fs.constants does not carry it, so it is passed
// numerically; it replaces O_NOFOLLOW, since macOS answers EINVAL for the two together, and refuses a last-component
// link with ELOOP as well. Linux ignores the bit, so there the open guards the last component alone and a directory
// above the file turned into a link after the containment check is a documented gap of the Linux unit lane (MAWS ships
// on macOS; E's Decision Log 41). O_NONBLOCK: a FIFO put in the file's place opens at once and is refused as not a
// regular file, never holding a thread.
const O_NOFOLLOW_ANY = 0x20000000;
const OPEN_FLAGS = process.platform === 'darwin' ? constants.O_RDONLY | constants.O_NONBLOCK | O_NOFOLLOW_ANY : constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;

// E2 M6 (panel P1, E's Decision Logs 40 and 41): the validated file's bytes read through one descriptor, never the path
// again. The real path is opened through no link (OPEN_FLAGS), and the opened file must be the regular file validated
// (its device and inode), so a file replaced since validation, by a link out of the working directory, by another file
// or by a FIFO, is refused as the containment refusal; the read stops one byte past the cap, so a file grown since is
// refused by size.
export async function readDatasetFile(file: ValidatedDatasetFile): Promise<Uint8Array> {
  const handle = await open(file.real, OPEN_FLAGS).catch(() => null);
  if (!handle) throw outsideCwd(file);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== file.dev || opened.ino !== file.ino) throw outsideCwd(file);
    // sized by the opened file, one byte over to see it grow; a file that did grow is read on, never past the cap
    const chunks: Uint8Array[] = [];
    let length = 0;
    let room = Math.min(opened.size, DATASET_LIMITS.bytes) + 1;
    while (length <= DATASET_LIMITS.bytes) {
      const chunk = new Uint8Array(Math.min(room, DATASET_LIMITS.bytes + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      room = 1024 * 1024;
    }
    if (length > DATASET_LIMITS.bytes) throw tooLarge(file.named, Math.max(opened.size, length));
    return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}
