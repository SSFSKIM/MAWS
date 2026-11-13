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

  it('a search field takes it while it holds text, and is a field to leave when it is empty', () => {
    const host = html('<input data-escape-clears value="voice" />');
    const field = host.querySelector('input')!;
    expect(escapeTaker(field)).toBe('own');
    field.value = '';
    expect(escapeTaker(field)).toBe('field');
  });

  it('a text field, a textarea and editable content are fields; a checkbox, a button and a plain element are not', () => {
    const host = html('<input /><input type="number" /><textarea></textarea><div contenteditable="true"></div><input type="checkbox" /><button>Go</button><p>text</p>');
    const [text, number, area, editable, box, button, plain] = [...host.children] as HTMLElement[];
    expect([text, number, area, editable].map(escapeTaker)).toEqual(['field', 'field', 'field', 'field']);
    expect([box, button, plain, null, window].map(escapeTaker)).toEqual([null, null, null, null, null]);
  });
});
