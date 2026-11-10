// `maws project`'s words (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §K): the lines an add, a link
// and a remove print, on this machine and through the app on another; the refusals of a request aimed elsewhere; and the
// exit code each refusal is.
import { describe, expect, it } from 'vitest';
import { actRefusal, addWords, canonicalPath, exitOf, linkWords, NO_WINDOW, NOT_CONFIRMED, notRunningHere, notSignedIn, runThere } from './maws-words';

const ID = '0f6c7b1e-0000-4000-8000-000000000001';
const OTHER = '0f6c7b1e-0000-4000-8000-000000000002';
const row = (smnsId: string | null, name = 'scrape', directory = '/srv/scrape') => ({ id: 'p1', name, directory, org: { name: 'scrape', smnsId } });
const names = (id: string) => (id === OTHER ? 'tools' : null);

describe("maws project add's words", () => {
  it('a folder minted at itself is a new project, by its name', () => {
    expect(addWords({ project: row(ID, 'Scrape'), by: 'minted', at: '/srv/scrape', restated: true }, { enrolled: true, nameOf: names })).toBe('added Scrape as a new project (0f6c7b1e-0000-4000-8000-000000000001)');
  });
  it('a folder inside another project, or linked, is a location of that project, named by the registry', () => {
    expect(addWords({ project: row(OTHER), by: 'minted', at: '/srv', restated: true }, { enrolled: true, nameOf: names })).toBe(`added /srv/scrape as a location of tools (${OTHER})`);
    expect(addWords({ project: row(OTHER), by: 'link', at: '/srv/scrape', restated: true }, { enrolled: true, nameOf: names })).toBe(`added /srv/scrape as a location of tools (${OTHER})`);
    expect(addWords({ project: row(ID), by: 'remote', at: null, restated: true }, { enrolled: true, nameOf: names }), 'no registry name: the label').toBe(`added /srv/scrape as a location of scrape (${ID})`);
  });
  it('a folder the rule leaves in the machine project stays under the machine, also with no answer of how it was decided', () => {
    expect(addWords({ project: row(null), by: 'machine', at: null, restated: true }, { enrolled: true, nameOf: names })).toBe('added /srv/scrape; it stays under this machine until sminos here is updated');
    expect(addWords({ project: row(null) }, { enrolled: true, nameOf: names })).toBe('added /srv/scrape; it stays under this machine until sminos here is updated');
    expect(addWords({ project: row(null) }, { enrolled: true, nameOf: names, machine: 'mini' }), 'on another machine').toBe('added /srv/scrape; it stays under mini until sminos there is updated');
  });
  it('says when sminos has not confirmed, and on a machine that is not enrolled says so', () => {
    expect(addWords({ project: row(ID), by: 'minted', at: '/srv/scrape', restated: false }, { enrolled: true, nameOf: names })).toBe(`added scrape as a new project (${ID})\nsminos has not confirmed yet; a session started now may be filed under this machine for a moment`);
    expect(addWords({ project: row(ID), by: 'minted', at: '/srv/scrape', restated: false }, { enrolled: true, nameOf: names, machine: 'mini' })).toBe(`added scrape as a new project (${ID})\nsminos has not confirmed yet; a session started now may be filed under mini for a moment`);
    expect(addWords({ project: row(null) }, { enrolled: false, nameOf: names })).toBe('added /srv/scrape; this machine is not enrolled, so it is a project of this machine only');
  });
});

describe("maws project link's words", () => {
  it('names the project a link puts the folder in, and the one an unlink leaves it in', () => {
    expect(linkWords({ project: row(OTHER), restated: true }, { into: OTHER, nameOf: names })).toBe(`linked /srv/scrape into tools (${OTHER})`);
    expect(linkWords({ project: row(ID), restated: false }, { into: null, nameOf: names })).toBe(`unlinked /srv/scrape; its project is scrape (${ID})\nsminos has not confirmed yet; a session started now may be filed under this machine for a moment`);
    expect(linkWords({ project: row(null), restated: true }, { into: null, nameOf: names })).toBe('unlinked /srv/scrape; it is under this machine');
  });
});

describe('a request aimed at another machine', () => {
  it('names the command to run there', () => {
    expect(runThere({ verb: 'add', path: '/srv/scrape' })).toBe('maws project add /srv/scrape');
    expect(runThere({ verb: 'add', path: '/srv/my scrape', into: ID, name: "Bob's" })).toBe(`maws project add '/srv/my scrape' --into ${ID} --name 'Bob'\\''s'`);
    expect(runThere({ verb: 'add', path: '/srv/scrape', own: true })).toBe('maws project add /srv/scrape --new');
    expect(runThere({ verb: 'link', path: '/srv/scrape', into: null })).toBe('maws project link /srv/scrape --none');
    expect(runThere({ verb: 'remove', path: '/srv/scrape' })).toBe('maws project remove /srv/scrape');
  });
  it('is refused, in §K words, with no app, signed out, with no window and when not confirmed', () => {
    const asked = { verb: 'add', machine: 'mini', path: '/srv/scrape' } as const;
    expect(notRunningHere(asked)).toBe('MAWS is not running on this machine, so it cannot ask mini. Run this on mini: maws project add /srv/scrape');
    expect(notSignedIn(asked)).toBe('MAWS is not signed in on this Mac, so it cannot ask mini. Run this on mini: maws project add /srv/scrape');
    expect(NO_WINDOW).toBe('MAWS has no window open to confirm this. Open MAWS and run the command again.');
    expect(NOT_CONFIRMED).toBe('Not confirmed in MAWS.');
  });
  it('exits 2 for what is not available here, 1 for a refusal', () => {
    for (const code of ['no-app', 'signed-out', 'no-window']) expect([code, exitOf(code)]).toEqual([code, 2]);
    for (const code of ['declined', 'unknown-project', 'host_unavailable']) expect([code, exitOf(code)]).toEqual([code, 1]);
  });
});

describe('a refusal of a project act', () => {
  it('takes the code its words start with, from the machine or through lane B, else the error code', () => {
    expect(actRefusal({ code: 'invalid_input', message: 'unknown-project: abc is in no verified projects record' })).toEqual({ ok: false, code: 'unknown-project', text: 'unknown-project: abc is in no verified projects record' });
    expect(actRefusal({ code: 'internal', message: 'session.projects.link: refused not-offered by machine mini', issues: { refusal: 'not-offered' } })).toEqual({ ok: false, code: 'not-offered', text: 'session.projects.link: refused not-offered by machine mini' });
    expect(actRefusal({ code: 'host_unavailable', message: 'Not sent: mini is offline' })).toEqual({ ok: false, code: 'host_unavailable', text: 'Not sent: mini is offline' });
  });
});

// review 1's minor finding: another machine's path in the one spelling its rows hold
describe("another machine's path", () => {
  it('drops empty and dot segments and a trailing separator, takes `..` back, and is NFC', () => {
    expect(['/srv/new/', '/srv//new', '/srv/./old/../new', '/srv/new/.'].map(canonicalPath)).toEqual(['/srv/new', '/srv/new', '/srv/new', '/srv/new']);
    expect([canonicalPath('/'), canonicalPath('/..'), canonicalPath('/srv/cafe\u0301')]).toEqual(['/', '/', '/srv/caf\u00e9']);
  });
});
