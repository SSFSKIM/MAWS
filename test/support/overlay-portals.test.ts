// The fact a prompt's key guard rests on (the UX wave, U1b, the ruling of 2026-11-15 on M4's re-review;
// docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §F): an overlay that takes keys is
// portalled to the body, so the guard (src/renderer/src/request-card/prompt-guard.ts) hears it arrive and close by
// watching the body's own children. So no renderer source gives a Radix Portal a container (or props it cannot read),
// and none portals an element with role menu, dialog or alertdialog into anything but `document.body`. Read with the
// compiler's parser, so a comment or a string never counts.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RENDERER = resolve(__dirname, '../../src/renderer/src');
const OVERLAY_ROLES = new Set(['menu', 'dialog', 'alertdialog']);

function overlayPortalViolations(source: string, file = '<inline>.tsx'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const at = (node: ts.Node, what: string) => found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${what}`);

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === 'Portal' || tag.endsWith('.Portal')) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) at(attribute, `${tag} takes spread props`);
          else if (attribute.name.getText(sf) === 'container') at(attribute, `${tag} is given a container`);
        }
      }
    }
    if (ts.isCallExpression(node) && calls(node, 'createPortal') && node.arguments.length >= 2) {
      const [element, target] = node.arguments;
      const role = overlayRoleIn(element, sf);
      if (role !== null && target.getText(sf).replace(/\s/g, '') !== 'document.body') at(node, `createPortal of role ${role} into ${target.getText(sf)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function calls(call: ts.CallExpression, name: string): boolean {
  const callee = call.expression;
  return (ts.isIdentifier(callee) && callee.text === name) || (ts.isPropertyAccessExpression(callee) && callee.name.text === name);
}

/** The first overlay role written on an element of `node`'s own JSX, at any depth; null when none is. */
function overlayRoleIn(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'role' && node.initializer !== undefined) {
    const value = ts.isStringLiteral(node.initializer)
      ? node.initializer.text
      : ts.isJsxExpression(node.initializer) && node.initializer.expression !== undefined && ts.isStringLiteralLike(node.initializer.expression)
        ? node.initializer.expression.text
        : null;
    if (value !== null && OVERLAY_ROLES.has(value)) return value;
  }
  let role: string | null = null;
  ts.forEachChild(node, (child) => {
    role ??= overlayRoleIn(child, sf);
  });
  return role;
}

function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rendererSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('an overlay that takes keys is portalled to the body', () => {
  it('names a Portal given a container or spread props, and an overlay role portalled elsewhere', () => {
    const source = [
      'const a = <DropdownMenu.Portal container={host}><DropdownMenu.Content /></DropdownMenu.Portal>;',
      'const b = <Portal {...rest} />;',
      'const c = createPortal(<div role="dialog" />, host);',
      'const d = ReactDOM.createPortal(<section><ul role={"menu"} /></section>, pane.element);',
      'const e = createPortal(<div role="alertdialog" />, document.body);',
      'const f = createPortal(<div role="listbox" />, host);',
      'const g = <Popover.Portal><Popover.Content /></Popover.Portal>;',
      '// <Dialog.Portal container={x}>, in a comment',
    ].join('\n');
    expect(overlayPortalViolations(source)).toEqual([
      '<inline>.tsx:1 DropdownMenu.Portal is given a container',
      '<inline>.tsx:2 Portal takes spread props',
      '<inline>.tsx:3 createPortal of role dialog into host',
      '<inline>.tsx:4 createPortal of role menu into pane.element',
    ]);
  });

  it('holds for every renderer source', () => {
    // only a source that names a portal can make one: the parser reads those alone (the tree's other files would cost seconds)
    const sources = rendererSources(RENDERER).map((path) => ({ path, text: readFileSync(path, 'utf8') })).filter(({ text }) => text.includes('Portal'));
    const violations = sources.flatMap(({ path, text }) => overlayPortalViolations(text, relative(RENDERER, path).split(sep).join('/')));
    expect(violations).toEqual([]);
  });
});
