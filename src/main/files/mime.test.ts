import { describe, expect, it } from 'vitest';
import { fileMime, isBinaryHead, isTextMime, mimeOf } from './mime';

describe('files mime', () => {
  it('names a type by extension, case-insensitively, and text/plain for anything unknown', () => {
    expect(mimeOf('a.png')).toBe('image/png');
    expect(mimeOf('A.PNG')).toBe('image/png');
    expect(mimeOf('label.svg')).toBe('image/svg+xml');
    expect(mimeOf('doc.pdf')).toBe('application/pdf');
    expect(mimeOf('page.html')).toBe('text/html');
    expect(mimeOf('README.md')).toBe('text/markdown');
    expect(mimeOf('app.ts')).toBe('text/x-typescript');
    expect(mimeOf('data.json')).toBe('application/json');
    expect(mimeOf('clip.mp4')).toBe('video/mp4');
    expect(mimeOf('song.mp3')).toBe('audio/mpeg');
    expect(mimeOf('Makefile')).toBe('text/plain');
    expect(mimeOf('.env')).toBe('text/plain');
    expect(mimeOf('notes.unknownext')).toBe('text/plain');
  });

  it('knows which types are text', () => {
    for (const mime of ['text/plain', 'text/html', 'application/json', 'application/xml', 'application/javascript', 'application/x-sh', 'image/svg+xml']) {
      expect(isTextMime(mime), mime).toBe(true);
    }
    for (const mime of ['image/png', 'application/pdf', 'application/octet-stream', 'video/mp4']) expect(isTextMime(mime), mime).toBe(false);
  });

  it('finds a NUL in a head', () => {
    expect(isBinaryHead(Buffer.from('plain text\n'))).toBe(false);
    expect(isBinaryHead(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
    expect(isBinaryHead(Buffer.alloc(0))).toBe(false);
  });

  it('answers application/octet-stream for a text name whose head holds a NUL, and keeps a binary type as named', () => {
    expect(fileMime('data.bin', Buffer.from([1, 0, 2]))).toBe('application/octet-stream');
    expect(fileMime('notes.txt', Buffer.from([1, 0, 2]))).toBe('application/octet-stream');
    expect(fileMime('dot.png', Buffer.from([0x89, 0x50, 0, 0]))).toBe('image/png');
    expect(fileMime('notes.txt', Buffer.from('hello'))).toBe('text/plain');
  });
});
