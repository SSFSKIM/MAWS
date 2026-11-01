// A `files.upload` to a remote lane B session, in parts the channel carries (P5 O7 M4, docs/doperpowers/plans/
// 2026-10-28-p5-o7-remote-lane-b.md, "Uploads in parts"; Interfaces §O). An upload may be 32 MiB and a channel's message
// 4 MiB, so each file of the call crosses as parts of at most REMOTE_UPLOAD_PART_BYTES, in order, each its own `machine`
// act under its own opId: the link reseals or queries that act under the same opId across a lost channel, and the
// machine's ledger answers a part it already ran with its stored result, so nothing is written twice. A part answered
// otherwise than `ok` ends the upload with that answer (the machine's staging of an unfinished upload is swept with its
// roots). The last part of a file alone answers its path; the call answers every file's path in order, as one local
// `files.upload` does.
import { base64urlEncode } from '../../../apps/org-protocol/src/index.ts';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { REMOTE_UPLOAD_PART_BYTES, type FilesUploadInput, type FilesUploadOutput } from '@shared/ipc/schema/files';

export interface UploadDeps {
  /** One part as its own `machine` act, answered at its outcome (or the pending bound, as every act is). */
  part(args: FilesUploadInput): Promise<CommandResult<CommandName>>;
  /** After each part landed, and once before the first: `sent` of `parts` of the call's `file`. */
  progress(file: number, name: string, sent: number, parts: number): void;
  /** The upload's id, which names its staging on the machine. */
  mint?(): string;
}

const mintUpload = () => base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

export async function uploadInParts(input: FilesUploadInput, deps: UploadDeps): Promise<CommandResult<CommandName>> {
  const paths: string[] = [];
  for (const [file, { name, bytes }] of input.files.entries()) {
    const decoded = Buffer.from(bytes, 'base64');
    const parts = Math.max(1, Math.ceil(decoded.length / REMOTE_UPLOAD_PART_BYTES));
    const upload = (deps.mint ?? mintUpload)();
    deps.progress(file, name, 0, parts);
    for (let index = 0; index < parts; index++) {
      const chunk = decoded.subarray(index * REMOTE_UPLOAD_PART_BYTES, (index + 1) * REMOTE_UPLOAD_PART_BYTES);
      const last = index === parts - 1;
      const answer = await deps.part({ appSessionId: input.appSessionId, part: { upload, index, last }, files: [{ name, bytes: chunk.toString('base64') }] });
      if (!answer.ok) return answer;
      const output = answer.value as FilesUploadOutput;
      if (output.status !== 'ok') return answer;
      deps.progress(file, name, index + 1, parts);
      if (last) paths.push(...output.paths);
    }
  }
  return { ok: true, value: { status: 'ok', paths } satisfies FilesUploadOutput } as CommandResult<CommandName>;
}
