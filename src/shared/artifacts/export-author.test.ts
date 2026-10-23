import { describe, expect, it } from 'vitest';
import { resolveExportHumanName, routedAccountName } from './export-author';

const accounts = [{ uuid: 'other', displayName: 'Other person' }, { uuid: 'routed', displayName: '  Kim Min  ' }];

describe('export author identity', () => {
  it('prefers the explicit export name, otherwise the routed account name, otherwise a neutral label', () => {
    expect(resolveExportHumanName('  K. Min  ', 'Kim Min')).toBe('K. Min');
    expect(resolveExportHumanName(null, '  Kim Min  ')).toBe('Kim Min');
    expect(resolveExportHumanName(undefined, null)).toBe('Comment author');
    expect(resolveExportHumanName(null, ' ')).toBe('Comment author');
  });

  it('suggests only the routed Claude account’s display name, not another account or a login identifier', () => {
    expect(routedAccountName({ available: true, drainTarget: 'routed', accounts })).toBe('Kim Min');
    expect(routedAccountName({ available: false, drainTarget: 'routed', accounts })).toBeNull();
    expect(routedAccountName({ available: true, drainTarget: null, accounts })).toBeNull();
    expect(routedAccountName({ available: true, drainTarget: 'routed', accounts: [{ uuid: 'routed', displayName: '' }] })).toBeNull();
    expect(routedAccountName(null)).toBeNull();
  });
});
