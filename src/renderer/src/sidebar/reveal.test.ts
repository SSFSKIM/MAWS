import { expect, test, vi } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import { resetShellStores } from '../test-support/shell-stores';
import { registerProjectRevealer, revealProject } from './reveal';

test('shell reset discards an unmounted sidebar reveal without discarding new reveals', () => {
  resetShellStores();
  revealProject('previous-test' as ProjectId);
  resetShellStores();
  const reveal = vi.fn();
  const off = registerProjectRevealer(reveal);
  try {
    expect(reveal).not.toHaveBeenCalled();
  } finally {
    off();
  }
  revealProject('current-test' as ProjectId);
  const offNext = registerProjectRevealer(reveal);
  try {
    expect(reveal).toHaveBeenCalledExactlyOnceWith('current-test');
  } finally {
    offNext();
    resetShellStores();
  }
});
