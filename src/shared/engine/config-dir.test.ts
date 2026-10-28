import { describe, expect, it } from 'vitest';
import { claudeConfigDir } from './config-dir';

describe('claudeConfigDir', () => {
  it('reads the configuration directory from CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/scratch/claude' }, '/Users/x')).toBe('/scratch/claude');
    expect(claudeConfigDir({}, '/Users/x')).toBe('/Users/x/.claude');
  });
});
