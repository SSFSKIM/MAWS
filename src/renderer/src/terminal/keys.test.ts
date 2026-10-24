import { describe, expect, it } from 'vitest';
import { terminalKeyFilter } from './keys';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('terminal key filter', () => {
  it.each([
    ['⌘K', { key: 'k', code: 'KeyK', metaKey: true }],
    ['⌘1', { key: '1', code: 'Digit1', metaKey: true }],
    ['⌘W', { key: 'w', code: 'KeyW', metaKey: true }],
    ['⌘⇧J', { key: 'J', code: 'KeyJ', metaKey: true, shiftKey: true }],
    ['⌘⇧C (not the copy chord)', { key: 'C', code: 'KeyC', metaKey: true, shiftKey: true }],
    ['⌘ alone', { key: 'Meta', code: 'MetaLeft', metaKey: true }],
  ])('gives %s to the app', (_name, init) => {
    expect(terminalKeyFilter(key(init))).toBe('app');
  });

  it('yields region keys to the app, including effective function-key overrides', () => {
    expect(terminalKeyFilter(key({ key: 'F6', code: 'F6' }))).toBe('app');
    expect(terminalKeyFilter(key({ key: 'F6', code: 'F6', shiftKey: true }))).toBe('app');
    const overrides = { 'region.focusNext': 'F8', 'region.focusPrevious': null } as const;
    expect(terminalKeyFilter(key({ key: 'F8', code: 'F8' }), overrides)).toBe('app');
    expect(terminalKeyFilter(key({ key: 'F6', code: 'F6' }), overrides)).toBe('pty');
    expect(terminalKeyFilter(key({ key: 'F6', code: 'F6', shiftKey: true }), overrides)).toBe('pty');
  });

  it('yields rebound application navigation, but leaves unbound and editor-scoped keys in the terminal', () => {
    expect(terminalKeyFilter(key({ key: 'F9', code: 'F9' }), { 'tab.stripNext': 'F9' })).toBe('app');
    expect(terminalKeyFilter(key({ key: 'F9', code: 'F9' }), { 'tab.stripNext': null })).toBe('pty');
    expect(terminalKeyFilter(key({ key: 'Tab', code: 'Tab', shiftKey: true }))).toBe('pty');
    expect(terminalKeyFilter(key({ key: 'c', code: 'KeyC', metaKey: true }), { 'sidebar.focus': 'Cmd+C' })).toBe('pty');
  });

  it('keeps the tab cycle: ⌃Tab is tab.next and ⌃⇧Tab is tab.previous', () => {
    expect(terminalKeyFilter(key({ key: 'Tab', code: 'Tab', ctrlKey: true }))).toBe('tab.next');
    expect(terminalKeyFilter(key({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }))).toBe('tab.previous');
  });

  it('honors moved and unbound existing tab-cycle bindings instead of reserving Ctrl+Tab', () => {
    const overrides = { 'tab.next': 'F8', 'tab.previous': null } as const;
    expect(terminalKeyFilter(key({ key: 'F8', code: 'F8' }), overrides)).toBe('tab.next');
    expect(terminalKeyFilter(key({ key: 'Tab', code: 'Tab', ctrlKey: true }), overrides)).toBe('pty');
    expect(terminalKeyFilter(key({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }), overrides)).toBe('pty');
    expect(terminalKeyFilter(key({ key: 'p', code: 'KeyP', metaKey: true, altKey: true }), { 'tab.previous': 'Cmd+Alt+P' })).toBe('tab.previous');
    expect(terminalKeyFilter(key({ key: 'c', code: 'KeyC', metaKey: true }), { 'tab.next': 'Cmd+C' })).toBe('pty');
  });

  it.each([
    ['Esc', { key: 'Escape', code: 'Escape' }],
    ['Enter', { key: 'Enter', code: 'Enter' }],
    ['Tab', { key: 'Tab', code: 'Tab' }],
    ['⇧Tab', { key: 'Tab', code: 'Tab', shiftKey: true }],
    ['⌃C', { key: 'c', code: 'KeyC', ctrlKey: true }],
    ['⌃D', { key: 'd', code: 'KeyD', ctrlKey: true }],
    ['⌃L', { key: 'l', code: 'KeyL', ctrlKey: true }],
    ['⌃R', { key: 'r', code: 'KeyR', ctrlKey: true }],
    ['⌥←', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }],
    ['↑', { key: 'ArrowUp', code: 'ArrowUp' }],
    ['⌘C', { key: 'c', code: 'KeyC', metaKey: true }],
    ['⌘V', { key: 'v', code: 'KeyV', metaKey: true }],
    ['⌘A', { key: 'a', code: 'KeyA', metaKey: true }],
    // A non-Latin layout (the owner's Korean 2-set) reports the layout's character; the chord is the key's position.
    ['⌘C under the Korean layout', { key: 'ㅊ', code: 'KeyC', metaKey: true }],
    ['a composing IME key', { key: 'Process', code: 'KeyG', isComposing: true }],
  ])('sends %s to the pty', (_name, init) => {
    expect(terminalKeyFilter(key(init))).toBe('pty');
  });
});
