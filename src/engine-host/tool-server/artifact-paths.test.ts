// P4 tool-server path bounds (the tech-debt row of 2026-10-18, after P3-F's artifact-protocol #4 fix): once the tool
// server has checked where a path leads, a file something racing in the working directory puts in its place is neither
// read nor written through. `artifact_upload_asset` reads its source through one descriptor of the very file checked;
// `artifact_export` opens its copy's destination through its real directory and no link. The static cases (a link
// already in place) are artifact-tools.test.ts's.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactRefusalOf } from '@shared/maws/tools';
import { artifactUploadAssetTool } from './artifact-assets';
import { artifactExportTool, type ArtifactExportAnswer, type ArtifactExportRequest } from './artifact-export';
import { artifactCreateTool } from './artifact-tools';
import { jsonOf, openWorld, textOf, type World } from './artifact-world.fixture';
import { HostBridge } from './bridge';

// A hook run once just before the tool server opens, reads or copies onto one of `paths` (a file's named path and its
// real one): after every check of where the path leads, where a racing process could put something in the file's place.
// It watches each call that could touch the file, so a read or a copy by path fails these cases as an open does.
const race = vi.hoisted(() => ({ paths: null as string[] | null, swap: null as (() => void) | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const fire = (path: unknown) => {
    if (race.paths === null || !race.paths.includes(String(path))) return;
    const swap = race.swap;
    race.paths = race.swap = null;
    swap?.();
  };
  const open = (async (...args: Parameters<typeof actual.open>) => (fire(args[0]), actual.open(...args))) as typeof actual.open;
  const readFile = (async (...args: Parameters<typeof actual.readFile>) => (fire(args[0]), actual.readFile(...args))) as typeof actual.readFile;
  const copyFile = (async (...args: Parameters<typeof actual.copyFile>) => (fire(args[1]), actual.copyFile(...args))) as typeof actual.copyFile;
  return { ...actual, default: { ...actual, open, readFile, copyFile }, open, readFile, copyFile };
});

let w: World;
let outside: string;
beforeEach(() => {
  w = openWorld();
  outside = mkdtempSync(join(tmpdir(), 'maws-paths-outside-'));
  writeFileSync(join(outside, 'private.txt'), 'secret');
});
afterEach(() => {
  race.paths = race.swap = null;
  w.close();
  rmSync(outside, { recursive: true, force: true });
});

// `swap` runs once, just before the file at `name` (under the working directory) is opened, read or copied onto
const arm = (name: string, swap: () => void) => {
  race.paths = [join(w.cwd, name), join(realpathSync(w.cwd), name)];
  race.swap = swap;
};
const replaceWithLink = (name: string, target: string) => () => {
  unlinkSync(join(w.cwd, name));
  symlinkSync(target, join(w.cwd, name));
};
const within = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(`not answered within ${ms} ms`)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

describe('artifact_upload_asset', () => {
  const design = async () => jsonOf<{ artifactId: string }>(await artifactCreateTool(w.deps()).call({ kind: 'design', title: 'Site' }, w.ctx())).artifactId;
  const upload = (artifact: string, path: string) => artifactUploadAssetTool(w.deps()).call({ artifact, path }, w.ctx());

  it('refuses a source whose last component became a link out of the working directory after its checks, adding no asset', async () => {
    const id = await design();
    writeFileSync(join(w.cwd, 'logo.png'), 'png');
    arm('logo.png', replaceWithLink('logo.png', join(outside, 'private.txt')));
    const refused = await upload(id, 'logo.png');
    expect(race.paths).toBeNull(); // the swap ran
    expect(w.store.listAssets(id)).toEqual([]);
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'invalid', path: join(w.cwd, 'logo.png') });
    // the file it names, once it is one again, uploads
    unlinkSync(join(w.cwd, 'logo.png'));
    writeFileSync(join(w.cwd, 'logo.png'), 'png');
    expect(jsonOf(await upload(id, 'logo.png'))).toMatchObject({ status: 'uploaded', name: 'logo.png', size: 3 });
  });

  it('refuses a source replaced by a FIFO after its checks at once, holding no thread (O_NONBLOCK)', async () => {
    const id = await design();
    const pipe = join(w.cwd, 'logo.png');
    writeFileSync(pipe, 'png');
    arm('logo.png', () => {
      unlinkSync(pipe);
      execFileSync('mkfifo', [pipe]);
    });
    try {
      const refused = await within(upload(id, 'logo.png'), 1_000);
      expect(race.paths).toBeNull();
      expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'invalid', path: pipe });
      expect(w.store.listAssets(id)).toEqual([]);
    } finally {
      // a reader the FIFO holds gets its end of file (without one, the open answers ENXIO)
      try {
        closeSync(openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK));
      } catch {
        // no reader
      }
    }
  });
});

describe('artifact_export', () => {
  // main's export service, stubbed: the export written where the host asked, and answered
  const exporter = () => {
    const bridge = new HostBridge<ArtifactExportRequest, ArtifactExportAnswer>({
      send: (request) => {
        writeFileSync(request.path, '%PDF-1.7');
        queueMicrotask(() => bridge.answer(request.requestId, { ok: true, revision: request.revision, path: request.path }));
      },
      answerMs: 60_000,
    });
    return bridge;
  };
  const exportTo = async (to: string) => {
    jsonOf(await artifactCreateTool(w.deps()).call({ handle: 'dash', content: '<p/>', title: 'D' }, w.ctx()));
    return artifactExportTool({ ...w.deps(), exporter: exporter() }).call({ artifact: 'dash', format: 'pdf', to }, w.ctx());
  };

  it('refuses the copy when `to` became a link out of the working directory after its checks, leaving the outside file as it was', async () => {
    writeFileSync(join(w.cwd, 'report.pdf'), 'mine');
    arm('report.pdf', replaceWithLink('report.pdf', join(outside, 'private.txt')));
    const refused = await exportTo('report.pdf');
    expect(race.paths).toBeNull(); // the swap ran
    expect(readFileSync(join(outside, 'private.txt'), 'utf8')).toBe('secret');
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/^artifact_export: exported to .+, but the copy to .+report\.pdf failed: .+ a link/);
  });

  // macOS: the destination opens with O_NOFOLLOW_ANY, which refuses a link anywhere on its real path. Linux's
  // O_NOFOLLOW guards the last component alone, so there a directory above turned into a link after the real
  // directory's check is the documented gap of the Linux unit lane (MAWS ships on macOS), as for datasets.ts's read.
  it.skipIf(process.platform !== 'darwin')('refuses the copy when a directory above `to` became a link out of the working directory after its checks, writing nothing outside', async () => {
    mkdirSync(join(w.cwd, 'out'));
    arm(join('out', 'report.pdf'), () => {
      renameSync(join(w.cwd, 'out'), join(w.cwd, 'out-before'));
      symlinkSync(outside, join(w.cwd, 'out'));
    });
    const refused = await exportTo(join('out', 'report.pdf'));
    expect(race.paths).toBeNull();
    expect(existsSync(join(outside, 'report.pdf'))).toBe(false);
    expect(textOf(refused)).toMatch(/^artifact_export: exported to .+, but the copy to .+report\.pdf failed: /);
  });
});
