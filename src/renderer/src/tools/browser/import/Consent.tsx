// The sheet's consent state (E4b Design §3): what the profile holds, the four categories (Saved passwords disabled,
// P-17), the line saying agents' tabs will be signed in as the profile (P-23; Decision Log 29), the extension list with
// its facts, and the unverified-files acknowledgement, required while any extension is chosen. Import sends exactly what
// is checked; extensions go only with the acknowledgement.
import { useState, type ReactNode } from 'react';
import type { ExtensionCandidate } from '@shared/browser/import';
import type { BrowserImportInspection } from '@shared/ipc/schema/browser';
import { SheetForm } from '../../../sessions/Sheet';
import { CHOICE, PRIMARY } from '../../../sessions/ui';
import { Chip } from '../../../settings-tab/parts';
import { IMPORT_COPY } from './copy';
import { start, useBrowserImport } from './store';

const WALLET_CHIP = 'inline-flex items-center rounded-sm border border-l-2 border-border border-l-warning px-2 py-0.5 text-ui-sm whitespace-nowrap text-fg-muted';

const importable = (candidate: ExtensionCandidate) => candidate.error === null;
const checkedByDefault = (candidate: ExtensionCandidate) => importable(candidate) && candidate.chromeState !== 'disabled'; // Decision Log 9

export function Consent({ inspection }: { inspection: BrowserImportInspection }) {
  const { profile, history, cookies, extensions, chromeRunning } = inspection;
  const busy = useBrowserImport((s) => s.busy);
  const [historyOn, setHistory] = useState('rows' in history);
  const [cookiesOn, setCookies] = useState('rows' in cookies);
  const [extensionsOn, setExtensions] = useState(extensions.some(importable));
  const [chosen, setChosen] = useState(() => new Set(extensions.filter(checkedByDefault).map((e) => e.id)));
  const [acknowledged, setAcknowledged] = useState(false);
  const extensionIds = extensionsOn ? extensions.filter((e) => importable(e) && chosen.has(e.id)).map((e) => e.id) : [];
  const withExtensions = extensionIds.length > 0;
  const canSubmit = !busy && (historyOn || cookiesOn || withExtensions) && (!withExtensions || acknowledged);
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <SheetForm
      canSubmit={canSubmit}
      onSubmit={() =>
        void start({
          categories: { history: historyOn, cookies: cookiesOn, extensions: withExtensions },
          extensionIds,
          allowUnverifiedExtensions: withExtensions && acknowledged,
        })
      }
      submitLabel={IMPORT_COPY.import}
      submitClass={PRIMARY}
    >
      <div className="-mr-2 flex max-h-[56vh] flex-col gap-3 overflow-y-auto pr-2">
        <p className="m-0 flex flex-wrap gap-x-2 text-ui">
          <span className="text-fg">{profile.name}</span>
          {[profile.gaiaName, profile.userName]
            .filter((part): part is string => part !== null && part !== '' && part !== profile.name)
            .map((part) => (
              <span key={part} className="text-ui-sm text-fg-muted">
                {part}
              </span>
            ))}
        </p>
        {chromeRunning && <p className="m-0 text-ui-sm text-fg-muted">{IMPORT_COPY.chromeRunning}</p>}

        <Category name={IMPORT_COPY.categories.history} checked={historyOn} onChange={setHistory} disabled={!('rows' in history)} data-category="history">
          {'rows' in history ? IMPORT_COPY.history(history.rows) : <StoreError store="History" code={history.error} />}
        </Category>
        <Category name={IMPORT_COPY.categories.cookies} checked={cookiesOn} onChange={setCookies} disabled={!('rows' in cookies)} data-category="cookies">
          {'rows' in cookies ? (
            <>
              <span>{IMPORT_COPY.cookies(cookies.rows, cookies.partitioned)}</span>
              <span data-cookies-agents className="text-fg">
                {IMPORT_COPY.cookiesAgents(profile.name)}
              </span>
            </>
          ) : (
            <StoreError store="Cookies" code={cookies.error} />
          )}
        </Category>
        <Category name={IMPORT_COPY.passwords} checked={false} onChange={() => {}} disabled data-category="passwords" />
        <Category
          name={IMPORT_COPY.categories.extensions}
          checked={extensionsOn}
          onChange={setExtensions}
          disabled={!extensions.some(importable)}
          data-category="extensions"
        >
          {IMPORT_COPY.extensions(extensions.length)}
        </Category>

        {extensions.length > 0 && (
          <ul aria-label={IMPORT_COPY.categories.extensions} className="m-0 ml-6 flex list-none flex-col gap-1.5 p-0">
            {extensions.map((candidate) => (
              <li key={candidate.id} data-extension-id={candidate.id} className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-ui-sm">
                  <input
                    type="checkbox"
                    aria-label={IMPORT_COPY.importExtension(candidate.name)}
                    checked={importable(candidate) && chosen.has(candidate.id)}
                    disabled={!extensionsOn || !importable(candidate)}
                    onChange={(event) => toggle(candidate.id, event.target.checked)}
                    className={CHOICE}
                  />
                  <span className={importable(candidate) ? 'text-fg' : 'text-fg-muted'}>{candidate.name}</span>
                  <span className="text-fg-muted">{candidate.version}</span>
                </label>
                <CandidateFacts candidate={candidate} />
              </li>
            ))}
          </ul>
        )}

        {extensions.some(importable) && (
          <label className="flex items-start gap-2 text-ui-sm text-fg">
            <input
              type="checkbox"
              aria-label={IMPORT_COPY.unverified(profile.name)}
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className={`${CHOICE} mt-0.5`}
            />
            {IMPORT_COPY.unverified(profile.name)}
          </label>
        )}
      </div>
    </SheetForm>
  );
}

function Category({
  name,
  checked,
  onChange,
  disabled = false,
  children,
  ...data
}: { name: string; checked: boolean; onChange(next: boolean): void; disabled?: boolean; children?: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <label {...data} className="flex items-start gap-2">
      <input type="checkbox" aria-label={name} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className={`${CHOICE} mt-1`} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={disabled ? 'text-fg-muted' : 'text-fg'}>{name}</span>
        {children !== undefined && <span className="flex flex-col gap-0.5 text-ui-sm text-fg-muted">{children}</span>}
      </span>
    </label>
  );
}

function StoreError({ store, code }: { store: 'History' | 'Cookies'; code: string }) {
  return (
    <span role="alert" title={code} className="text-danger">
      {IMPORT_COPY.storeError(store, code)}
    </span>
  );
}

function CandidateFacts({ candidate }: { candidate: ExtensionCandidate }) {
  if (candidate.error !== null) return <span className="ml-6 text-ui-sm text-danger">{IMPORT_COPY.candidateError(candidate.error)}</span>;
  const facts = [
    candidate.chromeState === 'disabled' && IMPORT_COPY.disabledInChrome,
    candidate.manifestVersion === 2 && IMPORT_COPY.mv2,
    candidate.background === 'none' && IMPORT_COPY.noBackground,
  ].filter((fact): fact is string => fact !== false);
  if (!candidate.wallet && facts.length === 0 && candidate.unsupportedPermissions.length === 0) return null;
  return (
    <span className="ml-6 flex flex-wrap gap-1">
      {candidate.wallet && <span className={WALLET_CHIP}>{IMPORT_COPY.walletChip}</span>}
      {facts.map((fact) => (
        <Chip key={fact}>{fact}</Chip>
      ))}
      {candidate.unsupportedPermissions.length > 0 && (
        <span title={candidate.unsupportedPermissions.join(', ')}>
          <Chip>{IMPORT_COPY.unsupported(candidate.unsupportedPermissions.length)}</Chip>
        </span>
      )}
    </span>
  );
}
