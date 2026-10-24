// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Insert"; M5): the toolbar's Insert menu: a text
// box, a heading, a bulleted and a numbered list, the shape kinds, an icon (the thirty names), an image (uploaded through
// the ArtifactHost), a table (rows × columns), a line and a connector. What it makes is writers-elements.ts's
// `newElement`, loaded through the dialect; where it goes is the editor's.
// Final fix wave (B4): the image's upload is the session's awaited edit (`later`): the tab's close waits for it, and it
// is placed only if the deck still takes writes when the upload is done.
import { preserveSubmenuPointer } from '../../../ui/menu-pointer';
import { DropdownMenu } from 'radix-ui';
import { useRef } from 'react';
import { ICON_GLYPHS } from '../../glyphs';
import { ICON_NAMES } from '../../parse';
import type { NewKind } from '../../writers-elements';
import { DECK_COPY as C } from '../copy';
import type { DeckSession } from '../session';

const SHAPES = ['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line'] as const;
const TABLES: readonly [number, number][] = [
  [2, 2],
  [2, 3],
  [3, 3],
  [3, 4],
  [4, 4],
  [5, 3],
  [6, 4],
];

export interface InsertMenuProps {
  session: DeckSession;
  disabled: boolean;
  onInsert: (kind: NewKind) => void;
  /** Uploads a picked image and answers its `assets/<name>` ref; without it the menu has no Image item. */
  uploadAsset?: (file: File) => Promise<string>;
  onNotice?: (text: string) => void;
}

export function InsertMenu({ session, disabled, onInsert, uploadAsset, onNotice }: InsertMenuProps) {
  const file = useRef<HTMLInputElement>(null);
  const item = (kind: NewKind, label: string) => (
    <DropdownMenu.Item className="deck-menu-item" onSelect={() => onInsert(kind)}>
      {label}
    </DropdownMenu.Item>
  );
  const onFile = async () => {
    const picked = file.current?.files?.[0];
    if (file.current) file.current.value = '';
    if (!picked || !uploadAsset) return;
    onNotice?.(C.uploading);
    try {
      const placed = await session.later(uploadAsset(picked), (ref) => onInsert(`image:${ref}`));
      onNotice?.(placed ? '' : C.uploadNotPlaced);
    } catch (e) {
      onNotice?.(C.uploadFailed(e instanceof Error ? e.message : String(e)));
    }
  };
  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="deck-button" disabled={disabled} aria-label={C.insert}>
            {C.insert}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="deck-menu">
            {item('text', C.insertText)}
            {item('heading', C.insertHeading)}
            {item('bullets', C.insertBullets)}
            {item('numbers', C.insertNumbers)}
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} className="deck-menu-item">{C.insertShape} ›</DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className="deck-menu" sideOffset={2}>
                  {SHAPES.map((kind) => (
                    <DropdownMenu.Item key={kind} className="deck-menu-item" onSelect={() => onInsert(`shape:${kind}`)}>
                      {C.shapeName(kind)}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} className="deck-menu-item">{C.insertIcon} ›</DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className="deck-menu deck-icon-grid" sideOffset={2}>
                  {ICON_NAMES.map((name) => (
                    <DropdownMenu.Item key={name} className="deck-menu-item deck-icon-item" aria-label={name} title={name} onSelect={() => onInsert(`icon:${name}`)}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d={ICON_GLYPHS[name] ?? ''} />
                      </svg>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            {uploadAsset && (
              <DropdownMenu.Item className="deck-menu-item" onSelect={() => file.current?.click()}>
                {C.insertImage}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} className="deck-menu-item">{C.insertTable} ›</DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className="deck-menu" sideOffset={2}>
                  {TABLES.map(([rows, cols]) => (
                    <DropdownMenu.Item key={`${rows}x${cols}`} className="deck-menu-item" onSelect={() => onInsert(`table:${rows}x${cols}`)}>
                      {C.tableSize(rows, cols)}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            {item('line', C.insertLine)}
            {item('connector', C.insertConnector)}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {uploadAsset && <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden data-insert-image onChange={() => void onFile()} />}
    </>
  );
}
