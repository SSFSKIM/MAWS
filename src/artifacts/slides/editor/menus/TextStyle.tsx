// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10 "the Text style menu"; M6): the toolbar's Text style
// menu sets the selected text elements in one of the design system's eight type roles, as D's layouts write them: the
// family the role names (`var(--ds-font-display|body)`) and the role's size, line height and weight variables
// (`var(--ds-type-<role>-{size,line,weight})`), so the text follows the system and its overrides by reference. One
// gesture, one transaction, every value checked by the dialect first; the menu marks the role the selection is set in.
import { DropdownMenu } from 'radix-ui';
import { useCallback, useSyncExternalStore } from 'react';
import { TYPE_ROLES, type TypeRole } from '../../../design-system/roles';
import type { TokenSet } from '../../../design-system/tokens';
import { onUpdate, type Doc } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { TEXT_TAGS, type Style, type Tag } from '../../ir';
import { checkStyle } from '../../css';
import { setStyles, siteOf } from '../../writers-elements';
import { TEXT_STYLE_COPY as C } from './copy';
import './menus.css';
import type { DeckSession } from '../session';

export const ROLE_LABELS: Record<TypeRole, string> = { title: 'Title', subtitle: 'Subtitle', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', body: 'Body', caption: 'Caption', quote: 'Quote' };

// D's layouts set the title, subtitle and headings in the display face and the rest in the body face.
const DISPLAY_ROLES: ReadonlySet<TypeRole> = new Set(['title', 'subtitle', 'h1', 'h2', 'h3']);

/** The family a role is set in: the font token the system's role names (`{font.<name>}`), else the layouts' convention. */
export function roleFamily(role: TypeRole, tokens: TokenSet | null): string {
  const value = tokens?.tokens.get(`type.${role}`)?.$value as { fontFamily?: unknown } | undefined;
  const ref = typeof value?.fontFamily === 'string' ? /^\{font\.([A-Za-z0-9_-]+)\}$/.exec(value.fontFamily)?.[1] : undefined;
  return `var(--ds-font-${ref ?? (DISPLAY_ROLES.has(role) ? 'display' : 'body')})`;
}

/** A role's declarations, D's layouts' form. */
export function roleStyle(role: TypeRole, tokens: TokenSet | null): Style {
  return {
    'font-family': roleFamily(role, tokens),
    'font-size': `var(--ds-type-${role}-size)`,
    'line-height': `var(--ds-type-${role}-line)`,
    'font-weight': `var(--ds-type-${role}-weight)`,
  };
}

/** The role a style is set in, read by its size variable; null for any other size. */
export function roleOfStyle(style: Readonly<Style>): TypeRole | null {
  const m = /^var\(--ds-type-([a-z0-9]+)-size\)$/.exec(style['font-size']?.trim() ?? '');
  return m && (TYPE_ROLES as readonly string[]).includes(m[1]!) ? (m[1] as TypeRole) : null;
}

const isText = (doc: Doc, slideId: string, id: string) => Y.hasElement(doc, slideId, id) && TEXT_TAGS.has(Y.elementScalars(doc, slideId, id).tag as Tag);

/**
 * Sets the elements in `role` in one transaction. Answers the reasons it refused (an element that is not text, a value
 * the dialect would drop); when there is any, nothing is written.
 */
export function applyTextStyle(doc: Doc, slideId: string, ids: readonly string[], role: TypeRole, tokens: TokenSet | null, origin?: unknown): string[] {
  const notText = ids.filter((id) => !isText(doc, slideId, id));
  if (notText.length) return notText.map((id) => C.notText(id));
  const props = roleStyle(role, tokens);
  const reasons: string[] = [];
  const writes: Record<string, Record<string, string>> = {};
  for (const id of ids) {
    const { site, style } = siteOf(doc, slideId, id);
    const next = { ...style, ...props };
    writes[id] = {};
    for (const [k, v] of Object.entries(props)) {
      const checked = checkStyle(k, v, { ...site, attrs: site.attrs }, next);
      if (checked.ok) writes[id][k] = checked.value;
      else reasons.push(checked.reason);
    }
  }
  if (reasons.length) return reasons;
  setStyles(doc, slideId, writes, origin);
  return [];
}

export interface TextStyleMenuProps {
  session: DeckSession;
  slideId: string | null;
  /** The governing system's tokens (each role's family); null while it loads. */
  tokens: TokenSet | null;
  readOnly: boolean;
  onNotice: (text: string) => void;
}

/**
 * What the menu shows for the selection: `off` (nothing selected, or not all text), `mixed` (text in several roles or
 * none), else the role. A string read through useSyncExternalStore on the replica's updates and the session's, so the
 * label follows an edit from anywhere (and a memoizing compiler never keeps a stale one).
 */
function shownRole(session: DeckSession, slideId: string | null, readOnly: boolean): TypeRole | 'off' | 'mixed' {
  const { selection } = session.snapshot();
  const doc = session.doc;
  if (readOnly || slideId === null || selection.length === 0 || !selection.every((id) => isText(doc, slideId, id))) return 'off';
  const roles = new Set(selection.map((id) => roleOfStyle(styleOf(doc, slideId, id))));
  return roles.size === 1 ? ([...roles][0] ?? 'mixed') : 'mixed';
}

/** The toolbar's Text style menu: enabled while the selection is text. */
export function TextStyleMenu({ session, slideId, tokens, readOnly, onNotice }: TextStyleMenuProps) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const offDoc = onUpdate(session.doc, listener);
      const offSession = session.subscribe(listener);
      return () => {
        offDoc();
        offSession();
      };
    },
    [session],
  );
  const shown = useSyncExternalStore(subscribe, () => shownRole(session, slideId, readOnly));
  const usable = shown !== 'off';
  const current = usable && shown !== 'mixed' ? shown : null;
  const apply = (role: TypeRole) => {
    const selection = session.snapshot().selection;
    if (!usable || slideId === null) return;
    let reasons: string[] = [];
    session.edit((origin) => (reasons = applyTextStyle(session.doc, slideId, selection, role, tokens, origin)));
    if (reasons.length) onNotice(reasons.join('; '));
  };
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="deck-button deck-text-style" disabled={!usable} aria-label={C.menu} title={C.menu}>
          {current ? ROLE_LABELS[current] : C.menu}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className="deck-menu" aria-label={C.menu}>
          <DropdownMenu.RadioGroup value={current ?? ''} onValueChange={(value) => apply(value as TypeRole)}>
            {TYPE_ROLES.map((role) => (
              <DropdownMenu.RadioItem key={role} value={role} className="deck-menu-item deck-text-style-item" data-role={role}>
                <span className="deck-menu-check" aria-hidden>
                  {current === role ? '✓' : ''}
                </span>
                {ROLE_LABELS[role]}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function styleOf(doc: Doc, slideId: string, id: string): Style {
  const style: Style = {};
  for (const [k, v] of Object.entries(Y.elementScalars(doc, slideId, id))) if (k.startsWith('style:')) style[k.slice(6)] = v as string;
  return style;
}
