import { describe, expect, it } from 'vitest';
import { pathOf, placeOf } from './route';

// T20: the page reads its path and nothing else of its address.
describe('placeOf', () => {
  it('reads / as the overview and /s/<session> as that session’s sheet', () => {
    expect(placeOf('/')).toEqual({ at: 'overview' });
    expect(placeOf('/s/5eed0000-0000-4000-8000-000000000019')).toEqual({ at: 'sheet', session: '5eed0000-0000-4000-8000-000000000019' });
  });

  it('decodes the session once, and keeps a segment that does not decode as it came', () => {
    expect(placeOf('/s/a%20b')).toEqual({ at: 'sheet', session: 'a b' });
    expect(placeOf('/s/a%252Fb')).toEqual({ at: 'sheet', session: 'a%2Fb' });
    expect(placeOf('/s/%E0%A4%A')).toEqual({ at: 'sheet', session: '%E0%A4%A' });
  });

  it('takes a path that names no session as the overview, and /s/ as a sheet that names none', () => {
    expect(placeOf('/anything')).toEqual({ at: 'overview' });
    expect(placeOf('')).toEqual({ at: 'overview' });
    expect(placeOf('/s/')).toEqual({ at: 'sheet', session: '' });
  });

  it('is given the path alone: a query or a fragment never reaches it', () => {
    // what the page hands it is location.pathname; a string that carries more names a session that holds it, and nothing
    // of it is read as a parameter
    expect(placeOf(new URL('http://sheet.localhost:47590/?code=K7QF-2M9D#x').pathname)).toEqual({ at: 'overview' });
    expect(placeOf(new URL('http://sheet.localhost:47590/s/abc?code=K7QF-2M9D#pair').pathname)).toEqual({ at: 'sheet', session: 'abc' });
  });
});

describe('pathOf', () => {
  it('writes a place back as the path that reads as it', () => {
    for (const place of [{ at: 'overview' } as const, { at: 'sheet', session: 'abc' } as const, { at: 'sheet', session: 'a b/c' } as const]) expect(placeOf(pathOf(place))).toEqual(place);
  });
});
