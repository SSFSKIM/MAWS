// The app bundle a process runs from (UX wave U6e, decision 8): the outermost `*.app` among its executable's ancestors.
import { describe, expect, it } from 'vitest';
import { bundleOf, isBundleName } from './bundle';

describe('bundleOf', () => {
  it('answers the outermost folder named *.app above the executable, through nested bundles', () => {
    expect(bundleOf('/Applications/MAWS.app/Contents/MacOS/MAWS')).toBe('/Applications/MAWS.app');
    expect(bundleOf('/Applications/MAWS.app/Contents/Frameworks/MAWS Helper.app/Contents/MacOS/MAWS Helper')).toBe('/Applications/MAWS.app');
    expect(bundleOf('/work/build/mac-arm64/MAWS Dev.app/Contents/MacOS/MAWS Dev')).toBe('/work/build/mac-arm64/MAWS Dev.app');
  });

  // The panel's finding 1: the default Mac volume ignores case, so a bundle's suffix is read in any case
  it('reads the suffix in any case: MAWS.APP and Maws.App are bundles', () => {
    expect(bundleOf('/Applications/MAWS.APP/Contents/MacOS/MAWS')).toBe('/Applications/MAWS.APP');
    expect(bundleOf('/work/Maws.App/Contents/Frameworks/Helper.APP/Contents/MacOS/Helper')).toBe('/work/Maws.App');
    expect(['MAWS.app', 'MAWS.APP', 'Maws.App', 'x.aPp'].map(isBundleName)).toEqual([true, true, true, true]);
    expect(['.app', '.APP', 'app', 'MAWS.apps', 'MAWS.application', 'MAWS'].map(isBundleName)).toEqual([false, false, false, false, false, false]);
  });

  it('answers null with none, for a relative path, and for a name that only contains .app', () => {
    expect(bundleOf('/usr/local/bin/node')).toBeNull();
    expect(bundleOf('/work/apps/node')).toBeNull();
    expect(bundleOf('/work/my.application/bin/node')).toBeNull();
    expect(bundleOf('/work/.app/bin/node')).toBeNull(); // a folder named only `.app` is no bundle
    expect(bundleOf('MAWS.app/Contents/MacOS/MAWS')).toBeNull();
    expect(bundleOf('/Applications/MAWS.app')).toBeNull(); // the path itself is the executable, not its folder
  });
});
