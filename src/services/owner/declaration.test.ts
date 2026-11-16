// The one reader of an installation's declaration (the UX wave, U2b: Interfaces §A, decision 2; §I, item 2): the file
// `maws-surface.json` at the installation's root says the installation's view draws on a client's surface from the
// number it names. A missing, unreadable or otherwise shaped file does not declare, whatever the installation's version.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TO_HUMAN_DECLARATION } from '@shared/owner/contract';
import { readDeclaration } from './declaration';

describe('readDeclaration', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-declaration-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const installation = (file: string | null, version = '0.9.0') => {
    const path = join(root, 'plugins', 'cache', 'doperpowers', 'to-human', version);
    mkdirSync(join(path, '.claude-plugin'), { recursive: true });
    writeFileSync(join(path, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'to-human', version }));
    if (file !== null) writeFileSync(join(path, TO_HUMAN_DECLARATION), file);
    return path;
  };

  it('reads the file at the installation’s root', async () => {
    expect(TO_HUMAN_DECLARATION).toBe('maws-surface.json');
    expect(await readDeclaration(installation('{ "toHumanView": { "drawsFrom": 9 } }\n'))).toBe(true);
  });

  it.each([
    ['no file (an installation with a higher version and no declaration)', null, '9.9.9'],
    ['a number above the advertisement', '{ "toHumanView": { "drawsFrom": 10 } }', '0.9.0'],
    ['a text that does not parse', '{ "toHumanView": { "drawsFrom": 9 ', '0.9.0'],
    ['another shape', '{ "drawsFrom": 9 }', '0.9.0'],
    ['an empty file', '', '0.9.0'],
  ])('does not declare with %s', async (_, file, version) => {
    expect(await readDeclaration(installation(file, version))).toBe(false);
  });

  it('does not declare where the installation’s folder is gone, or the declaration is a folder', async () => {
    expect(await readDeclaration(join(root, 'nowhere'))).toBe(false);
    const path = installation(null);
    mkdirSync(join(path, TO_HUMAN_DECLARATION));
    expect(await readDeclaration(path)).toBe(false);
  });

  it('does not declare with a file past its bound, which no declaration needs', async () => {
    expect(await readDeclaration(installation(`{ "toHumanView": { "drawsFrom": 9 } }${' '.repeat(70_000)}`))).toBe(false);
  });
});
