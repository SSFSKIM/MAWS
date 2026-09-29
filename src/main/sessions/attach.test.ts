import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../../test/support/fixtures';
import { attachCommand, BG_REFUSAL, bgRefusalOf } from './attach';

const PINNED = '/Users/new/.local/share/claude/versions/2.1.283';

describe('held outcomes and the attach command', () => {
  it("runs the pinned binary's attach for the job, the path single-quoted", () => {
    expect(attachCommand(PINNED, 'e6dcd828')).toBe(`'${PINNED}' attach e6dcd828`);
    expect(attachCommand("/Apps/It's Claude/claude", 'e6dcd828')).toBe(`'/Apps/It'\\''s Claude/claude' attach e6dcd828`);
    expect(attachCommand(PINNED, 'x; rm -rf ~')).toBe(`'${PINNED}' attach 'x; rm -rf ~'`); // a job id is never shell syntax
  });

  it("matches the engine's --bg refusal and its short id (pass2/resume-live-bg seq 5)", () => {
    const text = String((loadJournal('pass2', 'resume-live-bg').find((r) => r.seq === 5)!.frame as { text: string }).text);
    expect(BG_REFUSAL.test(text)).toBe(true);
    expect(bgRefusalOf(text)).toEqual({ jobId: 'e6dcd828' });
    expect(bgRefusalOf('Error: Session x is running as a background session. Run claude attach')).toEqual({ jobId: null });
    expect(bgRefusalOf('Session ID abc is already in use')).toBeNull();
  });
});
