// `EndpointServices` as `mawsd` will give them (O2's seam), for the endpoint's suites before O2 lands: a scratch profile
// with its state directory (0700), the machine's ref, and a log the suite reads. Nothing here touches the owner's
// profile: every directory is a fresh temporary one.
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { MachineRef } from '@shared/machine/ref';
import { endpointLibrary, type ContentLookup } from '../../src/services/artifacts/scheme/endpoint-library';
import type { EndpointServices } from '../../src/endpoint/services';

export type FakeServices = EndpointServices & { lines: string[]; holds: Set<string>; cleanup(): void };

/** A fresh ref as `mawsd` mints one: 22 base64url characters, or `<prefix>_` and 22 under a delegation. */
export const mintRef = (prefix?: string) => `${prefix === undefined ? '' : `${prefix}_`}${randomBytes(16).toString('base64url')}` as MachineRef;

export function fakeServices(options: { ref?: MachineRef; kind?: 'unit' | 'private'; profileDir?: string } = {}): FakeServices {
  const profileDir = options.profileDir ?? fs.mkdtempSync(join(tmpdir(), 'endpoint-profile-'));
  const stateDir = join(profileDir, 'mawsd', 'endpoint');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(join(profileDir, 'mawsd'), 0o700);
  fs.chmodSync(stateDir, 0o700);
  const lines: string[] = [];
  const holds = new Set<string>();
  const none = () => () => {};
  return {
    machine: { ref: options.ref ?? mintRef(), profileDir, stateDir, kind: options.kind ?? 'private' },
    dispatch: async (_owner, name) => ({ t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: `the fake services dispatch nothing (${name})` } }),
    onEvent: none,
    onAttachment: none,
    onFrame: none,
    documents: { open: () => false, close: () => {}, frame: () => false, onClosed: none },
    onUpstream: none,
    hold(reason) {
      const id = `${reason}#${holds.size}`;
      holds.add(id);
      return () => void holds.delete(id);
    },
    interest: { report: () => {}, drop: () => {} },
    artifacts: { fetch: async () => ({ status: 404, headers: {}, body: null }) }, // P5 O5 M2
    log: (line) => void lines.push(line),
    lines,
    holds,
    cleanup: () => fs.rmSync(profileDir, { recursive: true, force: true }),
  };
}

/**
 * P5 O7 M5b: a real `artifacts.fetch` over a scratch store, in place of the fake's 404: the artifact endpoint's own library
 * (endpoint-library.ts, the scheme's handler: its headers, ranges, the bridge script in an `html` page) over an
 * `artifacts.content` that answers the files `put` here, under the profile. A path never put, or a revision but 1 or
 * `live`, is the store's not-found. `fetches` counts the requests the handler answered.
 */
export function scratchArtifacts(services: FakeServices): { put(artifactId: string, path: string, content: string | Uint8Array, kind?: ArtifactKind): void; fetches: () => number } {
  const root = join(services.machine.profileDir, 'scratch-artifacts');
  const files = new Map<string, { disk: string; kind: ArtifactKind; size: number; sha256: string }>();
  const content: ContentLookup = async ({ artifactId, revision, path }) => {
    const file = files.get(`${artifactId}\n${path ?? ''}`);
    if (file === undefined || (revision !== undefined && revision !== 1)) return { ok: false, error: { code: 'internal', message: 'not found' } };
    return { ok: true, value: { revision: 1, kind: file.kind, name: basename(path!), size: file.size, sha256: file.sha256, path: file.disk } };
  };
  let fetches = 0;
  services.artifacts = endpointLibrary(content, () => void fetches++);
  return {
    put(artifactId, path, data, kind = path.endsWith('.html') ? 'html' : 'file') {
      const disk = join(root, artifactId, ...path.split('/'));
      fs.mkdirSync(join(disk, '..'), { recursive: true });
      fs.writeFileSync(disk, data);
      const bytes = fs.readFileSync(disk);
      files.set(`${artifactId}\n${path}`, { disk, kind, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
    },
    fetches: () => fetches,
  };
}
