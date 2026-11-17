import { describe, expect, it } from 'vitest';
import { readTolerant } from '../tolerant';
import { commands as libraryCommands } from './library';
import { commands, FilesOpenExternalInputSchema, FilesReadInputSchema, FilesReadOutputSchema, FilesReadResolvedInputSchema, opensExternally } from './files';

describe('files opensExternally', () => {
  it('is true for the document and media kinds MAWS hands to the OS on purpose', () => {
    for (const name of ['doc.pdf', 'page.html', 'page.HTM', 'dot.png', 'label.svg', 'song.mp3', 'clip.mp4', 'Clip.MOV', 'report.docx', 'Sheet.XLSX', 'deck.pptx', 'notes.odt', 'letter.rtf', 'plan.pages', 'budget.numbers', 'talk.key', 'book.epub', 'calc.ods', 'show.odp', 'notes.txt', 'server.LOG', 'table.csv', 'table.tsv']) {
      expect(opensExternally(name), name).toBe(true);
    }
    expect(opensExternally('/abs/dir.with.dots/doc.pdf')).toBe(true);
  });

  it('is false for anything else, whatever an installed app might register for it', () => {
    for (const name of ['tool.py', 'archive.zip', 'data.bin', 'run.sh', 'script.command', 'Installer.pkg', 'Tool.app', 'app.ts', 'README.md', 'old.doc', 'old.XLS', 'old.ppt', 'Makefile', '.env', 'x.jar', 'disk.dmg', 'link.webloc', 'noext', 'trailing.']) {
      expect(opensExternally(name), name).toBe(false);
    }
  });
});

// UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §D): `named` on files.read and
// files.openExternal, and on the read's answer, optional and additive; a peer of the same major that does not know it
// (build F's `mawsd`, whose front reads with the tolerant reader) reads the plain request
describe('files named', () => {
  const asked = { appSessionId: '11111111-1111-4111-8111-111111111111', path: '/elsewhere/notes.txt' };

  it('is an optional `true` on files.read’s and files.openExternal’s input, and nothing else', () => {
    for (const name of ['files.read', 'files.openExternal'] as const) {
      const input = commands[name].input;
      expect(input.safeParse(asked).success, name).toBe(true);
      expect(input.safeParse({ ...asked, named: true }).success, name).toBe(true);
      expect(input.safeParse({ ...asked, named: false }).success, name).toBe(false);
    }
    for (const name of ['files.reveal', 'files.watch', 'files.unwatch', 'files.list'] as const) {
      expect(commands[name].input.safeParse({ ...asked, named: true }).success, name).toBe(false);
    }
    expect(FilesReadResolvedInputSchema.safeParse({ path: asked.path, named: true }).success).toBe(false); // left out, as the session is
  });

  it('is an optional `true` on the read’s answer', () => {
    const answer = { encoding: 'utf8', content: 'x', bytes: 1, offset: 0, length: 1, truncated: false, mime: 'text/plain', hash: null, utf8: null };
    expect(FilesReadOutputSchema.safeParse(answer).success).toBe(true);
    expect(FilesReadOutputSchema.safeParse({ ...answer, named: true }).success).toBe(true);
    expect(FilesReadOutputSchema.safeParse({ ...answer, named: false }).success).toBe(false);
  });

  it('is dropped by a reader that does not know it, which reads the plain request', () => {
    // each command's input as a build without the key has it
    const before = { 'files.read': FilesReadInputSchema.omit({ named: true }), 'files.openExternal': FilesOpenExternalInputSchema.omit({ named: true }) };
    for (const [name, schema] of Object.entries(before)) {
      expect(readTolerant(schema, { ...asked, named: true }), name).toEqual({ ok: true, value: asked, dropped: ['named'] });
    }
  });
});

// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, Interfaces §B): `raw` on files.read's
// input and `identity` on its answer, optional and additive; a daemon of an older build drops `raw` and answers the plain
// read, and a reader of an older build drops `identity`
describe('files raw and identity', () => {
  const asked = { appSessionId: '11111111-1111-4111-8111-111111111111', path: '/root/doc.pdf' };
  const answer = { encoding: 'base64', content: 'JVBERg==', bytes: 4, offset: 0, length: 4, truncated: false, mime: 'application/pdf', hash: null, utf8: null };

  it('is an optional `true` on files.read’s input, and an optional non-empty string on its answer', () => {
    expect(FilesReadInputSchema.safeParse({ ...asked, raw: true }).success).toBe(true);
    expect(FilesReadInputSchema.safeParse({ ...asked, raw: false }).success).toBe(false);
    expect(FilesReadOutputSchema.safeParse({ ...answer, identity: '1:2:4:5:6' }).success).toBe(true);
    expect(FilesReadOutputSchema.safeParse({ ...answer, identity: '' }).success).toBe(false);
    expect(FilesReadOutputSchema.safeParse(answer).success).toBe(true);
  });

  it('a reader that does not know raw reads the request as the plain one', () => {
    expect(readTolerant(FilesReadInputSchema.omit({ raw: true }), { ...asked, raw: true })).toEqual({ ok: true, value: asked, dropped: ['raw'] });
  });

  it('an answer with identity is read by a reader that does not know it as the answer without it', () => {
    expect(readTolerant(FilesReadOutputSchema.omit({ identity: true }), { ...answer, identity: '1:2:4:5:6' })).toEqual({ ok: true, value: answer, dropped: ['identity'] });
  });

  it('files.readResolved refuses raw', () => {
    expect(FilesReadResolvedInputSchema.safeParse({ path: asked.path }).success).toBe(true);
    expect(FilesReadResolvedInputSchema.safeParse({ path: asked.path, raw: true }).success).toBe(false);
    expect(commands['files.readResolved'].input.safeParse({ path: asked.path, raw: true }).success).toBe(false);
    // library.read picks three of the read's keys, and so takes none of the others (B14)
    const stored = { artifactId: '22222222-2222-4222-8222-222222222222' };
    expect(libraryCommands['library.read'].input.safeParse(stored).success).toBe(true);
    expect(libraryCommands['library.read'].input.safeParse({ ...stored, raw: true }).success).toBe(false);
  });
});
