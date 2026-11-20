// The two older builds a peer can be, at the schema of `files.*` (UX wave U6e,
// docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, M1 "The older builds, at the schema"; §A's four
// pairings): build F (`f1852de3a`, on the owner's machines) and master before U6e (`2c7044231`). Each peer's
// `schema/files.ts` and `names/files.ts` are committed snapshots under ./peers/<commit>/, made by ./peers/generate.sh with
// nothing changed but one import, so this suite needs no git history and never skips. Both peers' daemons read a
// command's input with the tolerant reader and answer `unknown_command` to a name they do not know.
import { describe, expect, it } from 'vitest';
import type * as z from 'zod';
import { readTolerant } from '@shared/ipc/tolerant';
import { commands as built, FilesListOutputSchema, FilesReadOutputSchema, FilesWriteInputSchema, FilesWriteOutsideInputSchema } from '@shared/ipc/schema/files';
import * as namesF from './peers/f1852de3a/names-files';
import * as schemaF from './peers/f1852de3a/schema-files';
import * as namesMaster from './peers/2c7044231/names-files';
import * as schemaMaster from './peers/2c7044231/schema-files';

interface Peer {
  build: string;
  schema: { commands: Record<string, { input: z.ZodType; output: z.ZodType }> };
  names: { commands: readonly string[]; mainOnlyCommands: readonly string[] };
  knowsNamed: boolean; // U6c's key, which master at 2c7044231 knows and build F does not
}
const PEERS: Peer[] = [
  { build: 'f1852de3a', schema: schemaF, names: namesF, knowsNamed: false },
  { build: '2c7044231', schema: schemaMaster, names: namesMaster, knowsNamed: true },
];

const SESSION = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);
// What the tolerant reader dropped, in a stable order
const droppedBy = (read: ReturnType<typeof readTolerant>) => (read.ok ? [...read.dropped].sort() : null);
const READ_OUTPUT = { encoding: 'utf8', content: 'notes\n', bytes: 6, offset: 0, length: 6, truncated: false, mime: 'text/plain', hash: HASH, utf8: true } as const;
// UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, M1 decision 9): a listing as both
// builds answer it, and the same listing as this build answers it with two entries git ignores
const entry = (name: string, kind: 'file' | 'dir') => ({ name, path: `/work/repo/${name}`, kind, size: kind === 'dir' ? 96 : 12, mtimeMs: 1_700_000_000_000, target: null });
const LISTING = { root: '/work/repo', path: '/work/repo', entries: [entry('node_modules', 'dir'), entry('src', 'dir'), entry('debug.log', 'file')], truncated: false };
const MARKED = { ...LISTING, entries: [{ ...LISTING.entries[0]!, ignored: true }, LISTING.entries[1]!, { ...LISTING.entries[2]!, ignored: true }] };

describe.each(PEERS)('a peer of build $build', (peer) => {
  const peerInput = (name: string) => peer.schema.commands[name]!.input;
  const peerOutput = (name: string) => peer.schema.commands[name]!.output;

  it('knows neither files.writeOutside nor files.grant, so its daemon answers unknown_command and writes nothing', () => {
    const known = new Set([...peer.names.commands, ...peer.names.mainOnlyCommands, ...Object.keys(peer.schema.commands)]);
    expect(known.has('files.writeOutside')).toBe(false);
    expect(known.has('files.grant')).toBe(false);
    expect(Object.keys(built)).toEqual(expect.arrayContaining(['files.writeOutside', 'files.grant']));
  });

  // UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, K11, K12): the follow of a link is
  // a command neither peer knows, so a window of this build on either daemon goes on to the read, which that daemon
  // refuses for a file outside the folders; and neither answers a read with outside, so neither answers its linked
  it('knows no files.follow, so its daemon answers unknown_command and records nothing', () => {
    const known = new Set([...peer.names.commands, ...peer.names.mainOnlyCommands, ...Object.keys(peer.schema.commands)]);
    expect(known.has('files.follow')).toBe(false);
    expect(Object.keys(built)).toContain('files.follow');
    const linked = { ...READ_OUTPUT, named: true, outside: { real: '/work/notes.txt', writable: false, why: 'result', linked: true } };
    expect(FilesReadOutputSchema.safeParse(linked).success).toBe(true);
    expect(droppedBy(readTolerant(peerOutput('files.read'), linked))).toEqual(peer.knowsNamed ? ['outside'] : ['named', 'outside']);
  });

  // UX wave U6b-4a (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decision 1): neither peer knows Open in's
  // admission, so its daemon answers unknown_command and main opens nothing
  it('knows no files.admit, so Open in opens nothing against its daemon', () => {
    const known = new Set([...peer.names.commands, ...peer.names.mainOnlyCommands, ...Object.keys(peer.schema.commands)]);
    expect(known.has('files.admit')).toBe(false);
    expect(Object.keys(built)).toContain('files.admit');
  });

  it('reads this build’s files.read and files.openExternal inputs less exactly the keys it does not know', () => {
    const unknown = peer.knowsNamed ? ['agent'] : ['agent', 'named'];
    const read = { appSessionId: SESSION, path: '/work/notes.txt', hash: true, named: true, agent: true };
    expect(built['files.read'].input.safeParse(read).success).toBe(true);
    const asRead = readTolerant(peerInput('files.read'), read);
    expect(droppedBy(asRead)).toEqual(unknown);
    expect(asRead.ok && asRead.value).toEqual(peer.knowsNamed ? { appSessionId: SESSION, path: '/work/notes.txt', hash: true, named: true } : { appSessionId: SESSION, path: '/work/notes.txt', hash: true });
    const open = { appSessionId: SESSION, path: '/work/report.pdf', named: true, agent: true };
    expect(built['files.openExternal'].input.safeParse(open).success).toBe(true);
    expect(droppedBy(readTolerant(peerInput('files.openExternal'), open))).toEqual(unknown);
  });

  it('answers a read this build’s output schema parses unchanged', () => {
    const answers: unknown[] = [READ_OUTPUT, { ...READ_OUTPUT, hash: null, utf8: null, encoding: 'base64', content: 'AAEC' }];
    if (peer.knowsNamed) answers.push({ ...READ_OUTPUT, named: true }); // a named file, with no `outside`: held read-only (W6)
    for (const answer of answers) {
      expect(peerOutput('files.read').safeParse(answer).success, JSON.stringify(answer)).toBe(true);
      const parsed = FilesReadOutputSchema.safeParse(answer);
      expect(parsed.success && parsed.data, JSON.stringify(answer)).toEqual(answer);
    }
    // and this build's answer with the new keys is read by the peer's page less them (its client reads outputs tolerantly)
    const outside = { ...READ_OUTPUT, named: true, outside: { real: '/work/notes.txt', writable: true }, own: true };
    expect(FilesReadOutputSchema.safeParse(outside).success).toBe(true);
    expect(droppedBy(readTolerant(peerOutput('files.read'), outside))).toEqual(peer.knowsNamed ? ['outside', 'own'] : ['named', 'outside', 'own']);
  });

  it('reads this build’s files.list answer with marked entries less exactly their ignored keys', () => {
    expect(built['files.list'].output).toBe(FilesListOutputSchema);
    expect(FilesListOutputSchema.safeParse(MARKED).success).toBe(true);
    expect(peerOutput('files.list').safeParse(MARKED).success).toBe(false); // the peer's schema is strict: the reader is what passes it
    const read = readTolerant(peerOutput('files.list'), MARKED);
    expect(droppedBy(read)).toEqual(['entries.0.ignored', 'entries.2.ignored']);
    expect(read.ok && read.value).toEqual(LISTING);
  });

  it('answers a files.list this build’s output schema parses unchanged', () => {
    expect(peerOutput('files.list').safeParse(LISTING).success).toBe(true);
    const parsed = FilesListOutputSchema.safeParse(LISTING);
    expect(parsed.success && parsed.data).toEqual(LISTING);
    expect(parsed.success && parsed.data.entries.some((one) => 'ignored' in one)).toBe(false);
  });

  it('sends a files.write this build parses unchanged, and this build’s files.write is the peer’s', () => {
    const write = { appSessionId: SESSION, path: '/work/repo/a.ts', content: 'export {};\n', expectedHash: HASH };
    expect(peerInput('files.write').safeParse(write).success).toBe(true);
    const parsed = FilesWriteInputSchema.safeParse(write);
    expect(parsed.success && parsed.data).toEqual(write);
    expect(built['files.write'].input).toBe(FilesWriteInputSchema);
    // the outside save is not a files.write with a key the peer would drop: its input is refused by files.write's schema
    expect(FilesWriteInputSchema.safeParse({ ...write, real: '/work/repo/a.ts' }).success).toBe(false);
    expect(FilesWriteOutsideInputSchema.safeParse({ ...write, real: '/work/repo/a.ts' }).success).toBe(true);
  });
});
