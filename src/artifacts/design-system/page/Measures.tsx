// D14 §3, space, radius and shadow: the eight spaces as rulers and the radii as tiles, each value editable; the
// shadows as tiles with their values (a shadow's layers are edited in the token file, by the agent or by hand).
import type { Doc } from '../../yjs';
import { cssValue } from '../css';
import type { ResolvedToken, ResolvedTokens } from '../resolve';
import { byIdentity, cssNamesOf } from '../roles';
import type { TokenSet } from '../tokens';
import { isAlias } from '../values';
import type { DesignSystemView } from '../view';
import { dimensionOf, dimensionText, writeToken, writtenToken } from './edit';
import { CommitField } from './fields';
import { PreviewScope } from './PreviewScope';

const SPACES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `space.${n}`);
const RADII = ['sm', 'md', 'lg', 'full'].map((r) => `radius.${r}`);
const SHADOWS = ['sm', 'md', 'lg'].map((s) => `shadow.${s}`);

export function Measures(props: { doc: Doc; tokens: TokenSet; resolved: ResolvedTokens; view: DesignSystemView; artifactId: string; readOnly: boolean }) {
  const { doc, tokens, resolved, view, artifactId, readOnly } = props;
  const at = (path: string) => byIdentity(resolved.tokens, path);
  const writeDimension = (path: string) => (text: string) => {
    const value = dimensionOf(text);
    if (!value || value.value < 0) return `“${text}” is not a size (8px, 0.5rem)`;
    const written = writtenToken(tokens, path);
    if (!written) return `${path} is not in the token file`;
    return writeToken(doc, written.path, { ...written.token, $value: value });
  };
  const field = (token: Extract<ResolvedToken, { type: 'dimension' }>) => (
    <>
      <CommitField label={`${token.path} value`} value={dimensionText(token.value)} disabled={readOnly} width="7ch" commit={writeDimension(token.path)} />
      {isAlias(token.token.$value) ? <span className="dsp-alias">= {token.token.$value}</span> : null}
    </>
  );
  return (
    <section className="dsp-section" data-ds-section="measures" aria-labelledby="dsp-measures">
      <h2 id="dsp-measures" className="dsp-heading">
        Space, radius, shadow
      </h2>
      <PreviewScope view={view} artifactId={artifactId} medium="document" className="dsp-measures">
        <div className="dsp-rulers">
          {SPACES.map((path) => {
            const token = at(path);
            if (token?.type !== 'dimension') return null;
            const name = cssNamesOf(path, 'dimension')[0]!;
            return (
              <div key={path} className="dsp-ruler" data-token={path}>
                <code className="dsp-name">{name}</code>
                <div className="dsp-ruler-bar" style={{ width: `var(${name})` }} />
                {field(token)}
              </div>
            );
          })}
        </div>
        <div className="dsp-tiles">
          {RADII.map((path) => {
            const token = at(path);
            if (token?.type !== 'dimension') return null;
            const name = cssNamesOf(path, 'dimension')[0]!;
            return (
              <div key={path} className="dsp-tile-cell" data-token={path}>
                <div className="dsp-tile" style={{ borderRadius: `var(${name})` }} />
                <code className="dsp-name">{name}</code>
                {field(token)}
              </div>
            );
          })}
          {SHADOWS.map((path) => {
            const token = at(path);
            if (token?.type !== 'shadow') return null;
            const name = cssNamesOf(path, 'shadow')[0]!;
            return (
              <div key={path} className="dsp-tile-cell" data-token={path}>
                <div className="dsp-tile" style={{ boxShadow: `var(${name})` }} />
                <code className="dsp-name">{name}</code>
                <span className="dsp-muted dsp-value">{cssValue(token)}</span>
              </div>
            );
          })}
        </div>
      </PreviewScope>
    </section>
  );
}
