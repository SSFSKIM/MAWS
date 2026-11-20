// The endpoint's record of the protected folders a member opened (`MachineSetup.listed`, P5 O7 M9; UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, Decision Log 19): an answered
// `machine.folders.list` with `open: true` keeps the real path the list resolved, so a link that is the path's last
// component is kept as its target, the folder macOS was asked about, and a link on the way into a protected folder opens
// nothing. A fake home under a temp directory, the platform injected as macOS: no test reads a real protected folder.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MachineSetup } from './policy';

let home: string;
let setup: MachineSetup;
const member = 'member-of-the-suite';

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'policy-')));
  for (const dir of ['Developer', 'Documents/proj']) mkdirSync(join(home, dir), { recursive: true });
  symlinkSync(join(home, 'Documents/proj'), join(home, 'Developer/proj-link'));
  symlinkSync(join(home, 'Documents'), join(home, 'Developer/docs-link'));
  setup = new MachineSetup(() => ({ home, platform: 'darwin' }));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the record of the protected folders a member opened', () => {
  it('keeps the target of a last-component link listed with `open: true`, not the path as typed', async () => {
    await setup.listed(member, { path: '~/Developer/proj-link', open: true });
    expect(setup.openedBy(member)).toEqual([join(home, 'Documents/proj')]);
    expect(setup.opened(member, join(home, 'Documents'))).toBe(true);
    expect(setup.opened(member, join(home, 'Developer/proj-link'))).toBe(false);
    await setup.listed(member, { path: join(home, 'Developer/docs-link'), open: true });
    expect(setup.openedBy(member)).toEqual([join(home, 'Documents/proj'), join(home, 'Documents')]);
  });

  it('keeps nothing for a link on the way into a protected folder, with `open: true` or without, nor for a list without it', async () => {
    await setup.listed(member, { path: '~/Developer/docs-link/proj', open: true });
    await setup.listed(member, { path: '~/Developer/docs-link/proj' });
    await setup.listed(member, { path: '~/Developer/proj-link' });
    expect(setup.openedBy(member)).toEqual([]);
    expect(setup.opened(member, join(home, 'Documents'))).toBe(false);
  });
});
