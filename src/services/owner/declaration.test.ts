// The one reader of an installation's declaration (the UX wave, U2b: Interfaces §A, decision 2; §I, item 2): the file
// `maws-surface.json` at the installation's root says the installation's view draws on a client's surface from the
// number it names. A missing, unreadable or otherwise shaped file does not declare, whatever the installation's version.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TO_HUMAN_DECLARATION } from '@shared/owner/contract';
import { declarationOf, readDeclaration } from './declaration';

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

// The tracker's reading after a reload (§A, table B: the declaration yes, no, or failed): a missing file and one that
// does not parse to the declaring shape are a confirmed "no"; an I/O error other than "no such file" is a failed read,
// unknown, which the tracker reads as declaring. The launch's reading (`readDeclaration`) takes a failed read as "no".
describe('declarationOf', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-declaration-of-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const installation = (file: string | null) => {
    const path = join(root, 'to-human', '0.9.0');
    mkdirSync(path, { recursive: true });
    if (file !== null) writeFileSync(join(path, TO_HUMAN_DECLARATION), file);
    return path;
  };

  it('yes: the declaring file', async () => {
    expect(await declarationOf(installation('{ "toHumanView": { "drawsFrom": 9 } }'))).toBe(true);
  });
  it('no: a missing file, a missing installation, another shape, a text that does not parse, a file past its bound', async () => {
    expect(await declarationOf(installation(null))).toBe(false);
    expect(await declarationOf(join(root, 'nowhere'))).toBe(false);
    rmSync(join(root, 'to-human'), { recursive: true });
    expect(await declarationOf(installation('{ "drawsFrom": 9 }'))).toBe(false);
    rmSync(join(root, 'to-human'), { recursive: true });
    expect(await declarationOf(installation('{ "toHumanView": '))).toBe(false);
    rmSync(join(root, 'to-human'), { recursive: true });
    expect(await declarationOf(installation(`{ "toHumanView": { "drawsFrom": 9 } }${' '.repeat(70_000)}`))).toBe(false);
  });
  it('failed (null): an I/O error other than “no such file”, a folder in the file’s place or a loop of links; the launch reads either as no', async () => {
    const folder = installation(null);
    mkdirSync(join(folder, TO_HUMAN_DECLARATION));
    expect(await declarationOf(folder)).toBeNull();
    expect(await readDeclaration(folder)).toBe(false);
    const looped = join(root, 'looped');
    mkdirSync(looped);
    symlinkSync(join(looped, 'b'), join(looped, TO_HUMAN_DECLARATION));
    symlinkSync(join(looped, TO_HUMAN_DECLARATION), join(looped, 'b'));
    expect(await declarationOf(looped)).toBeNull();
    expect(await readDeclaration(looped)).toBe(false);
  });
});
