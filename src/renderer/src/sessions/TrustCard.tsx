// The trust step's card body (C10 execution document, "The unstarted session", TrustCard; mockup 05 vignette 02 for
// the content): what trust would load, read from the directory itself, and the three answers. The frame (title, focus,
// Enter and Esc) is C7's `DockedCardFrame`, docked through `dockCard` by `SetupCard.tsx`.
// "Trust and start" is the default (§3: sessions load project settings as the terminal does); "Start without trusting"
// is the quiet secondary (owner's decision, §19).
import { TRUST_GATES, type TrustState } from '@shared/sessions/trust';
import { PRIMARY, QUIET, SECONDARY } from './ui';

export const TRUST_CARD_TITLE = 'Trust this folder?';

// Corrected at M1: under `~` the project and local settings files are the config home's own, which load with or
// without the attestation, so the card promises nothing about rules.
export const HOME_TRUST_COPY =
  'Claude Code never saves trust for your home folder. Plugins, .mcp.json servers and agent hooks under ~ cannot be enabled here, and you will be asked each launch.';

export function TrustCard({
  trust,
  busy,
  onAccept,
  onDecline,
  onStartWithoutTrusting,
}: {
  trust: TrustState;
  busy: boolean;
  onAccept(): void;
  onDecline(): void;
  onStartWithoutTrusting(): void;
}) {
  return (
    <div className="flex flex-col gap-2.5 text-ui text-fg">
      <p className="m-0 font-mono text-ui-sm break-all text-fg">{trust.directory}</p>
      {trust.isHome ? (
        <p className="m-0 text-fg-muted">{HOME_TRUST_COPY}</p>
      ) : (
        <>
          <p className="m-0 text-fg-muted">
            Loads its settings, hooks, MCP servers and plugins, exactly as the terminal does. Recorded in <span className="font-mono text-ui-sm">{trust.configPath}</span>; the
            terminal will not ask again.
          </p>
          {trust.trustKey !== trust.directory && (
            <p className="m-0 text-fg-muted">
              Trust is recorded for the repository at <span className="font-mono text-ui-sm">{trust.trustKey}</span>
            </p>
          )}
          {trust.found.length > 0 ? (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui-sm">
              {trust.found.map((f) => (
                <div key={f.file} className="contents">
                  <dt className="font-mono text-fg">{f.file}</dt>
                  <dd className="m-0 text-fg-muted">{f.summary}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <ul aria-label="Trust would load" className="m-0 list-disc pl-5 text-ui-sm text-fg-muted">
              {TRUST_GATES.map((gate) => (
                <li key={gate}>{gate}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={onAccept} className={PRIMARY}>
          Trust and start
        </button>
        <button type="button" disabled={busy} onClick={onStartWithoutTrusting} className={QUIET}>
          Start without trusting
        </button>
        <button type="button" onClick={onDecline} className={`${SECONDARY} ml-auto`}>
          Cancel
        </button>
      </div>
    </div>
  );
}
