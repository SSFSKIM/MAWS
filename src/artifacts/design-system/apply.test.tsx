// D8 (M4): the apply-and-restyle API over a fake `ArtifactHost` whose replicas are real docs through the binding module.
// The scope's style follows a live system and is shared by every consumer of one (system, medium, overrides); a
// version ref is read once and never followed; overrides land after the system; the floor needs no store.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle } from '../host';
import { DEFAULT_SYSTEMS, HOUSE_KEY } from '../types/design_system/defaults';
import { newDoc, stateV2, type Doc } from '../yjs';
import {
  DesignSystemHostContext,
  DesignSystemMissing,
  DesignSystemScope,
  governingSystem,
  openDesignSystem,
  resolveDsVars,
  useDesignSystem,
  type DesignSystemRef,
  type DesignSystemView,
} from './apply';
import complete from './fixtures/complete.tokens.json';
import { setToken, writeSystem } from './model';
import { holdScopeStyle, scopeIdOf } from './scope-style';
import { liveView } from './view';
import { parseTokens, serializeTokens, type Token } from './tokens';

const AT = Date.UTC(2026, 9, 13);
const TOKENS = serializeTokens(parseTokens(complete).tokens!);
const color = (hex: string): Token => ({ $value: hex });
const FACE = `@font-face { font-family: "Iowan Old Style"; font-weight: 400; src: url("assets/iowan.woff2") format("woff2"); }
@font-face { font-family: "Iowan Old Style"; src: url("https://fonts.example/iowan.woff2"); }
@font-face { font-family: "Not Ours"; src: url("assets/other.woff2"); }
.ds-doc p { color: var(--ds-color-text); }
`;

/** A store of one system per id, opened as replicas that are the store's own docs, synced at once. */
function fakeHost(systems: Record<string, Doc>, versions: Record<string, Uint8Array> = {}) {
  const open = vi.fn(async (id: string): Promise<DocumentHandle> => {
    const doc = systems[id];
    if (!doc) throw new Error(`no artifact ${id}`);
    return {
      doc,
      awareness: null as never,
      state: () => ({ phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false }),
      subscribe: () => () => {},
      onRestored: () => () => {},
      holdRemote: () => {},
      close: closed,
    };
  });
  const closed = vi.fn();
  const versionState = vi.fn(async (id: string, at: number | { seq: number }) => {
    const bytes = versions[`${id}@${typeof at === 'number' ? at : at.seq}`];
    if (!bytes) throw new Error('no such version');
    return bytes;
  });
  const host: ArtifactHost = {
    open,
    assetUrl: (id, ref) => `maws-artifact://${id}/live/${ref}`,
    export: async () => ({ path: '' }),
    versionState,
    attributions: async () => new Uint8Array(),
    acceptSuggestion: async () => ({ revision: 0 }), // P3-D re-merge: A's landed required members
    rejectSuggestion: async () => ({ revision: 0 }),
    uploadAsset: async () => ({ assetId: '', ref: '' }),
    identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '#000000' }),
  };
  return { host, open, closed, versionState };
}

function systemDoc(files: Record<string, string> = {}): Doc {
  const doc = newDoc();
  writeSystem(doc, { 'tokens.tokens.json': TOKENS, ...files }, { route: 'derived', at: AT }, { name: 'Harbor' });
  return doc;
}

const styles = () => [...document.head.querySelectorAll('style[data-ds-scope-style]')] as HTMLStyleElement[];

/** Holds released by the test (each once), or at its end whatever it left held, so a failed assertion leaks no style. */
function releasedAtEnd(): (release: () => void) => () => void {
  const held = new Set<() => void>();
  onTestFinished(() => {
    for (const release of held) release();
    held.clear();
  });
  return (release) => {
    held.add(release);
    return () => {
      if (held.delete(release)) release();
    };
  };
}
const flush = () => act(async () => {});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('governingSystem (D9)', () => {
  const d = { owner: 'owner-ds', spaces: { s1: 'space-ds' }, house: 'house-ds' };
  it('takes the artifact’s own system, then its Space’s, the owner’s, the house system, then the floor', () => {
    expect(governingSystem({ designSystemId: 'own', spaceId: 's1' }, d)).toEqual({ id: 'own' });
    expect(governingSystem({ spaceId: 's1' }, d)).toEqual({ id: 'space-ds' });
    expect(governingSystem({ spaceId: 's2' }, d)).toEqual({ id: 'owner-ds' });
    expect(governingSystem({}, { ...d, owner: null })).toEqual({ id: 'house-ds' });
    expect(governingSystem({}, { owner: null, spaces: {}, house: null })).toEqual({ builtin: 'maws' });
    expect(governingSystem({ spaceId: 'toString' }, { owner: null, spaces: {}, house: null })).toEqual({ builtin: 'maws' });
  });
  it('skips a deleted or missing id down the chain', () => {
    const live = (id: string) => id !== 'space-ds' && id !== 'own';
    expect(governingSystem({ designSystemId: 'own', spaceId: 's1' }, d, live)).toEqual({ id: 'owner-ds' });
    expect(governingSystem({}, { owner: 'gone', spaces: {}, house: 'gone-too' }, () => false)).toEqual({ builtin: 'maws' });
  });
});

describe('openDesignSystem (D8)', () => {
  it('follows a live system: its tokens change and its listeners fire with every change, until closed', async () => {
    const doc = systemDoc();
    const { host, closed } = fakeHost({ a: doc });
    const view = await openDesignSystem(host, { id: 'a' });
    expect(view.name).toBe('Harbor');
    const heard = vi.fn();
    view.subscribe(heard);
    setToken(doc, 'color.accent.$root', color('#123456'));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(view.css(':root', 'document')).toContain('--ds-color-accent: #123456');
    view.close();
    setToken(doc, 'color.accent.$root', color('#654321'));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('reads a version ref once from the pinned state and never opens or follows the live system', async () => {
    const doc = systemDoc();
    const pinned = stateV2(doc);
    setToken(doc, 'color.accent.$root', color('#123456'));
    const { host, open, versionState } = fakeHost({ a: doc }, { 'a@7': pinned });
    const view = await openDesignSystem(host, { id: 'a', versionSeq: 7 });
    expect(versionState).toHaveBeenCalledWith('a', { seq: 7 });
    expect(open).not.toHaveBeenCalled();
    const heard = vi.fn();
    view.subscribe(heard);
    setToken(doc, 'color.accent.$root', color('#abcdef'));
    expect(heard).not.toHaveBeenCalled();
    expect(view.css(':root', 'document')).toContain('--ds-color-accent: #c9663f'); // the fixture's, as pinned
  });

  it('renders the floor from the bundled house system with no store', async () => {
    const { host, open } = fakeHost({});
    const view = await openDesignSystem(host, { builtin: 'maws' });
    const house = DEFAULT_SYSTEMS.find((system) => system.key === HOUSE_KEY)!;
    expect(view.name).toBe(house.name);
    expect(view.css(':root', 'document')).toContain('--ds-color-accent:');
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects a system that is not there', async () => {
    const { host } = fakeHost({ empty: newDoc() });
    await expect(openDesignSystem(host, { id: 'nope' })).rejects.toBeInstanceOf(DesignSystemMissing);
    await expect(openDesignSystem(host, { id: 'empty' })).rejects.toBeInstanceOf(DesignSystemMissing);
    await expect(openDesignSystem(host, { id: 'nope', versionSeq: 3 })).rejects.toBeInstanceOf(DesignSystemMissing);
  });

  it('declares the system’s own faces, loaded from its assets, and no face that fetches elsewhere or names another family', async () => {
    const doc = systemDoc({ 'components/document.css': FACE });
    const { host } = fakeHost({ a: doc });
    const css = (await openDesignSystem(host, { id: 'a' })).css('[data-ds-scope="x"]', 'document');
    const faces = css.match(/@font-face \{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(1);
    const alias = /font-family: (ds-face-[a-z0-9]+);/.exec(faces[0]!)?.[1];
    expect(alias).toBeDefined(); // the face under a name private to this system (fix wave 1, I5)
    expect(css).toContain(`--ds-font-display: ${alias}, "Iowan Old Style", Georgia, serif;`);
    expect(faces[0]).toContain('font-weight: 400;');
    expect(faces[0]).toMatch(/src: url\("maws-artifact\\3a \/\/a\/live\/assets\/iowan\.woff2"\) format\("woff2"\);/);
    expect(css).not.toContain('fonts.example');
    expect(css).not.toContain('Not Ours');
  });

  // A's Decision Log 46: a deleted system's assets are served at a named revision while a version pins it, never live
  it('loads a version ref’s faces at the pinned revision, so a retained version keeps them after the system is deleted', async () => {
    const doc = systemDoc({ 'components/document.css': FACE });
    const { host } = fakeHost({ a: doc }, { 'a@7': stateV2(doc) });
    const css = (await openDesignSystem(host, { id: 'a', versionSeq: 7 })).css('[data-ds-scope="x"]', 'document');
    const faces = css.match(/@font-face \{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatch(/src: url\("maws-artifact\\3a \/\/a\/7\/assets\/iowan\.woff2"\) format\("woff2"\);/);
    expect(css).not.toContain('/live/');
  });
});

describe('<DesignSystemScope> (D8)', () => {
  function Shown({ refs, overrides }: { refs: (DesignSystemRef | { builtin: 'maws' })[]; overrides?: Record<string, string> }) {
    return (
      <>
        {refs.map((ref, i) => (
          <DesignSystemScope key={i} system={ref} medium="document" overrides={overrides} className="consumer">
            <p style={{ color: 'var(--ds-color-accent)' }}>text</p>
          </DesignSystemScope>
        ))}
      </>
    );
  }

  it('shares one style among the consumers of a live system, rewrites it when a token changes, and removes it with the last', async () => {
    const doc = systemDoc();
    const { host, open, closed } = fakeHost({ a: doc });
    const view = render(
      <DesignSystemHostContext.Provider value={host}>
        <Shown refs={[{ id: 'a' }, { id: 'a' }]} />
      </DesignSystemHostContext.Provider>,
    );
    await flush();
    const scopes = [...view.container.querySelectorAll('[data-ds-scope]')];
    expect(scopes).toHaveLength(2);
    expect(scopes[0]!.getAttribute('data-ds-scope')).toBe(scopes[1]!.getAttribute('data-ds-scope'));
    expect(styles()).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(1);
    const p = view.container.querySelector('p')!;
    expect(getComputedStyle(p).color).toBe('#c9663f');
    act(() => setToken(doc, 'color.accent.$root', color('#123456')));
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #123456');
    expect(getComputedStyle(p).color).toBe('#123456');
    view.unmount();
    await flush();
    expect(styles()).toHaveLength(0);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('applies overrides after the system, in a scope of their own; unsafe ones are dropped', async () => {
    const doc = systemDoc();
    const { host } = fakeHost({ a: doc });
    const overrides = { '--ds-color-accent': '#ff0000', '--ds-color-bg': 'red} body { display: none', color: 'blue' };
    const view = render(
      <DesignSystemHostContext.Provider value={host}>
        <Shown refs={[{ id: 'a' }]} overrides={overrides} />
        <Shown refs={[{ id: 'a' }]} />
      </DesignSystemHostContext.Provider>,
    );
    await flush();
    const [withOverrides, plain] = [...view.container.querySelectorAll('p')];
    expect(getComputedStyle(withOverrides!).color).toBe('#ff0000');
    expect(getComputedStyle(plain!).color).toBe('#c9663f');
    expect(styles()).toHaveLength(2);
    const text = styles().map((s) => s.textContent).find((t) => t!.includes('#ff0000'))!;
    expect(text.lastIndexOf('--ds-color-accent: #ff0000')).toBeGreaterThan(text.indexOf('--ds-color-accent: #c9663f'));
    expect(text).not.toContain('display: none');
  });

  it('never follows a version ref', async () => {
    const doc = systemDoc();
    const { host, open } = fakeHost({ a: doc }, { 'a@2': stateV2(doc) });
    const view = render(
      <DesignSystemHostContext.Provider value={host}>
        <Shown refs={[{ id: 'a', versionSeq: 2 }]} />
      </DesignSystemHostContext.Provider>,
    );
    await flush();
    act(() => setToken(doc, 'color.accent.$root', color('#123456')));
    expect(getComputedStyle(view.container.querySelector('p')!).color).toBe('#c9663f');
    expect(open).not.toHaveBeenCalled();
  });

  it('renders the floor without a host, and a plain div with no system', async () => {
    const view = render(
      <>
        <Shown refs={[{ builtin: 'maws' }]} />
        <DesignSystemScope system={null} medium="document" className="none">
          <span />
        </DesignSystemScope>
      </>,
    );
    await flush();
    expect(styles()).toHaveLength(1);
    expect(view.container.querySelector('.none')!.hasAttribute('data-ds-scope')).toBe(false);
  });
});

describe('useDesignSystem (D8)', () => {
  it('loads, is ready with a snapshot that changes with the system, and is missing for a system not there', async () => {
    const doc = systemDoc();
    const { host } = fakeHost({ a: doc });
    const seen: { status: string; view: DesignSystemView | null }[] = [];
    function Probe({ id }: { id: string }) {
      const result = useDesignSystem({ id });
      seen.push(result);
      return <span>{result.view ? result.view.css(':root', 'document').match(/--ds-color-accent: (#\w+)/)![1] : result.status}</span>;
    }
    const view = render(
      <DesignSystemHostContext.Provider value={host}>
        <Probe id="a" />
      </DesignSystemHostContext.Provider>,
    );
    expect(view.container.textContent).toBe('loading');
    await flush();
    expect(view.container.textContent).toBe('#c9663f');
    const first = seen.at(-1)!.view;
    act(() => setToken(doc, 'color.accent.$root', color('#123456')));
    expect(view.container.textContent).toBe('#123456');
    expect(seen.at(-1)!.view).not.toBe(first);
    view.rerender(
      <DesignSystemHostContext.Provider value={host}>
        <Probe id="gone" />
      </DesignSystemHostContext.Provider>,
    );
    await flush();
    expect(view.container.textContent).toBe('missing');
  });
});

describe('resolveDsVars (the export helper)', () => {
  const tokens = parseTokens(complete).tokens!;
  it('writes each --ds-* reference as its value at the medium’s scale, fallbacks resolved, other variables kept', () => {
    expect(resolveDsVars('h1 { color: var(--ds-color-accent); font-size: var( --ds-type-title-size ); }', tokens, 'deck')).toBe('h1 { color: #c9663f; font-size: 96px; }');
    expect(resolveDsVars('p { color: var(--ds-nope, var(--ds-color-text)); }', tokens, 'document')).toBe('p { color: #1f1e1b; }');
    expect(resolveDsVars('p { color: var(--ds-nope); margin: var(--x, var(--ds-space-2)); }', tokens, 'document')).toBe('p { color: var(--ds-nope); margin: var(--x, 8px); }');
    expect(resolveDsVars('@page { size: var(--ds-page-width) var(--ds-page-height); }', tokens, 'document')).toBe('@page { size: 8.5in 11in; }');
  });

  it('takes a consumer’s overrides after the system’s values, as its scope does (Decision Log 25)', () => {
    const overrides = { '--ds-color-accent': '#123456', '--ds-brand-x': '3px', '--ds-color-text': 'red; }' /* unsafe: dropped */ };
    expect(resolveDsVars('p { color: var(--ds-color-accent); border: var(--ds-brand-x) solid var(--ds-color-text); }', tokens, 'deck', overrides)).toBe('p { color: #123456; border: 3px solid #1f1e1b; }');
    expect(resolveDsVars('p { color: var(--ds-nope, var(--ds-color-accent)); }', tokens, 'document', overrides)).toBe('p { color: #123456; }');
  });

  // M6 fix wave 1, I1 (the review's probe): an override is resolved against the system's values with the overrides on
  // top, following chains, so the output is literal; one in a cycle or with a reference that resolves to nothing is
  // dropped, and its name keeps the system's value.
  it('resolves references inside an override to literals, through chains and fallbacks', () => {
    const css = 'p { color: var(--ds-color-accent); }';
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--ds-color-text)' })).toBe('p { color: #1f1e1b; }');
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--ds-brand)', '--ds-brand': 'var(--ds-color-status-ok)' })).toBe('p { color: #1f8f55; }');
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--ds-nope, var(--ds-color-text))' })).toBe('p { color: #1f1e1b; }');
    expect(resolveDsVars('p { box-shadow: var(--ds-x); }', tokens, 'document', { '--ds-x': '0 1px 2px var(--ds-color-text)' })).toBe('p { box-shadow: 0 1px 2px #1f1e1b; }');
    // an override referring to another override sees the override, not the system's value
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--ds-color-text)', '--ds-color-text': '#010203' })).toBe('p { color: #010203; }');
  });

  it('drops an override in a cycle or with an unresolvable reference, and the name keeps the system’s value', () => {
    const css = 'p { color: var(--ds-color-accent); border-color: var(--ds-color-border); }';
    const plain = resolveDsVars(css, tokens, 'document');
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--ds-color-border)', '--ds-color-border': 'var(--ds-color-accent)' })).toBe(plain);
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--ds-color-accent)' })).toBe(plain);
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--brand)' })).toBe(plain);
    expect(resolveDsVars(css, tokens, 'document', { '--ds-color-accent': 'var(--ds-nope)' })).toBe(plain);
    // a reference to a dropped override reads the system's value
    expect(resolveDsVars('p { color: var(--ds-x); }', tokens, 'document', { '--ds-x': 'var(--ds-color-accent)', '--ds-color-accent': 'var(--brand)' })).toBe('p { color: #c9663f; }');
  });

  // M6 fix wave 2: the override walk has neither of the Office walk's former limits: a token a group's `$extends` brings
  // in is a value like any other, and a chain of overrides is followed to its end, however long.
  it('resolves an override through an inherited token, and a chain of overrides of any length', () => {
    const file = structuredClone(complete) as Record<string, unknown>;
    file.brand = { $type: 'color', link: { $value: '{color.accent.$root}' } };
    file.adopted = { $extends: '{brand}' };
    const withInherited = parseTokens(file).tokens!;
    expect(resolveDsVars('p { color: var(--ds-x); }', withInherited, 'document', { '--ds-x': 'var(--ds-adopted-link)' })).toBe('p { color: #c9663f; }');
    const chain = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`--ds-c${i}`, i === 199 ? 'var(--ds-color-text)' : `var(--ds-c${i + 1})`]));
    expect(resolveDsVars('p { color: var(--ds-c0); }', tokens, 'document', chain)).toBe('p { color: #1f1e1b; }');
  });
});

describe('lifetimes (fix wave 1)', () => {
  const toUrl = (ref: string) => `maws-artifact://a/live/${ref}`;

  it('I2: a live view read again after a quiet spell with no listener is current', () => {
    const doc = systemDoc();
    const view = liveView(doc, toUrl);
    const stop = view.subscribe(() => {});
    expect(view.css(':root', 'document')).toContain('--ds-color-accent: #c9663f');
    stop();
    setToken(doc, 'color.accent.$root', color('#123456'));
    expect(view.css(':root', 'document')).toContain('--ds-color-accent: #123456');
    view.close();
    setToken(doc, 'color.accent.$root', color('#654321')); // closed: no longer observed, nothing breaks
  });

  it('I3: when the holder whose replica a shared style follows lets go, the style follows the survivor’s replica', () => {
    const first = systemDoc();
    const second = systemDoc();
    const [a, b] = [liveView(first, toUrl), liveView(second, toUrl)];
    const id = scopeIdOf('page:a', 'document', undefined);
    const tracked = releasedAtEnd();
    const releaseA = tracked(holdScopeStyle(id, 'document', undefined, () => ({ view: a, release: () => a.close() })));
    const releaseB = tracked(holdScopeStyle(id, 'document', undefined, () => ({ view: b, release: () => b.close() })));
    releaseA();
    first.destroy();
    setToken(second, 'color.accent.$root', color('#123456'));
    expect(styles()).toHaveLength(1);
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #123456');
    releaseB();
    expect(styles()).toHaveLength(0);
  });

  it('I3: two replicas of one system shown at once: an edit on either restyles the shared style in its own update', () => {
    const first = systemDoc();
    const second = systemDoc(); // independent replicas, nothing syncing them (one disconnected)
    const [a, b] = [liveView(first, toUrl), liveView(second, toUrl)];
    const id = scopeIdOf('page:a', 'document', undefined);
    const tracked = releasedAtEnd();
    const releaseA = tracked(holdScopeStyle(id, 'document', undefined, () => ({ view: a, release: () => a.close() })));
    const releaseA2 = tracked(holdScopeStyle(id, 'document', undefined, () => ({ view: a, release: () => {} }))); // a second hold of one view
    const releaseB = tracked(holdScopeStyle(id, 'document', undefined, () => ({ view: b, release: () => b.close() })));
    setToken(second, 'color.accent.$root', color('#123456'));
    expect(styles()).toHaveLength(1);
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #123456');
    setToken(first, 'color.accent.$root', color('#654321'));
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #654321');
    releaseA2(); // one of a's holds: a is still observed
    setToken(first, 'color.accent.$root', color('#111111'));
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #111111');
    releaseA(); // a's last hold: the style is rewritten from b, and b alone is observed
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #123456');
    setToken(first, 'color.accent.$root', color('#222222'));
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #123456');
    setToken(second, 'color.accent.$root', color('#333333'));
    expect(styles()[0]!.textContent).toContain('--ds-color-accent: #333333');
    releaseB();
    expect(styles()).toHaveLength(0);
  });

  it('I7: the last scope of a system still loading, gone before it syncs, closes the handle and drops its sync listener', async () => {
    const doc = systemDoc();
    const listeners = new Set<unknown>();
    const close = vi.fn();
    const handle: DocumentHandle = {
      doc,
      awareness: null as never,
      state: () => ({ phase: 'handshake', synced: false, unsaved: 0, revision: 0, readOnly: false }),
      subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
      onRestored: () => () => {},
      holdRemote: () => {},
      close,
    };
    const { host } = fakeHost({});
    host.open = async () => handle;
    const view = render(
      <DesignSystemHostContext.Provider value={host}>
        <DesignSystemScope system={{ id: 'a' }} medium="document">
          <p>text</p>
        </DesignSystemScope>
      </DesignSystemHostContext.Provider>,
    );
    await flush();
    expect(listeners.size).toBe(1); // waiting for the first sync
    view.unmount();
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(styles()).toHaveLength(0);
  });

  it('I7: a handle that arrives after the last scope went is closed at once', async () => {
    let arrive!: (handle: DocumentHandle) => void;
    const close = vi.fn();
    const { host } = fakeHost({});
    host.open = () => new Promise<DocumentHandle>((resolve) => (arrive = resolve));
    const view = render(
      <DesignSystemHostContext.Provider value={host}>
        <DesignSystemScope system={{ id: 'a' }} medium="document">
          <p>text</p>
        </DesignSystemScope>
      </DesignSystemHostContext.Provider>,
    );
    view.unmount();
    await act(async () => arrive({ doc: systemDoc(), awareness: null as never, state: () => ({ phase: 'handshake', synced: false, unsaved: 0, revision: 0, readOnly: false }), subscribe: () => () => {}, onRestored: () => () => {}, holdRemote: () => {}, close }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('the view’s origin (M6b: the ask sheet’s rows)', () => {
  it('a live view, a version view and a hook’s snapshot carry how the system came to exist; the floor has none', async () => {
    const doc = systemDoc();
    const { host } = fakeHost({ a: doc }, { 'a@3': stateV2(systemDoc()) });
    const live = await openDesignSystem(host, { id: 'a' });
    expect(live.origin).toEqual({ route: 'derived', at: AT });
    expect((await openDesignSystem(host, { id: 'a', versionSeq: 3 })).origin).toEqual({ route: 'derived', at: AT });
    expect((await openDesignSystem(host, { builtin: 'maws' })).origin).toBeNull();
    live.close();
    let seen: DesignSystemView | null = null;
    function Probe() {
      seen = useDesignSystem({ id: 'a' }).view;
      return null;
    }
    render(
      <DesignSystemHostContext.Provider value={host}>
        <Probe />
      </DesignSystemHostContext.Provider>,
    );
    await flush();
    expect(seen!.origin).toEqual({ route: 'derived', at: AT });
  });
});
