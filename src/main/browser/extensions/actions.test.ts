import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Extension, Session } from 'electron';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EXTENSION_ICON_MAX_BYTES } from '@shared/browser/extensions';
import type { EventName } from '@shared/ipc/schema';
import { ExtensionActions, extensionPageUrl, pickIcon, readExtensionIcon, readManifestAction, type ActionRecord } from './actions';

const PROBE = 'nenbjdahllkkbfanbpfmmdacjencdfpg';
const OTHER = 'ofmpefonpiifpjlopbcacdiahhnegimn';
const PART = 'persist:maws-chrome-Default';

describe('readManifestAction', () => {
  it('reads an MV3 action: its title, icon, popup, and the options page', () => {
    expect(
      readManifestAction({
        manifest_version: 3,
        action: { default_title: 'MAWS probe', default_icon: { 16: 'i16.png', 32: 'i32.png', 48: 'i48.png' }, default_popup: 'popup.html' },
        options_ui: { page: 'options.html', open_in_tab: false },
      }),
    ).toEqual({ title: 'MAWS probe', icon: 'i32.png', popup: 'popup.html', options: 'options.html' });
  });

  it('reads an MV2 browser_action and options_page', () => {
    expect(readManifestAction({ manifest_version: 2, browser_action: { default_title: 'Old', default_icon: 'icon.png', default_popup: 'p.html' }, options_page: 'o.html' })).toEqual({
      title: 'Old',
      icon: 'icon.png',
      popup: 'p.html',
      options: 'o.html',
    });
  });

  it('falls back to the extension icons, and leaves absent fields null', () => {
    expect(readManifestAction({ manifest_version: 3, icons: { 128: 'big.png', 48: 'mid.png' } })).toEqual({ title: null, icon: 'mid.png', popup: null, options: null });
    expect(readManifestAction({ action: {} })).toEqual({ title: null, icon: null, popup: null, options: null });
    expect(readManifestAction(null)).toEqual({ title: null, icon: null, popup: null, options: null });
  });

  it('ignores malformed and placeholder values', () => {
    expect(readManifestAction({ action: { default_title: '__MSG_title__', default_icon: 7, default_popup: '' }, options_ui: 'x', options_page: ['o'] })).toEqual({
      title: null,
      icon: null,
      popup: null,
      options: null,
    });
    expect(readManifestAction({ action: { default_title: '  ' }, browser_action: { default_title: 'ignored when action is there' } }).title).toBeNull();
  });
});

describe('pickIcon', () => {
  it('takes the largest at or under 32, else the smallest above', () => {
    expect(pickIcon({ 16: 'a', 24: 'b', 32: 'c', 64: 'd' })).toBe('c');
    expect(pickIcon({ 16: 'a', 19: 'b', 38: 'c' })).toBe('b');
    expect(pickIcon({ 48: 'a', 128: 'b' })).toBe('a');
    expect(pickIcon('one.png')).toBe('one.png');
  });

  it('answers null for nothing usable', () => {
    expect(pickIcon(undefined)).toBeNull();
    expect(pickIcon({ big: 'x', 0: 'y', 16: 3 })).toBeNull();
  });
});

describe('extensionPageUrl', () => {
  const base = `chrome-extension://${PROBE}/`;

  it('resolves a page against the extension, a leading slash or a folder included', () => {
    expect(extensionPageUrl(base, 'popup.html')).toBe(`${base}popup.html`);
    expect(extensionPageUrl(`chrome-extension://${PROBE}`, '/ui/popup/index.html?x=1')).toBe(`${base}ui/popup/index.html?x=1`);
  });

  it('keeps the page within the extension: no other origin, scheme or the bare root', () => {
    expect(extensionPageUrl(base, '../../other/popup.html')).toBe(`${base}other/popup.html`); // resolution stops at the root
    expect(extensionPageUrl(base, 'https://example.com/popup.html')).toBeNull();
    expect(extensionPageUrl(base, `chrome-extension://${OTHER}/popup.html`)).toBeNull();
    expect(extensionPageUrl(base, '//evil.test/x')).toBe(`${base}evil.test/x`); // a protocol-relative page is a path here
    expect(extensionPageUrl(base, '/')).toBeNull();
    expect(extensionPageUrl(base, null)).toBeNull();
  });
});

describe('readExtensionIcon', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'maws-actions-'));
    mkdirSync(join(root, 'icons'));
    writeFileSync(join(root, 'icons', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(root, 'big.png'), Buffer.alloc(EXTENSION_ICON_MAX_BYTES + 1));
    writeFileSync(join(root, 'note.txt'), 'hi');
    writeFileSync(join(root, '..', 'outside.png'), 'x');
    symlinkSync(join(root, 'icons', 'a.png'), join(root, 'link.png'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(join(root, '..', 'outside.png'), { force: true });
  });

  it('reads an image under the folder as a data URL of its type', async () => {
    expect(await readExtensionIcon(root, 'icons/a.png')).toBe('data:image/png;base64,iVBORw==');
    expect(await readExtensionIcon(root, '/icons/a.png')).toBe('data:image/png;base64,iVBORw==');
  });

  it('refuses a file outside the folder, through a symlink, over the cap, missing or of another type', async () => {
    expect(await readExtensionIcon(root, '../outside.png')).toBeNull();
    expect(await readExtensionIcon(root, 'link.png')).toBeNull();
    expect(await readExtensionIcon(root, 'big.png')).toBeNull();
    expect(await readExtensionIcon(root, 'gone.png')).toBeNull();
    expect(await readExtensionIcon(root, 'note.txt')).toBeNull();
  });
});

// ---- the list ----------------------------------------------------------------------------------------------------------

function extension(id: string, manifest: Record<string, unknown>): Extension {
  return { id, name: String(manifest.name ?? id), version: '1', manifest, path: `/ext/${id}`, url: `chrome-extension://${id}/` } as Extension;
}

function fakeSession(loaded: Extension[]) {
  const emitter = new EventEmitter();
  const byId = new Map(loaded.map((ext) => [ext.id, ext]));
  const extensions = Object.assign(emitter, {
    getExtension: (id: string) => byId.get(id) ?? null,
    load(ext: Extension) {
      byId.set(ext.id, ext);
      emitter.emit('extension-loaded', {}, ext);
    },
    unload(id: string) {
      const ext = byId.get(id)!;
      byId.delete(id);
      emitter.emit('extension-unloaded', {}, ext);
    },
  });
  return { extensions } as unknown as Pick<Session, 'extensions'> & { extensions: typeof extensions };
}

function harness(records: ActionRecord[]) {
  const events: { name: EventName; payload: unknown }[] = [];
  const readIcon = vi.fn(async (path: string, icon: string) => `data:image/png;base64,${Buffer.from(`${path}|${icon}`).toString('base64')}`);
  const actions = new ExtensionActions({ records: () => records, emit: (name, payload) => void events.push({ name, payload }), readIcon });
  return { actions, events, readIcon };
}

const probe = extension(PROBE, { name: 'MAWS probe extension', action: { default_title: 'MAWS probe', default_popup: 'popup.html' }, options_ui: { page: 'options.html' } });
const plain = extension(OTHER, { name: 'Plain', icons: { 16: 'p16.png' } });

describe('ExtensionActions', () => {
  const records: ActionRecord[] = [
    {
      partition: PART,
      extensions: [
        { id: OTHER, name: 'Plain (Settings)' },
        { id: PROBE, name: 'MAWS probe extension' },
        { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Off' }, // not loaded: not listed
      ],
    },
  ];

  it('lists the loaded extensions in Settings\' order, with the record\'s names, the title, the icon and the pages', async () => {
    const { actions } = harness(records);
    actions.attach(fakeSession([probe, plain]), PART);
    expect(await actions.list(PART)).toEqual([
      { extensionId: OTHER, name: 'Plain (Settings)', title: 'Plain (Settings)', icon: `data:image/png;base64,${Buffer.from('/ext/' + OTHER + '|p16.png').toString('base64')}`, hasPopup: false, hasOptions: false },
      { extensionId: PROBE, name: 'MAWS probe extension', title: 'MAWS probe', icon: null, hasPopup: true, hasOptions: true },
    ]);
    expect(actions.find(PART, PROBE)).toMatchObject({ popupUrl: `chrome-extension://${PROBE}/popup.html`, optionsUrl: `chrome-extension://${PROBE}/options.html` });
    expect(actions.find(PART, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeNull();
    expect(actions.entries(PART).map((action) => action.extensionId)).toEqual([OTHER, PROBE]);
    expect(await actions.icon(PART, OTHER)).toBe(`data:image/png;base64,${Buffer.from('/ext/' + OTHER + '|p16.png').toString('base64')}`);
    expect(await actions.icon(PART, PROBE)).toBeNull();
  });

  it('finds an extension loaded under Chrome\'s directory id', async () => {
    const { actions } = harness([{ partition: PART, extensions: [{ id: 'cccccccccccccccccccccccccccccccc', chromeId: PROBE, name: 'Probe' }] }]);
    actions.attach(fakeSession([probe]), PART);
    expect((await actions.list(PART)).map((action) => action.extensionId)).toEqual([PROBE]);
  });

  it('lists nothing for a partition never prepared, one without a record, or a failing icon read', async () => {
    const { actions, readIcon } = harness(records);
    expect(await actions.list(PART)).toEqual([]);
    actions.attach(fakeSession([plain]), 'persist:maws-chrome-Work');
    expect(await actions.list('persist:maws-chrome-Work')).toEqual([]);
    readIcon.mockRejectedValueOnce(new Error('EIO'));
    actions.attach(fakeSession([plain]), PART);
    expect((await actions.list(PART))[0]!.icon).toBeNull();
  });

  it('raises changed on every load and unload, and tells an unload to its listeners first', async () => {
    const { actions, events } = harness(records);
    const ses = fakeSession([probe]);
    actions.attach(ses, PART);
    actions.attach(ses, PART); // a second preparation watches once
    const unloads: string[] = [];
    actions.onUnloaded((partition, id) => unloads.push(`${partition} ${id} at ${events.length}`));
    ses.extensions.load(plain);
    expect(events).toEqual([{ name: 'browser.extensions.actions.changed', payload: { partition: PART } }]);
    expect((await actions.list(PART)).map((action) => action.extensionId)).toEqual([OTHER, PROBE]);
    ses.extensions.unload(PROBE);
    expect(unloads).toEqual([`${PART} ${PROBE} at 1`]);
    expect(events).toHaveLength(2);
    expect((await actions.list(PART)).map((action) => action.extensionId)).toEqual([OTHER]);
    actions.dispose();
    ses.extensions.load(probe);
    expect(events).toHaveLength(2);
  });

  it('never throws from the preparation', () => {
    const { actions } = harness(records);
    expect(() => actions.attach({ get extensions(): never { throw new Error('gone'); } } as unknown as Pick<Session, 'extensions'>, PART)).not.toThrow();
  });
});
