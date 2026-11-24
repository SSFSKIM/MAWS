// The registration's file (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §O; T18; X4), held to a
// schema written field for field from the pin's `schema/surface.schema.json` (its patterns matched against the whole
// string; no JSON Schema validator joins the dependencies, C3's S4), as the pin's own example is. The heartbeat that
// writes it, and its removal at a stop, are serve.test.ts's; a kill, process-sheet-page-registration.test.ts's.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { registrationName, removeRegistration, surfacesDir, writeRegistration, type Registration } from './registration';

const PIN = resolve(__dirname, '../../../test/fixtures/sheet/set');

// The pin's surface.schema.json, field for field: no other property, each required.
const SurfaceSchema = z.strictObject({
  v: z.literal(1),
  name: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  pid: z.number().int().min(1),
  url: z.string().min(1),
  reach: z.enum(['local', 'remote']),
  heartbeatAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/),
});

let scratch: string;
let home: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-sheet-reg-'));
  home = join(scratch, 'sminos');
  mkdirSync(home);
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const registration = (over: Partial<Registration> = {}): Registration => ({ v: 1, name: 'mawsd', pid: process.pid, url: 'http://sheet.localhost:47591', reach: 'local', heartbeatAt: new Date(Date.parse('2026-11-24T10:00:00.000Z')).toISOString(), ...over });
const fileOf = (name = 'mawsd') => join(surfacesDir(home), `${name}.json`);
const mode = (path: string) => lstatSync(path).mode & 0o777;

describe('the schema written from the pin', () => {
  it('holds the pin’s own example, and what this module writes', () => {
    expect(SurfaceSchema.safeParse(JSON.parse(readFileSync(join(PIN, 'examples/surface.json'), 'utf8'))).success).toBe(true);
    expect(writeRegistration(home, registration())).toBe('written');
    expect(SurfaceSchema.parse(JSON.parse(readFileSync(fileOf(), 'utf8')))).toEqual(registration());
    expect(writeRegistration(home, registration({ name: registrationName(false, '/Users/me/Library/Application Support/MAWS-scratch') }))).toBe('written');
    for (const name of readdirSync(surfacesDir(home))) expect(SurfaceSchema.safeParse(JSON.parse(readFileSync(join(surfacesDir(home), name), 'utf8'))).success, name).toBe(true);
  });

  it('refuses what the pin’s schema refuses, so the test’s schema is not looser than the pin', () => {
    expect(SurfaceSchema.safeParse({ ...registration(), extra: 1 }).success).toBe(false);
    expect(SurfaceSchema.safeParse({ ...registration(), heartbeatAt: '2026-11-24T10:00:00Z' }).success).toBe(false);
    expect(SurfaceSchema.safeParse({ ...registration(), name: 'a/b' }).success).toBe(false);
    expect(SurfaceSchema.safeParse({ ...registration(), pid: 0 }).success).toBe(false);
  });
});

describe('the name', () => {
  it('is mawsd for the default profile, and mawsd-<12 hex of the profile path’s SHA-1> for any other', () => {
    expect(registrationName(true, '/Users/me/Library/Application Support/MAWS')).toBe('mawsd');
    const other = registrationName(false, '/Users/me/scratch/profile');
    expect(other).toMatch(/^mawsd-[0-9a-f]{12}$/);
    expect(registrationName(false, '/Users/me/scratch/profile')).toBe(other);
    expect(registrationName(false, '/Users/me/scratch/another')).not.toBe(other);
  });
});

describe('the write', () => {
  it('makes sheet/ and surfaces/ at 0700 and the file at 0600, by replace, and leaves no temporary file', () => {
    expect(writeRegistration(home, registration())).toBe('written');
    expect(mode(join(home, 'sheet'))).toBe(0o700);
    expect(mode(surfacesDir(home))).toBe(0o700);
    expect(mode(fileOf())).toBe(0o600);
    expect(readdirSync(surfacesDir(home))).toEqual(['mawsd.json']);
  });

  // A reader on another thread, reading while the file is rewritten: a write in place (truncate, then write) shows it
  // an empty or a partial file within the first rewrites
  it('never shows a reader running beside the rewrites a part of the file', async () => {
    expect(writeRegistration(home, registration())).toBe('written');
    const stop = new Int32Array(new SharedArrayBuffer(4));
    const reader = new Worker(
      `const { workerData: { file, stop } } = require('node:worker_threads');
       const { readFileSync } = require('node:fs');
       let reads = 0, bad = null;
       while (Atomics.load(stop, 0) === 0 && bad === null) {
         let text = '';
         try { text = readFileSync(file, 'utf8'); JSON.parse(text); reads += 1; } catch (error) { if (error.code !== 'ENOENT') bad = JSON.stringify(text); }
       }
       require('node:worker_threads').parentPort.postMessage({ reads, bad });`,
      { eval: true, workerData: { file: fileOf(), stop } },
    );
    const seen = new Promise<{ reads: number; bad: string | null }>((done) => reader.once('message', done));
    await new Promise((started) => setTimeout(started, 50));
    const until = Date.now() + 1_500; // each rewrite syncs to disk: a time, not a count, bounds the loop
    for (let i = 0; Date.now() < until; i++) writeRegistration(home, registration({ heartbeatAt: new Date(Date.parse('2026-11-24T10:00:00.000Z') + i).toISOString() }));
    Atomics.store(stop, 0, 1);
    const { reads, bad } = await seen;
    await reader.terminate();
    expect(bad, 'what the reader saw').toBeNull();
    expect(reads, 'the reader read while the rewrites ran').toBeGreaterThan(100);
    expect(SurfaceSchema.safeParse(JSON.parse(readFileSync(fileOf(), 'utf8'))).success).toBe(true);
  });

  it('replaces a file standing at another mode with one at 0600, and follows no link at a temporary name', () => {
    mkdirSync(surfacesDir(home), { recursive: true, mode: 0o700 });
    writeFileSync(fileOf(), 'old', { mode: 0o644 });
    chmodSync(fileOf(), 0o644);
    const elsewhere = join(scratch, 'elsewhere.json');
    writeFileSync(elsewhere, 'untouched');
    symlinkSync(elsewhere, `${fileOf()}.${process.pid}.tmp`); // the name an earlier write used
    expect(writeRegistration(home, registration())).toBe('written');
    expect(mode(fileOf())).toBe(0o600);
    expect(readFileSync(elsewhere, 'utf8')).toBe('untouched');
  });

  it('writes and makes nothing where the home does not exist, and writes once it appears', () => {
    rmSync(home, { recursive: true });
    expect(writeRegistration(home, registration())).toBe('no-home');
    expect(existsSync(home)).toBe(false);
    mkdirSync(home);
    expect(writeRegistration(home, registration())).toBe('written');
  });

  it('refuses a surfaces/ or a sheet/ that is a link, and writes nothing through it', () => {
    const elsewhere = join(scratch, 'elsewhere');
    mkdirSync(elsewhere);
    mkdirSync(join(home, 'sheet'));
    symlinkSync(elsewhere, surfacesDir(home));
    expect(writeRegistration(home, registration())).toBe('refused');
    expect(readdirSync(elsewhere)).toEqual([]);

    rmSync(join(home, 'sheet'), { recursive: true });
    symlinkSync(elsewhere, join(home, 'sheet'));
    expect(writeRegistration(home, registration())).toBe('refused');
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('refuses a surfaces that is a file', () => {
    mkdirSync(join(home, 'sheet'));
    writeFileSync(surfacesDir(home), 'not a directory');
    expect(writeRegistration(home, registration())).toBe('refused');
  });
});

describe('the removal', () => {
  it('holds to the write’s confinement: through a linked sheet/ or surfaces/ it removes nothing, and it makes nothing', () => {
    const elsewhere = join(scratch, 'elsewhere');
    mkdirSync(join(elsewhere, 'surfaces'), { recursive: true });
    writeFileSync(join(elsewhere, 'surfaces', 'mawsd.json'), JSON.stringify(registration()));
    writeFileSync(join(elsewhere, 'mawsd.json'), JSON.stringify(registration()));
    symlinkSync(elsewhere, join(home, 'sheet')); // sheet/ is a link
    removeRegistration(home, 'mawsd', process.pid);
    expect(existsSync(join(elsewhere, 'surfaces', 'mawsd.json'))).toBe(true);

    rmSync(join(home, 'sheet'));
    mkdirSync(join(home, 'sheet'));
    symlinkSync(elsewhere, surfacesDir(home)); // surfaces/ is a link
    removeRegistration(home, 'mawsd', process.pid);
    expect(existsSync(join(elsewhere, 'mawsd.json'))).toBe(true);

    rmSync(join(home, 'sheet'), { recursive: true });
    removeRegistration(home, 'mawsd', process.pid);
    expect(readdirSync(home), 'nothing made').toEqual([]);
    rmSync(home, { recursive: true });
    removeRegistration(home, 'mawsd', process.pid);
    expect(existsSync(home)).toBe(false);
  });

  it('removes only a regular file: a link at the registration’s name stays, and so does what it names', () => {
    mkdirSync(surfacesDir(home), { recursive: true, mode: 0o700 });
    const target = join(scratch, 'target.json');
    writeFileSync(target, JSON.stringify(registration()));
    symlinkSync(target, fileOf());
    removeRegistration(home, 'mawsd', process.pid);
    expect(lstatSync(fileOf()).isSymbolicLink()).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('removes the file that names this pid, and leaves one that names another', () => {
    writeRegistration(home, registration());
    removeRegistration(home, 'mawsd', process.pid + 1);
    expect(existsSync(fileOf())).toBe(true);
    removeRegistration(home, 'mawsd', process.pid);
    expect(existsSync(fileOf())).toBe(false);
    expect(() => removeRegistration(home, 'mawsd', process.pid)).not.toThrow(); // gone already
  });
});
