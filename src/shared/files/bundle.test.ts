// The app bundle a process runs from (UX wave U6e, decision 8): the outermost `*.app` among its executable's ancestors.
import { describe, expect, it } from 'vitest';
import { bundleOf } from './bundle';

describe('bundleOf', () => {
  it('answers the outermost folder named *.app above the executable, through nested bundles', () => {
    expect(bundleOf('/Applications/MAWS.app/Contents/MacOS/MAWS')).toBe('/Applications/MAWS.app');
    expect(bundleOf('/Applications/MAWS.app/Contents/Frameworks/MAWS Helper.app/Contents/MacOS/MAWS Helper')).toBe('/Applications/MAWS.app');
    expect(bundleOf('/work/build/mac-arm64/MAWS Dev.app/Contents/MacOS/MAWS Dev')).toBe('/work/build/mac-arm64/MAWS Dev.app');
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
