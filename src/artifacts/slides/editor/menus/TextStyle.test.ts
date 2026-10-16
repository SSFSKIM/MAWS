// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D10, the Text style menu): a text element set in one of
// the system's type roles takes the role's variables, D's layouts' form, and reads back as that role.
import { describe, expect, it } from 'vitest';
import { parseTokens } from '../../../design-system/tokens';
import { defaultSystem, HOUSE_KEY } from '../../../types/design_system/defaults';
import { newDoc, onUpdate, transact } from '../../../yjs';
import { importSlide, readSlide, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { applyTextStyle, roleFamily, roleOfStyle, roleStyle } from './TextStyle';

const house = parseTokens(JSON.parse(defaultSystem(HOUSE_KEY)!.files['tokens.tokens.json']!)).tokens!;

describe('the text style roles', () => {
  it('writes a role as its family, size, line height and weight variables', () => {
    expect(roleStyle('h1', house)).toEqual({
      'font-family': 'var(--ds-font-display)',
      'font-size': 'var(--ds-type-h1-size)',
      'line-height': 'var(--ds-type-h1-line)',
      'font-weight': 'var(--ds-type-h1-weight)',
    });
    expect(roleStyle('caption', house)['font-family']).toBe('var(--ds-font-body)');
  });

  it('takes the family the system’s role names, else the layouts’ convention', () => {
    expect(roleFamily('quote', house)).toBe('var(--ds-font-body)');
    expect(roleFamily('subtitle', null)).toBe('var(--ds-font-display)');
    expect(roleFamily('body', null)).toBe('var(--ds-font-body)');
  });

  it('reads a style back as its role by its size variable, else none', () => {
    expect(roleOfStyle(roleStyle('h2', house))).toBe('h2');
    expect(roleOfStyle({ 'font-size': 'var(--ds-type-quote-size)' })).toBe('quote');
    expect(roleOfStyle({ 'font-size': '44px' })).toBeNull();
    expect(roleOfStyle({})).toBeNull();
  });

  it('applies a role to every selected text element in one transaction, refusing what is not text', () => {
    const doc = newDoc();
    const loaded = loadSlide(`<section id="s"><h2 id="a" style="font-size:40px">A</h2><p id="b">B</p><div id="box" style="width:100px; height:100px; background:#eeeeee"></div></section>`, { fileId: 's' });
    if (!loaded.ok) throw new Error('fixture');
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
      importSlide(doc, loaded.slide, 'a0');
    });
    let updates = 0;
    onUpdate(doc, () => updates++);
    expect(applyTextStyle(doc, 's', ['a', 'b'], 'title', house, 'me')).toEqual([]);
    expect(updates).toBe(1);
    const [a, b] = readSlide(doc, 's').children;
    expect(a!.style['font-size']).toBe('var(--ds-type-title-size)');
    expect(b!.style['font-weight']).toBe('var(--ds-type-title-weight)');
    expect(applyTextStyle(doc, 's', ['a', 'box'], 'body', house, 'me')).toEqual([expect.stringContaining('box')]);
    expect(readSlide(doc, 's').children[0]!.style['font-size']).toBe('var(--ds-type-title-size)');
  });
});
