// D14 §5, the law: `DESIGN.md` rendered (read-only until B's document editor lands and the law moves to format 2, D7).
// The law is agent-written, so raw HTML stays out (no rehype-raw), what is left is sanitized, and links open only to
// the web (`urlTransform`); an image loads nothing (the law describes, its canon shows).
import { harden } from 'rehype-harden';
import { defaultRehypePlugins, Streamdown, type StreamdownProps, type UrlTransform } from 'streamdown';

const REHYPE: NonNullable<StreamdownProps['rehypePlugins']> = [
  defaultRehypePlugins.sanitize!,
  [harden, { allowedLinkPrefixes: ['*'], allowedImagePrefixes: [], allowDataImages: false, linkBlockPolicy: 'text-only', imageBlockPolicy: 'text-only' }],
];
const urlTransform: UrlTransform = (url, key) => (key === 'src' ? null : /^(?:https?|mailto):/i.test(url) ? url : null);

/** The route to the agent for a system without a law: "Ask the agent to adopt it" (the adopt route, D12). */
export interface AskAdopt {
  onAsk(): void;
  /** Why the agent cannot be asked now (no session to take the request), else null. */
  unavailable: string | null;
}

export function Law(props: { law: string; askAdopt?: AskAdopt }) {
  const { askAdopt } = props;
  return (
    <section className="dsp-section" data-ds-section="law" aria-labelledby="dsp-law">
      <h2 id="dsp-law" className="dsp-heading">
        Law
      </h2>
      {props.law.trim() ? (
        <Streamdown className="dsp-law" mode="static" controls={false} rehypePlugins={REHYPE} urlTransform={urlTransform}>
          {props.law}
        </Streamdown>
      ) : (
        <div className="dsp-actions">
          <p className="dsp-muted">No law yet. A system’s law is written, never generated: ask the agent to adopt this system, and it writes DESIGN.md from what it reads.</p>
          {askAdopt ? (
            <p className="dsp-row">
              <button type="button" className="dsp-button" disabled={askAdopt.unavailable !== null} onClick={() => askAdopt.onAsk()}>
                Ask the agent to adopt it
              </button>
              {askAdopt.unavailable !== null ? <span className="dsp-muted">{askAdopt.unavailable}</span> : null}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
