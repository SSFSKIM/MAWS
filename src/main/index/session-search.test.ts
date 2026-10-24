import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Index } from './index';
import { summary, tempDir } from '../../../test/support/index-fixture';
const dir = tempDir();
const index = new Index(join(dir.path, 'index.sqlite'));
afterEach(() => { index.close(); dir.dispose(); });
describe('conversation search', () => {
  it('ranks titles before text, updates snippets, searches literals and forgets deleted sessions', () => {
    const first = index.sessions.upsertFromSummary(summary({ customTitle: 'Deployment notes' })).record;
    const second = index.sessions.upsertFromSummary(summary({ customTitle: 'needle in title' })).record;
    index.sessionSearch.replace(first.appId, first.engineSessionId!, 100, 1000, 'We found the needle in the build. 회의에서 논의한 내용');
    index.sessionSearch.replace(second.appId, second.engineSessionId!, 100, 1000, 'Something else');
    expect(index.sessionSearch.search('needle').map((r) => r.appSessionId)).toEqual([second.appId, first.appId]);
    expect(index.sessionSearch.search('needle')[1].snippet).toContain('needle in the build');
    expect(index.sessionSearch.search('회의')[0].appSessionId).toBe(first.appId);
    expect(index.sessionSearch.search('" OR "')).toEqual([]);
    index.sessionSearch.replace(first.appId, first.engineSessionId!, 200, 2000, 'Different words');
    expect(index.sessionSearch.search('needle')).toHaveLength(1);
    index.sessions.update(second.appId, { archived: true });
    expect(index.sessionSearch.search('needle')).toEqual([]);
  });
});
