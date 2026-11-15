// The one image of a plugin, a skill, a connector or a built-in mod (UX wave U11c M1,
// docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C; the child's O-14): every row and card of Customize
// and of the session's `/plugins` and `/skills` draws it. The letter tile at once; the directory's icon in the same box
// once main answers it as image data (`catalog.icon`, through the catalog egress rule: the window fetches nothing,
// Decision Log 7(b)). The box is fixed per size, so a row does not move when an icon arrives.
import { useCatalogIcon } from '../discover/read';
import { tileOf, type ItemKind, type TileColour } from './tile';

// Decision Log 10: an icon is only ever an <img> of image data (never inline SVG, innerHTML or <object>), the one SVG
// context in which a script runs nothing and an external reference loads nothing; any other answer keeps the tile.
const IMAGE_DATA = /^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

// Each place keeps the box it had: a row's 36px, a card's 40px; a detail and Discover's Featured, 56px.
const BOX = { row: 'size-9 rounded-md text-ui', card: 'size-10 rounded-md text-ui', detail: 'size-14 rounded-lg text-prose' } as const;

// The eight pairs written out whole, so the stylesheet holds each class (Tailwind sees only a class whose name is written).
const TILE: Record<TileColour, string> = {
  1: 'bg-author-1/15 text-author-1',
  2: 'bg-author-2/15 text-author-2',
  3: 'bg-author-3/15 text-author-3',
  4: 'bg-author-4/15 text-author-4',
  5: 'bg-author-5/15 text-author-5',
  6: 'bg-author-6/15 text-author-6',
  7: 'bg-author-7/15 text-author-7',
  8: 'bg-author-8/15 text-author-8',
};

type Props = { kind: ItemKind; seed: string; iconUrl: string | null; size: keyof typeof BOX };

// An item with no directory icon reads nothing, so a skill's or a mod's row needs no query of its own.
export function ItemImage({ iconUrl, ...box }: Props) {
  return iconUrl === null ? <Box {...box} data={null} /> : <WithIcon {...box} iconUrl={iconUrl} />;
}

function WithIcon({ iconUrl, ...box }: Omit<Props, 'iconUrl'> & { iconUrl: string }) {
  const icon = useCatalogIcon(iconUrl);
  return <Box {...box} data={icon.data && IMAGE_DATA.test(icon.data) ? icon.data : null} />;
}

// One box, the tile's or the icon's: an icon that arrives fills the box the tile held.
function Box({ kind, seed, size, data }: Omit<Props, 'iconUrl'> & { data: string | null }) {
  const tile = tileOf(kind, seed);
  return (
    <span
      aria-hidden
      data-item-image={data ? 'icon' : 'tile'}
      data-item-kind={kind}
      data-tile-colour={data ? undefined : tile.colour}
      className={`flex ${BOX[size]} shrink-0 items-center justify-center overflow-hidden font-medium ${data ? 'border border-border bg-bg' : TILE[tile.colour]}`}
    >
      {data ? <img src={data} alt="" className="size-full object-contain" draggable={false} /> : tile.letter}
    </span>
  );
}
