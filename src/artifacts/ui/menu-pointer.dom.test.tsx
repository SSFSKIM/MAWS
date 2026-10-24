import { afterEach, describe, expect, it } from 'vitest';
import { preserveSubmenuPointer } from './menu-pointer';

function menu() {
  const trigger = document.createElement('button');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', 'formats');
  const submenu = document.createElement('div');
  submenu.id = 'formats';
  const item = document.createElement('button');
  const label = document.createElement('span');
  item.append(label);
  submenu.append(item);
  document.body.append(trigger, submenu);
  return { trigger, submenu, label };
}

function leave(trigger: HTMLElement, relatedTarget: EventTarget | null) {
  const event = new Event('pointerleave', { cancelable: true });
  preserveSubmenuPointer({ currentTarget: trigger, relatedTarget, preventDefault: () => event.preventDefault() });
  return event.defaultPrevented;
}

afterEach(() => { document.body.replaceChildren(); });

describe('a submenu trigger’s logical pointer descendants', () => {
  it('prevents parent-focus dismissal when the pointer enters its open portalled menu or a nested label', () => {
    const { trigger, submenu, label } = menu();
    expect(trigger.contains(submenu)).toBe(false);
    expect(leave(trigger, submenu)).toBe(true);
    expect(leave(trigger, label)).toBe(true);
  });

  it('does not interfere with an unrelated leave, a window leave, or a missing menu', () => {
    const { trigger, submenu } = menu();
    expect(leave(trigger, document.body)).toBe(false);
    expect(leave(trigger, null)).toBe(false);
    expect(leave(trigger, window)).toBe(false);
    submenu.remove();
    expect(leave(trigger, document.body)).toBe(false);
  });

  it('does not preserve a closed menu', () => {
    const { trigger, label } = menu();
    trigger.setAttribute('aria-expanded', 'false');
    expect(leave(trigger, label)).toBe(false);
  });
});
