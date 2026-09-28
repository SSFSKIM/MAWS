import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStorePaths, slugOf } from './paths';

// The engine's own hash32 (SPEC 35.2.1), reproduced here so the 200-character case is checked against the algorithm and
// not against the implementation under test.
function hash32(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return hash;
}

describe('slugOf matches the engine', () => {
  it('replaces every non-alphanumeric character with a dash and never lowercases', () => {
    expect(slugOf('/a/b')).toBe('-a-b');
    expect(slugOf('/Users/new/Developer/GitHub/MAWS')).toBe('-Users-new-Developer-GitHub-MAWS');
    expect(slugOf('/private/tmp/maws-probe-WmHZ2j')).toBe('-private-tmp-maws-probe-WmHZ2j');
    expect(slugOf('/Users/x/a.b')).toBe('-Users-x-a-b');
    expect(slugOf('/')).toBe('-');
  });

  it('cuts at 200 characters and appends a base-36 hash of the original path', () => {
    const path = '/' + 'segment/'.repeat(32) + 'tail'; // 261 characters
    expect(path.length).toBeGreaterThan(200);
    const slug = slugOf(path);
    const expectedHash = Math.abs(hash32(path)).toString(36);
    expect(slug).toBe(path.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200) + '-' + expectedHash);
    expect(slug.slice(0, 200)).toMatch(/^[-A-Za-z0-9]{200}$/);
    expect(slug.charAt(200)).toBe('-');
    expect(slug.slice(201)).toMatch(/^[0-9a-z]+$/);
  });

  it('a path of exactly 200 characters is not hashed', () => {
    const path = '/' + 'x'.repeat(199);
    expect(slugOf(path)).toHaveLength(200);
    expect(slugOf(path)).toBe('-' + 'x'.repeat(199));
  });
});

describe('resolveStorePaths', () => {
  it('honours CLAUDE_CONFIG_DIR, NFC-normalised, and lays out the four roots', () => {
    const decomposed = '/tmp/café'; // "café" with a combining accent
    const paths = resolveStorePaths({ CLAUDE_CONFIG_DIR: decomposed });
    expect(paths.configHome).toBe('/tmp/café');
    expect(paths.projects).toBe(join('/tmp/café', 'projects'));
    expect(paths.sessions).toBe(join('/tmp/café', 'sessions'));
    expect(paths.jobs).toBe(join('/tmp/café', 'jobs'));
    expect(paths.tasks).toBe(join('/tmp/café', 'tasks'));
  });

  it('places background-task outputs where the engine does: CLAUDE_CODE_TMPDIR, else /tmp literally, never os.tmpdir()', () => {
    const uid = process.getuid!();
    expect(resolveStorePaths({ CLAUDE_CONFIG_DIR: '/cfg' }).taskOutput).toBe(`/tmp/claude-${uid}`);
    expect(resolveStorePaths({ CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_TMPDIR: '' }).taskOutput).toBe(`/tmp/claude-${uid}`); // empty is unset
    expect(resolveStorePaths({ CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_TMPDIR: '/scratch' }).taskOutput).toBe(`/scratch/claude-${uid}`);
    expect(resolveStorePaths({ CLAUDE_CONFIG_DIR: '/cfg', TMPDIR: '/var/folders/x/T' }).taskOutput).toBe(`/tmp/claude-${uid}`);
  });

  it('falls back to ~/.claude', () => {
    const paths = resolveStorePaths({});
    expect(paths.configHome).toBe(join(homedir(), '.claude'));
    expect(paths.projects).toBe(join(homedir(), '.claude', 'projects'));
  });
});
