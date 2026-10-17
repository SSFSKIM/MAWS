// P3-E2 M2 fix wave (parent Decision Log 16): telling a held legacy dashboard (generic files, no tab) from today's.
import { describe, expect, it } from 'vitest';
import { createDocument } from '../document/tabs';
import { newDoc } from '../yjs';
import { legacyDashboardFiles } from './legacy';

describe('legacyDashboardFiles', () => {
  it('names the files of a dashboard that has files and no tab, and nothing otherwise', () => {
    const legacy = newDoc();
    legacy.get('files').setAttr('view.json', '{}');
    legacy.get('files').setAttr('data/a.csv', 'a\n1\n');
    expect(legacyDashboardFiles(legacy)).toEqual(['data/a.csv', 'view.json']);
    const today = newDoc();
    createDocument(today, { title: 'Board' });
    expect(legacyDashboardFiles(today)).toBeNull();
    expect(legacyDashboardFiles(newDoc())).toBeNull(); // empty: nothing held
    today.get('files').setAttr('stray.txt', 'x'); // a tab makes it today's, whatever else it holds
    expect(legacyDashboardFiles(today)).toBeNull();
  });
});
