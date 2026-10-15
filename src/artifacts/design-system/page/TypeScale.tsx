// D14 §2, type: each role set in its own class (`.ds-type-<role>`) with English and Korean sample text, the document
// scale beside the deck scale (the deck's specimens drawn at half size), size, line and weight editable for the
// document and size and line for the deck. A role whose value aliases another typography token is shown, not edited:
// its values are the other token's.
import type { Doc } from '../../yjs';
import { DECK_KEY } from '../extensions';
import type { ResolvedToken, ResolvedTokens } from '../resolve';
import { byIdentity, TYPE_ROLES } from '../roles';
import type { TokenSet } from '../tokens';
import { isAlias, type DimensionValue } from '../values';
import type { DesignSystemView } from '../view';
import { dimensionOf, dimensionText, editToken, numberOf } from './edit';
import { CommitField } from './fields';
import { PreviewScope } from './PreviewScope';

const SAMPLE = 'Density is mass per unit volume. 밀도는 단위 부피당 질량입니다.';

type Typography = Extract<ResolvedToken, { type: 'typography' }>;
interface DeckScale {
  fontSize?: unknown;
  lineHeight?: unknown;
}

export function TypeScale(props: { doc: Doc; tokens: TokenSet; resolved: ResolvedTokens; view: DesignSystemView; artifactId: string; readOnly: boolean }) {
  const { doc, tokens, resolved, view, artifactId, readOnly } = props;
  const roles = TYPE_ROLES.map((role) => ({ role, token: byIdentity(resolved.tokens, `type.${role}`) })).filter(
    (entry): entry is { role: (typeof TYPE_ROLES)[number]; token: Typography } => entry.token?.type === 'typography',
  );

  // The composite's own fields as written; a field changed is written as a literal.
  const writeField = (shown: Typography, field: 'fontSize' | 'lineHeight' | 'fontWeight', value: DimensionValue | number): string | null => {
    if (typeof shown.token.$value !== 'object' || shown.token.$value === null) return `${shown.path} cannot be edited here`;
    return editToken(doc, tokens, shown, (token) => ({ ...token, $value: { ...(token.$value as Record<string, unknown>), [field]: value } }));
  };
  const writeDeck = (shown: Typography, field: 'fontSize' | 'lineHeight', value: DimensionValue | number): string | null =>
    editToken(doc, tokens, shown, (token) => {
      const extensions = token.$extensions ?? {};
      const deck = { ...((extensions[DECK_KEY] as DeckScale | undefined) ?? {}), [field]: value };
      return { ...token, $extensions: { ...extensions, [DECK_KEY]: deck } };
    });
  const size = (shown: Typography, deck: boolean) => (text: string) => {
    const value = dimensionOf(text);
    if (!value || value.value <= 0) return `“${text}” is not a size (16px, 1rem)`;
    return deck ? writeDeck(shown, 'fontSize', value) : writeField(shown, 'fontSize', value);
  };
  const line = (shown: Typography, deck: boolean) => (text: string) => {
    const value = numberOf(text);
    if (value === null || value <= 0) return `“${text}” is not a line height (1.5)`;
    return deck ? writeDeck(shown, 'lineHeight', value) : writeField(shown, 'lineHeight', value);
  };
  const weight = (shown: Typography) => (text: string) => {
    const value = numberOf(text);
    if (value === null || value < 1 || value > 1000) return `“${text}” is not a weight from 1 to 1000`;
    return writeField(shown, 'fontWeight', value);
  };

  return (
    <section className="dsp-section" data-ds-section="type" aria-labelledby="dsp-type">
      <h2 id="dsp-type" className="dsp-heading">
        Type
      </h2>
      <div className="dsp-type-head" aria-hidden>
        <span>Role</span>
        <span>Document</span>
        <span>Deck (shown at half size)</span>
      </div>
      {roles.map(({ role, token }) => {
        const aliased = isAlias(token.token.$value);
        const deck = token.token.$extensions?.[DECK_KEY] as DeckScale | undefined;
        const deckSize = deck?.fontSize && typeof deck.fontSize === 'object' ? dimensionText(deck.fontSize as DimensionValue) : '';
        const deckLine = typeof deck?.lineHeight === 'number' ? String(deck.lineHeight) : '';
        const locked = readOnly || aliased;
        return (
          <div key={role} className="dsp-type-row" data-role={role}>
            <div className="dsp-type-name">
              <code className="dsp-name">.ds-type-{role}</code>
              {aliased ? <span className="dsp-alias">= {String(token.token.$value)}</span> : null}
            </div>
            <div className="dsp-type-cell">
              <PreviewScope view={view} artifactId={artifactId} medium="document" className="dsp-specimen">
                <p className={`ds-type-${role}`}>{SAMPLE}</p>
              </PreviewScope>
              <div className="dsp-type-fields">
                <CommitField label={`${role} size`} value={dimensionText(token.value.fontSize)} disabled={locked} width="7ch" commit={size(token, false)} />
                <CommitField label={`${role} line`} value={String(token.value.lineHeight)} disabled={locked} width="5ch" commit={line(token, false)} />
                <CommitField label={`${role} weight`} value={String(token.value.fontWeight)} disabled={locked} width="5ch" commit={weight(token)} />
              </div>
            </div>
            <div className="dsp-type-cell">
              <PreviewScope view={view} artifactId={artifactId} medium="deck" className="dsp-specimen dsp-specimen-deck">
                <p className={`ds-type-${role}`}>{SAMPLE}</p>
              </PreviewScope>
              <div className="dsp-type-fields">
                <CommitField label={`${role} deck size`} value={deckSize} disabled={readOnly} width="7ch" commit={size(token, true)} />
                <CommitField label={`${role} deck line`} value={deckLine} disabled={readOnly} width="5ch" commit={line(token, true)} />
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
