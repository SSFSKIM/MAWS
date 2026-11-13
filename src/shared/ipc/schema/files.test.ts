import { describe, expect, it } from 'vitest';
import { readTolerant } from '../tolerant';
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
