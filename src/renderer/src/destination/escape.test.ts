// UX wave U7b (Interfaces §H, rows 3 to 5): who takes an Esc inside the Settings dialog or a page.
import { afterEach, describe, expect, it } from 'vitest';
import { escapeTaker } from './escape';

const html = (markup: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);
  return host;
};
afterEach(() => document.body.replaceChildren());

describe('escapeTaker', () => {
  it('the shortcut recorder and an element marked to keep its Esc take it themselves, from inside too', () => {
    const host = html('<div data-chord-capture><span>⌘K</span></div><div data-escape-own><button>Stop all</button></div>');
    expect(escapeTaker(host.querySelector('span'))).toBe('own');
    expect(escapeTaker(host.querySelector('button'))).toBe('own');
  });

  // The wave architect's ruling on the first Mac run: a search field that holds no text is not row 5's field. Settings
  // opens with the keyboard in its empty search, and one Esc closes it, as Esc in an empty search does in the app's
  // other dialogs (WidgetDialog, the resume chooser).
  it('a search field clears itself while it holds text, and gives an Esc to the dialog or the page when it holds none', () => {
    const host = html('<input data-escape-clears value="voice" />');
    const field = host.querySelector('input')!;
    expect(escapeTaker(field)).toBe('own');
    field.value = '';
    expect(escapeTaker(field)).toBe(null);
  });

  it('only a field marked as clearing on Esc: another empty text field, a search input among them, is still left first', () => {
    const host = html('<input type="search" /><input />');
    const [search, text] = [...host.children] as HTMLElement[];
    expect([escapeTaker(search), escapeTaker(text)]).toEqual(['field', 'field']);
  });

  it('an Esc an input method composes with is the field’s own in every field: it ends the composition and nothing else', () => {
    const host = html('<input data-escape-clears value="" /><input data-escape-clears value="voice" /><input /><div contenteditable="true"></div>');
    const fields = [...host.children] as HTMLElement[];
    expect(fields.map((field) => escapeTaker(field, { isComposing: true, keyCode: 27 }))).toEqual(['own', 'own', 'own', 'own']);
    // Chromium's keydown inside a composition carries keyCode 229 whatever its key
    expect(fields.map((field) => escapeTaker(field, { isComposing: false, keyCode: 229 }))).toEqual(['own', 'own', 'own', 'own']);
    expect(fields.map((field) => escapeTaker(field, { isComposing: false, keyCode: 27 }))).toEqual([null, 'own', 'field', 'field']);
  });

  it('a text field, a textarea and editable content are fields; a checkbox, a button and a plain element are not', () => {
    const host = html('<input /><input type="number" /><textarea></textarea><div contenteditable="true"></div><input type="checkbox" /><button>Go</button><p>text</p>');
    const [text, number, area, editable, box, button, plain] = [...host.children] as HTMLElement[];
    expect([text, number, area, editable].map((field) => escapeTaker(field))).toEqual(['field', 'field', 'field', 'field']);
    expect([box, button, plain, null, window].map((target) => escapeTaker(target))).toEqual([null, null, null, null, null]);
  });
});
