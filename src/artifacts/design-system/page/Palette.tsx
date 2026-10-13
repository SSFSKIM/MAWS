// D14 §1, the palette: each colour role (then the system's other colours) as a swatch drawn in the system, its hex
// field and a colour picker; each edit writes the token in one transaction. Contrast badges for the floor's pairs.
import type { Doc } from '../../yjs';
import { colorFromHex, contrastRatio, rgbToHex, toSrgb, type ColorValue } from '../color';
import type { ResolvedToken, ResolvedTokens } from '../resolve';
import { byIdentity, cssNamesOf, ROLES, tokenIdentity } from '../roles';
import type { TokenSet } from '../tokens';
import { isAlias } from '../values';
import type { DesignSystemView } from '../view';
import { writeToken, writtenToken } from './edit';
import { CommitField } from './fields';
import { PreviewScope } from './PreviewScope';

// The floor the defaults meet (Acceptance 8): body text 4.5 : 1, large text and controls 3 : 1.
export const CONTRAST_PAIRS: readonly { label: string; fg: string; bg: string; min: number }[] = [
  { label: 'Text on ground', fg: 'color.text', bg: 'color.bg', min: 4.5 },
  { label: 'Muted text on ground', fg: 'color.text.muted', bg: 'color.bg', min: 4.5 },
  { label: 'Accent on ground', fg: 'color.accent', bg: 'color.bg', min: 3 },
  { label: 'Text on accent', fg: 'color.accent.text', bg: 'color.accent', min: 3 },
];

const ROLE_COLORS = ROLES.filter((role) => role.type === 'color').map((role) => role.path);
const hexOf = (value: ColorValue) => rgbToHex(toSrgb(value), (value.alpha ?? 1) < 1);

function colorTokens(resolved: ResolvedTokens): Extract<ResolvedToken, { type: 'color' }>[] {
  const roles = ROLE_COLORS.map((path) => byIdentity(resolved.tokens, path)).filter((token): token is ResolvedToken => token?.type === 'color');
  const roleIds = new Set(ROLE_COLORS.map(tokenIdentity));
  const extras = [...resolved.tokens.values()].filter((token) => token.type === 'color' && !token.inherited && !roleIds.has(tokenIdentity(token.path)));
  return [...roles, ...extras] as Extract<ResolvedToken, { type: 'color' }>[];
}

export function Palette(props: { doc: Doc; tokens: TokenSet; resolved: ResolvedTokens; view: DesignSystemView; artifactId: string; readOnly: boolean }) {
  const { doc, tokens, resolved, view, artifactId, readOnly } = props;
  const write = (path: string, next: ColorValue): string | null => {
    const written = writtenToken(tokens, path);
    if (!written) return `${path} is not in the token file`;
    return writeToken(doc, written.path, { ...written.token, $value: next });
  };
  const fromHex = (path: string, text: string, keepAlpha: number | undefined): string | null => {
    const next = colorFromHex(text.startsWith('#') ? text : `#${text}`);
    if (!next) return `“${text}” is not a hex colour (#rrggbb)`;
    if (next.alpha === undefined && keepAlpha !== undefined && keepAlpha < 1) next.alpha = keepAlpha;
    return write(path, next);
  };
  const at = (path: string) => byIdentity(resolved.tokens, path);
  return (
    <section className="dsp-section" data-ds-section="palette" aria-labelledby="dsp-palette">
      <h2 id="dsp-palette" className="dsp-heading">
        Palette
      </h2>
      <PreviewScope view={view} artifactId={artifactId} medium="document" className="dsp-swatches">
        {colorTokens(resolved).map((token) => {
          const name = cssNamesOf(token.path, 'color')[0]!;
          const hex = hexOf(token.value);
          const raw = token.token.$value;
          return (
            <div key={token.path} className="dsp-swatch" data-token={tokenIdentity(token.path)}>
              <div className="dsp-chip" style={{ background: `var(${name})` }} />
              <div className="dsp-swatch-text">
                <code className="dsp-name">{name}</code>
                {isAlias(raw) ? <span className="dsp-alias">= {raw}</span> : null}
                <span className="dsp-swatch-edit">
                  <CommitField label={`${name} hex`} value={hex} disabled={readOnly} width="9ch" commit={(text) => fromHex(token.path, text, token.value.alpha)} />
                  <input
                    type="color"
                    aria-label={`${name} colour`}
                    value={hex.slice(0, 7)}
                    disabled={readOnly}
                    onChange={(event) => fromHex(token.path, event.target.value, token.value.alpha)}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </PreviewScope>
      <ul className="dsp-badges" aria-label="Contrast">
        {CONTRAST_PAIRS.map((pair) => {
          const fg = at(pair.fg);
          const bg = at(pair.bg);
          if (fg?.type !== 'color' || bg?.type !== 'color') return null;
          const ratio = contrastRatio(fg.value, bg.value);
          const passes = ratio >= pair.min;
          return (
            <li key={pair.label} className="dsp-badge" data-passes={passes}>
              <span>{pair.label}</span>
              <strong>{ratio.toFixed(1)} : 1</strong>
              <span className="dsp-muted">{passes ? `meets ${pair.min} : 1` : `below ${pair.min} : 1`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
