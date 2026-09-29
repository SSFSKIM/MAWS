import { describe, expect, it } from 'vitest';
import { opensExternally } from './files';

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
