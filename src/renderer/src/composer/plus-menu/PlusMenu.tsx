// The "+" menu (C7 execution document, "Mentions, palette and the "+" menu"): files and folders or photos through main's
// picker (images and PDFs attach as bytes, anything else is mentioned by path), Add directory… (W10, C9: the session's
// additional directories, where the toolbar's `+ dir` chip was; given the frame's binding, so the editor harness, which
// has none, shows no such item), the slash palette at `/`, and the Connectors and Plugins widgets (`/mcp`, `/plugins`),
// disabled with the palette's Not available here where a host registers no widgets. The toolbar that holds it is the
// Composer's (M4); the menu drives the editor through its handle. The word cut: a plugin row is its name alone (C17), a
// submenu's last rows "In this chat…" and "Manage…" (C18), an empty submenu says so in two words (C19, P578, P579), and
// Add directory…'s wait is a spinner beside the "+" whose words are the "+"'s tooltip (C20). Board ticket 421
// (docs/doperpowers/plans/2026-11-23-tool-choice.md, D11 and §H): after them, a chat not yet started offers Tools, the set
// of MAWS's tools it will start with: the four groups as checkbox items (a choice keeps the menu open; Documents and
// Dashboards refused, saying they need Artifacts, while it is off), then the question tool as a radio group, each item's
// fact its row note; given the frame's binding, which is null wherever the choice would not be honoured.
import { DropdownMenu } from 'radix-ui';
import { useId, type RefObject } from 'react';
import { withArtifacts, type MawsToolSet } from '@shared/maws/tool-set';
import { ipc } from '../../ipc/client';
import type { EditorHandle } from '../editor/controller';
import { ADD_DIRECTORY, useAddDirectory } from '../frame/add-directory';
import type { ChipBinding } from '../frame/bindings';
import { useOpenWhileShown } from '../frame/draft-shown';
import { UNAVAILABLE_HINT } from '../mentions/items';
import { useRegisteredWidgets, type WidgetCommandName } from '../mentions/widgets';
import { toast } from '../../stores/notices';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../../stores/sessions';
import { openCustomize } from '../../customize/open';
import { useConnectorMenu } from '../../widgets/connector-menu'; // UX wave U11a: the Connectors submenu's rows and line
import { QuietSpinner } from '../../ui/spinner';
import { PLUS_MENU, TOOLS_MENU } from '../copy';
import { Tip } from '../../ui/tip';
import { RefusedMenuItem } from '../../ui/refused-menu-item';
import { RowNote, useRowNote } from '../../ui/row-note';
import { Icon } from '../../app/IconButton';
import { MAWS_TOOLS } from '../../settings-tab/copy'; // the group words and facts Settings › Sessions shows

const ITEM = 'flex cursor-default flex-col rounded-sm px-2 py-1 outline-none select-none data-highlighted:bg-bg-hover data-disabled:text-fg-faint';
const NO_DIRECTORIES: ChipBinding<string[]> = { value: [], options: [], disabled: 'No session to add a directory to', set: async () => ({ ok: false, error: 'No session to add a directory to' }) };

export interface PlusMenuProps {
  appSessionId?: AppSessionId;
  cwd: string;
  editor: RefObject<EditorHandle | null>;
  directories?: ChipBinding<string[]>; // the frame's binding: a started session's flag settings, or an unstarted one's intent
  tools?: ChipBinding<MawsToolSet> | null; // board ticket 421: the frame's binding; none, no Tools submenu
}

export function PlusMenu({ appSessionId, cwd, editor, directories, tools = null }: PlusMenuProps) {
  const widgets = useRegisteredWidgets();
  const [open, setOpen] = useOpenWhileShown(); // closed as a docked card hides the toolbar
  const status = useSessions((s) => appSessionId ? s.engine.get(appSessionId) : undefined);
  const projectId = useSessions((s) => (appSessionId ? s.records.get(appSessionId)?.projectId : null) ?? [...s.projects.values()].find((project) => project.directory === cwd)?.id ?? null);
  const addDirectory = useAddDirectory(directories ?? NO_DIRECTORIES, cwd);
  const connectors = useConnectorMenu(appSessionId, { enabled: open });
  const pick = async (kind: 'files' | 'photos') => {
    const result = await ipc.invoke('layout.pickFiles', { kind, directory: cwd === '' ? null : cwd, multiple: true });
    if (!result.ok) return void toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true });
    await editor.current?.attachPicked(result.value.files);
  };
  const widgetItem = (label: string, name: Extract<WidgetCommandName, 'mcp' | 'plugins'>) => {
    const ready = status?.process === 'ready';
    const rows: { name: string; detail?: string }[] = name === 'mcp' ? connectors.rows : !ready ? [] : status.plugins.map((plugin) => ({ name: plugin.name }));
    const empty = name === 'mcp' ? connectors.empty : ready ? PLUS_MENU.noPlugins : null;
    return <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={`${ITEM} flex-row items-center justify-between gap-3`}><span>{label}</span><span aria-hidden>›</span></DropdownMenu.SubTrigger>
      <DropdownMenu.Portal><DropdownMenu.SubContent sideOffset={4} className="z-50 max-h-[60vh] min-w-56 max-w-80 overflow-y-auto rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
        {rows.map((row, index) => <DropdownMenu.Item key={`${row.name}:${index}`} onSelect={() => editor.current?.openWidget(name)} disabled={!widgets.has(name)} className={`${ITEM} flex-row items-center justify-between gap-3`}><span className="min-w-0 truncate">{row.name}</span>{row.detail !== undefined && <span className="shrink-0 text-ui-sm text-fg-muted">{row.detail}</span>}</DropdownMenu.Item>)}
        {rows.length === 0 && empty !== null && <DropdownMenu.Label className="max-w-64 px-2 py-2 text-ui-sm text-fg-muted">{empty}</DropdownMenu.Label>}
        <DropdownMenu.Item disabled={!widgets.has(name)} onSelect={() => editor.current?.openWidget(name)} className={ITEM}>
          <span>{PLUS_MENU.inThisChat}</span>
          {widgets.has(name) ? null : <span className="text-ui-sm">{UNAVAILABLE_HINT}</span>}
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="my-1 h-px bg-border" />
        <DropdownMenu.Item onSelect={() => openCustomize(name, projectId)} className={ITEM}>{PLUS_MENU.manage}</DropdownMenu.Item>
      </DropdownMenu.SubContent></DropdownMenu.Portal>
    </DropdownMenu.Sub>;
  };
  return (
    <>
      <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
        <Tip content={addDirectory.wait} description={addDirectory.wait}>
          <DropdownMenu.Trigger aria-label="Add files, photos or commands" className="inline-flex size-7 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
            +
          </DropdownMenu.Trigger>
        </Tip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="z-50 min-w-56 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
            <DropdownMenu.Item onSelect={() => void pick('files')} className={ITEM}>
              Files and folders…
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => void pick('photos')} className={ITEM}>
              Photos…
            </DropdownMenu.Item>
            {directories && (
              <DropdownMenu.Item disabled={addDirectory.disabled !== null || addDirectory.busy} onSelect={() => void addDirectory.add()} className={ITEM}>
                <span>{ADD_DIRECTORY}</span>
                {addDirectory.disabled !== null && <span className="text-ui-sm">{addDirectory.disabled}</span>}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item onSelect={() => editor.current?.openSlash()} className={ITEM}>
              Slash commands
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            {widgetItem('Connectors', 'mcp')}
            {widgetItem('Plugins', 'plugins')}
            {tools !== null && <ToolsSubmenu tools={tools} />}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/* P2-A (2026-10-09): a directory chosen on a session with no ready process starts it first, shown beside the "+";
          the word cut (C20): the quiet spinner, named by the wait's words, while it starts and while the directory is applied */}
      {addDirectory.wait !== null && (
        <span data-add-directory-phase="" className="inline-flex size-7 items-center justify-center">
          <QuietSpinner label={addDirectory.wait} />
        </span>
      )}
    </>
  );
}

// ---- board ticket 421: the Tools submenu ---------------------------------------------------------------------------

type Group = keyof typeof MAWS_TOOLS.groups;
const GROUPS = Object.keys(MAWS_TOOLS.groups) as Group[];
const NEEDS_ARTIFACTS: readonly Group[] = ['documents', 'dashboards'];
const QUESTION_TOOLS = ['engine', 'maws'] as const satisfies readonly MawsToolSet['question'][];
const SUBMENU = 'z-50 min-w-56 max-w-80 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
const CHOICE = `${ITEM} relative flex-row items-center gap-2 aria-disabled:text-fg-faint`;

const CheckIcon = () => (
  <Icon className="size-3.5">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </Icon>
);
// The check's room, its mark drawn while the item is checked (panel/PanelHeader.tsx's indicator); a refused row keeps
// the room with no mark, so every label starts at one edge.
const Check = ({ mark = true }: { mark?: boolean }) => (
  <span aria-hidden data-menu-check className="inline-flex size-3.5 shrink-0 items-center justify-center text-accent">
    {mark && (
      <DropdownMenu.ItemIndicator>
        <CheckIcon />
      </DropdownMenu.ItemIndicator>
    )}
  </span>
);

function ToolsSubmenu({ tools }: { tools: ChipBinding<MawsToolSet> }) {
  const questionLabel = useId();
  // the frame's one reason while the first send starts or its message is held: the whole submenu greyed with it
  if (tools.disabled !== null) return <RefusedMenuItem kit={DropdownMenu} label={TOOLS_MENU.label} reason={tools.disabled} className={CHOICE} />;
  const set = tools.value;
  const choose = (next: MawsToolSet) =>
    void tools.set(next).then((result) => {
      if (!result.ok) toast({ level: 'warning', text: result.error, actions: [], dismissible: true });
    });
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={`${ITEM} flex-row items-center justify-between gap-3`}><span>{TOOLS_MENU.label}</span><span aria-hidden>›</span></DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} className={SUBMENU}>
          {GROUPS.map((group) => {
            const { word, fact } = MAWS_TOOLS.groups[group];
            if (NEEDS_ARTIFACTS.includes(group) && !set.artifacts) return <RefusedMenuItem key={group} kit={DropdownMenu} label={word} reason={MAWS_TOOLS.needsArtifacts} lead={<Check mark={false} />} className={CHOICE} />;
            return <GroupItem key={group} word={word} fact={fact} checked={set[group]} onChecked={(on) => choose(group === 'artifacts' ? withArtifacts(set, on) : { ...set, [group]: on })} />;
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label id={questionLabel} className="px-2 py-1 text-ui-sm text-fg-muted">{TOOLS_MENU.question}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup aria-labelledby={questionLabel} value={set.question} onValueChange={(question) => choose({ ...set, question: question as MawsToolSet['question'] })}>
            {QUESTION_TOOLS.map((question) => <QuestionItem key={question} value={question} word={MAWS_TOOLS.questionTools[question]} fact={TOOLS_MENU.questionFacts[question]} />)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

// A group's checkbox item: its word the name, its fact the row note; a choice keeps the menu open.
function GroupItem({ word, fact, checked, onChecked }: { word: string; fact: string; checked: boolean; onChecked(on: boolean): void }) {
  const note = useRowNote();
  return (
    <DropdownMenu.CheckboxItem checked={checked} onCheckedChange={onChecked} onSelect={(event) => event.preventDefault()} aria-label={word} textValue={word} {...note.rowProps} className={CHOICE}>
      <Check />
      {word}
      <RowNote note={note}>{fact}</RowNote>
    </DropdownMenu.CheckboxItem>
  );
}

// A question tool's radio item: as a group's, a choice keeps the menu open over the submenu's other choices.
function QuestionItem({ value, word, fact }: { value: MawsToolSet['question']; word: string; fact: string }) {
  const note = useRowNote();
  return (
    <DropdownMenu.RadioItem value={value} onSelect={(event) => event.preventDefault()} aria-label={word} textValue={word} {...note.rowProps} className={CHOICE}>
      <Check />
      {word}
      <RowNote note={note}>{fact}</RowNote>
    </DropdownMenu.RadioItem>
  );
}
