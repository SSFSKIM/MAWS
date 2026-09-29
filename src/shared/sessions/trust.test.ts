import { describe, expect, it } from 'vitest';
import { isHomeDirectory, normalizePath } from './trust';

describe('home directory', () => {
  it('compares NFC paths without a trailing separator', () => {
    expect(isHomeDirectory('/Users/new', '/Users/new')).toBe(true);
    expect(isHomeDirectory('/Users/new/', '/Users/new')).toBe(true);
    expect(isHomeDirectory('/Users/café', '/Users/café')).toBe(true); // NFD spelling of the same name
    expect(isHomeDirectory('/Users/new/src', '/Users/new')).toBe(false);
    expect(normalizePath('/')).toBe('/');
  });
});
