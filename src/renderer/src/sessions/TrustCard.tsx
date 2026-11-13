// The trust step's card body (C10 execution document, "The unstarted session", TrustCard; mockup 05 vignette 02 for
// the content): what trust would load, read from the directory itself, and the three answers. The frame (title, focus,
// Enter and Esc) is C7's `DockedCardFrame`, docked through `dockCard` by `SetupCard.tsx`.
// "Trust and start" is the default (§3: sessions load project settings as the terminal does); "Start without trusting"
// is the quiet secondary (owner's decision, §19).
// P3-F F4 (fix wave, review B 1): what the card says of the folder is `TrustDetails`, which the comment's trust notice
// (tools/document/comment-session.tsx) shows too, so an answer given there consents to the same words.
// P5 O7 M9 ("Remote setup"): another machine's trust card, answered for a spawn there, names its own accept and offers no
// start without trusting (the machine refuses an untrusted checkout), so `onStartWithoutTrusting` is optional.
// UX wave U1a §J (l4-approvals-13): a folder that holds nothing trust would load says so in one line, where the card listed
// five things that would load; one that holds something lists what it holds, as before.
import type { TrustState } from '@shared/sessions/trust';
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
  acceptLabel = 'Trust and start',
}: {
  trust: TrustState;
  busy: boolean;
  onAccept(): void;
  onDecline(): void;
  onStartWithoutTrusting?(): void;
  acceptLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 text-ui text-fg">
      <TrustDetails trust={trust} />
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={onAccept} className={PRIMARY}>
          {acceptLabel}
        </button>
        {onStartWithoutTrusting && (
          <button type="button" disabled={busy} onClick={onStartWithoutTrusting} className={QUIET}>
            Start without trusting
          </button>
        )}
        <button type="button" onClick={onDecline} className={`${SECONDARY} ml-auto`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** What trusting the folder records and turns on: the folder, the config file and the repository key, what it holds. */
export function TrustDetails({ trust }: { trust: TrustState }) {
  return (
    <>
      <p className="m-0 font-mono text-ui-sm break-all text-fg">{trust.directory}</p>
      {trust.isHome ? (
        <p className="m-0 text-fg-muted">{HOME_TRUST_COPY}</p>
      ) : (
        <>
          {trust.found.length > 0 ? (
            <p className="m-0 text-fg-muted">
              Loads its settings, hooks, MCP servers and plugins, exactly as the terminal does. <RecordedIn trust={trust} />
            </p>
          ) : (
            <>
              <p className="m-0 text-fg-muted">Nothing in this folder loads or runs automatically.</p>
              <p className="m-0 text-fg-muted">
                <RecordedIn trust={trust} />
              </p>
            </>
          )}
          {trust.trustKey !== trust.directory && (
            <p className="m-0 text-fg-muted">
              Trust is recorded for the repository at <span className="font-mono text-ui-sm">{trust.trustKey}</span>
            </p>
          )}
          {trust.found.length > 0 && (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui-sm">
              {trust.found.map((f) => (
                <div key={f.file} className="contents">
                  <dt className="font-mono text-fg">{f.file}</dt>
                  <dd className="m-0 text-fg-muted">{f.summary}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </>
  );
}

function RecordedIn({ trust }: { trust: TrustState }) {
  return (
    <>
      Recorded in <span className="font-mono text-ui-sm">{trust.configPath}</span>; the terminal will not ask again.
    </>
  );
}
