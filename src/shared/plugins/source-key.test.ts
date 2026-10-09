// P2-B M2: the key a marketplace entry's source names the plugin's code by (the engine's own fold rule, U3 F5), and
// Desktop's test for the default Anthropic marketplace.
import { describe, expect, it } from 'vitest';
import { isAnthropicDefaultMarketplace, sourceKey } from './source-key';

const OFFICIAL = { source: 'github', locator: 'anthropics/claude-plugins-official' };
const subdir = (url: string, path: string | null) => ({ kind: 'git-subdir', url, repo: null, path });

describe('sourceKey', () => {
  it('names a directory entry and the official marketplace’s relative entry for the same code alike', () => {
    const directory = sourceKey(subdir('https://github.com/anthropics/claude-plugins-official', 'plugins/frontend-design'), null);
    expect(directory).not.toBeNull();
    expect(sourceKey('./plugins/frontend-design', OFFICIAL)).toBe(directory);
  });

  it('drops the scheme, a trailing slash and .git, and folds the case of a GitHub repository', () => {
    const key = sourceKey(subdir('https://github.com/anthropics/claude-plugins-official', 'plugins/x'), null);
    expect(sourceKey(subdir('https://github.com/anthropics/claude-plugins-official.git', 'plugins/x'), null)).toBe(key);
    expect(sourceKey(subdir('https://GitHub.com/Anthropics/Claude-Plugins-Official/', './plugins/x/'), null)).toBe(key);
    expect(sourceKey(subdir('git@github.com:anthropics/claude-plugins-official.git', 'plugins/x'), null)).toBe(key);
    expect(sourceKey({ kind: 'url', url: 'https://github.com/anthropics/claude-plugins-official.git', repo: null, path: 'plugins/x' }, null)).toBe(key);
    expect(sourceKey({ kind: 'github', url: null, repo: 'anthropics/claude-plugins-official', path: 'plugins/x' }, null)).toBe(key);
    expect(sourceKey('./plugins/x', { source: 'git', locator: 'https://github.com/anthropics/claude-plugins-official.git' })).toBe(key);
  });

  it('normalises as the engine’s URL reading does: the default HTTPS port, unreserved percent escapes', () => {
    const key = sourceKey(subdir('https://github.com/anthropics/claude-plugins-official', 'plugins/x'), null);
    expect(sourceKey(subdir('https://github.com:443/anthropics/claude-plugins-official', 'plugins/x'), null)).toBe(key);
    expect(sourceKey(subdir('https://github.com/%61nthropics/claude-plugins-official', 'plugins/x'), null)).toBe(key);
    expect(sourceKey(subdir('https://user@github.com/anthropics/claude-plugins-official', 'plugins/x'), null)).toBe(key);
    expect(sourceKey(subdir('https://www.github.com/anthropics/claude-plugins-official', 'plugins/x'), null)).toBe(key);
    // another port is another place, and keeps the path's case
    expect(sourceKey(subdir('https://github.com:8443/anthropics/claude-plugins-official', 'plugins/x'), null)).toBe('github.com:8443/anthropics/claude-plugins-official#plugins/x');
  });

  it('refuses what the engine refuses: a reserved escape, an escaped dot segment, ssh.github.com over https, a ref that pins a branch', () => {
    expect(sourceKey(subdir('https://github.com/a%2Fb/c', 'p'), null)).toBeNull();
    expect(sourceKey(subdir('https://github.com/a/%2e%2e/c', 'p'), null)).toBeNull();
    expect(sourceKey(subdir('https://ssh.github.com/a/b', 'p'), null)).toBeNull();
    expect(sourceKey(subdir('https://github.com/a/b', 'p\\q'), null)).toBeNull();
    expect(sourceKey({ ...subdir('https://github.com/a/b', 'p'), ref: 'main' }, null)).toBeNull();
    expect(sourceKey({ ...subdir('https://github.com/a/b', 'p'), ref: null }, null)).toBe('github.com/a/b#p');
    expect(sourceKey({ ...subdir('https://github.com/a/b', 'p'), ref: 'f'.repeat(40) }, null)).toBe('github.com/a/b#p');
  });

  it('keeps apart what is not the same code', () => {
    const key = sourceKey(subdir('https://github.com/anthropics/claude-plugins-official', 'plugins/x'), null);
    expect(sourceKey(subdir('https://github.com/anthropics/claude-plugins-official', 'plugins/y'), null)).not.toBe(key);
    expect(sourceKey(subdir('https://github.com/someone/claude-plugins-official', 'plugins/x'), null)).not.toBe(key);
    expect(sourceKey(subdir('https://github.com/anthropics/claude-plugins-official', null), null)).not.toBe(key);
    // a host other than GitHub keeps its path's case
    expect(sourceKey(subdir('https://git.example.com/A/B', 'p'), null)).not.toBe(sourceKey(subdir('https://git.example.com/a/b', 'p'), null));
  });

  it('answers no key when nothing names a repository: no fold', () => {
    expect(sourceKey(null, null)).toBeNull();
    expect(sourceKey('./plugins/x', null)).toBeNull(); // a relative entry with no marketplace to resolve against
    expect(sourceKey('./plugins/x', { source: 'directory', locator: '/Users/me/market' })).toBeNull();
    expect(sourceKey({ kind: 'npm', url: null, repo: null, path: null }, null)).toBeNull();
    expect(sourceKey(subdir('not a url', 'p'), null)).toBeNull();
    expect(sourceKey(subdir('http://github.com/a/b', 'p'), null)).toBeNull(); // the engine keys https only
    expect(sourceKey(subdir('https://github.com/a/b', '../../escape'), null)).toBeNull();
  });
});

describe('isAnthropicDefaultMarketplace', () => {
  it('is the marketplace whose repository is anthropics/claude-plugins-official, by repo or GitHub URL', () => {
    expect(isAnthropicDefaultMarketplace(OFFICIAL)).toBe(true);
    expect(isAnthropicDefaultMarketplace({ source: 'git', locator: 'https://github.com/anthropics/claude-plugins-official' })).toBe(true);
    expect(isAnthropicDefaultMarketplace({ source: 'git', locator: 'https://github.com/Anthropics/claude-plugins-official.git/' })).toBe(true);
  });

  it('is no other marketplace: the community one, a fork of the same name, a folder, an unnamed one', () => {
    expect(isAnthropicDefaultMarketplace({ source: 'github', locator: 'anthropics/claude-plugins-community' })).toBe(false);
    expect(isAnthropicDefaultMarketplace({ source: 'github', locator: 'someone/claude-plugins-official' })).toBe(false);
    expect(isAnthropicDefaultMarketplace({ source: 'directory', locator: '/tmp/claude-plugins-official' })).toBe(false);
    expect(isAnthropicDefaultMarketplace({ source: 'claudeai', locator: null })).toBe(false);
  });
});
