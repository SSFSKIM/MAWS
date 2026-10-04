import { expect, it } from 'vitest';
import type { PtyInfo } from '@shared/ipc/schema/pty';
import { paneForPid, parseProcesses, canForeground } from './pane-holder';
const ps = (rows: string) => parseProcesses(rows);
const pane = { pid: 10, alive: true, ptyId: 'pane' } as PtyInfo;
it('finds a nested holder by ancestry, not a sibling or a dead pane', () => {
  const table = ps('10 1 10 30 Ss Mon Oct 3 12:00:00 2026\n20 10 20 30 S Mon Oct 3 12:00:01 2026\n30 20 30 30 R+ Mon Oct 3 12:00:02 2026\n40 1 40 40 S Mon Oct 3 12:00:03 2026');
  expect(paneForPid(30, [pane], table)?.ptyId).toBe('pane');
  expect(paneForPid(40, [pane], table)).toBeNull();
  expect(paneForPid(30, [{ ...pane, alive: false }], table)).toBeNull();
  expect(paneForPid(10, [pane], table)).toBeNull();
});
it('foreground recovery requires exactly one stopped job directly under the shell', () => {
  const table = ps('10 1 10 10 Ss+ Mon Oct 3 12:00:00 2026\n30 10 30 10 T Mon Oct 3 12:00:02 2026');
  expect(canForeground(30, 10, table)).toBe(true);
  expect(canForeground(30, 20, table)).toBe(false);
  expect(canForeground(30, 10, ps('10 1 10 10 Ss+ Mon Oct 3 12:00:00 2026\n30 10 30 10 T Mon Oct 3 12:00:02 2026\n40 10 40 10 T Mon Oct 3 12:00:03 2026'))).toBe(false);
});
