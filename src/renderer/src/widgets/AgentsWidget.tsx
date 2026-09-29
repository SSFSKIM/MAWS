// `/agents` (C11 execution document, the widget table): the catalogue's agents with their descriptions, from the
// initialize response (the headless `/agents` is a removed stub, SPEC 28 §5). "Mention" puts `@agent-<name> ` at the
// composer's caret through C7's insertion seam.
import type { AppSessionId } from '@shared/graph/ids';
import { insertComposerText } from '../composer';
import { useSessionCatalog, type SessionCatalog } from '../stores/catalog';
import { useSessions } from '../stores/sessions';
import { MENTION, NO_AGENTS, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Row, Rows, TextButton } from './parts';
import { WidgetFrame } from './WidgetFrame';

export function present(catalog: SessionCatalog): { name: string; description: string }[] {
  return catalog.agents.map((a) => ({ name: a.name, description: a.description }));
}

export function AgentsBody({ agents, appSessionId, close }: { agents: { name: string; description: string }[]; appSessionId: AppSessionId; close(): void }) {
  if (agents.length === 0) return <p className="m-0 text-ui-sm text-fg-muted">{NO_AGENTS}</p>;
  const mention = (name: string) => {
    close();
    insertComposerText(appSessionId, `@agent-${name} `);
  };
  return (
    <Rows label="Agents">
      {agents.map((a) => (
        <Row key={a.name} main={a.name} detail={a.description ? <span className="line-clamp-2">{a.description}</span> : null} actions={<TextButton onClick={() => mention(a.name)}>{MENTION}</TextButton>} />
      ))}
    </Rows>
  );
}

// The catalogue is the engine's answer at launch, held past the process; a session that never launched has none.
export function AgentsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const catalog = useSessionCatalog(appSessionId);
  const launched = useSessions((s) => s.engine.has(appSessionId));
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.agents} command="agents" foot={WIDGET_FOOT.agents} state={launched || catalog.revision > 0 ? 'ready' : 'not_running'} error={null} close={close}>
      <AgentsBody agents={present(catalog)} appSessionId={appSessionId} close={close} />
    </WidgetFrame>
  );
}
