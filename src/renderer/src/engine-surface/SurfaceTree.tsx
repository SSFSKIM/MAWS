// One renderer for the plain-data tree a plugin drew (R2; charter D-9 as amended 2026-10-01, the waves plan's R2
// rulings): every element of the desktop surface's table in MAWS's tokens and UI font (code in the code font). Box is a
// flex box and Text a span (style.ts); a Button, Input or Select sends the person's press, typing or pick to the engine
// naming the element by the `plugin` and `handle` its drawing carried (actions.ts); a Link opens through the app's link
// handling (`layout.openExternal`); Code and Markdown draw through the transcript's own markdown renderer (Code as a
// fenced block, so the transcript's highlighter draws it); an Svg is a `data:` image, or a frame with `sandbox=""` when
// it asks to be interactive; `engine` draws MAWS's own drawing of the site (`engine`, given by the site). A Client
// element requires client JavaScript, deferred in R3: it draws MAWS native instead.
import { createContext, useContext, useId, useState, type MouseEvent, type ReactNode } from 'react';
import { SURFACE_VALUE_MAX } from '@shared/engine/surface';
import { Markdown } from '../transcript';
import { input as sendInput, press as sendPress, select as sendSelect, type Site } from './actions';
import { boxStyle, textStyle } from './style';
import { firstEngineNode, type SurfaceNode } from './tree';

export const SURFACE_COPY = {
  dismiss: (label: string) => label || 'Dismiss',
};

interface SurfaceContextValue {
  site: Site;
  nativeNode: Extract<SurfaceNode, { type: 'engine' | 'Client' }> | null;
  engine: ReactNode; // MAWS's own drawing of the site, for an `engine` node
}
const SurfaceContext = createContext<SurfaceContextValue | null>(null);
const useSurface = (): SurfaceContextValue => {
  const value = useContext(SurfaceContext);
  if (!value) throw new Error('a surface element rendered outside SurfaceTree');
  return value;
};

const openExternal = (site: Site, url: string) =>
  void site.client.invoke('layout.openExternal', { url }).then((result) => {
    if (!result.ok) console.warn(`[engine-surface] could not open ${url}: ${result.error.message}`);
  });

const BUTTON = 'inline-flex h-6 shrink-0 items-center rounded-sm border border-border-strong px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
const PRIMARY = 'inline-flex h-6 shrink-0 items-center rounded-sm bg-accent px-2 text-ui-sm text-bg outline-accent hover:opacity-90 focus-visible:outline-2';
const PLAIN = 'inline-flex shrink-0 items-center rounded-sm px-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
const FIELD = 'h-6 min-w-0 rounded-sm border border-border-strong bg-bg px-1.5 text-ui-sm text-fg outline-accent focus-visible:outline-2';

export function SurfaceTree({ tree, site, engine = null }: { tree: SurfaceNode; site: Site; engine?: ReactNode }) {
  return (
    <SurfaceContext.Provider value={{ site, engine, nativeNode: firstEngineNode(tree) ?? firstClientNode(tree) }}>
      <Node key={identityOf(tree) ?? 'root'} node={tree} />
    </SurfaceContext.Provider>
  );
}

function Children({ nodes, inline }: { nodes: SurfaceNode[]; inline: boolean }) {
  const keys = childKeys(nodes);
  return (
    <>
      {nodes.map((child, index) =>
        // a Box wraps each string in a Text, as core does
        typeof child === 'string' && !inline ? (
          <span key={keys[index]} style={textStyle({})}>
            {child}
          </span>
        ) : (
          <Node key={keys[index]} node={child} inline={inline} />
        ),
      )}
    </>
  );
}

// A node's React key: an element a plugin addresses (`press.plugin` and `props.key`) keeps its identity, and so the
// text typed or the option picked in it, when siblings move around it or another element takes its place (the root
// included); anything else, or a duplicate among siblings, its position.
const identityOf = (node: SurfaceNode): string | null =>
  typeof node !== 'string' && (node.type === 'Button' || node.type === 'Input' || node.type === 'Select' || (node.type === 'Markdown' && node.press)) && node.props.key !== undefined
    ? `el:${node.press!.plugin}:${node.props.key}`
    : null;

export function childKeys(nodes: readonly SurfaceNode[]): string[] {
  const identities = nodes.map(identityOf);
  const counts = new Map<string, number>();
  for (const id of identities) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  return identities.map((id, index) => (id !== null && counts.get(id) === 1 ? id : `at:${index}`));
}

function Node({ node, inline = false }: { node: SurfaceNode; inline?: boolean }) {
  if (typeof node === 'string') return <>{node}</>;
  switch (node.type) {
    case 'fragment':
      return <Children nodes={node.children} inline={inline} />;
    case 'Box':
    case 'div':
      return (
        <div data-surface="box" style={boxStyle(node.props)}>
          <Children nodes={node.children} inline={false} />
        </div>
      );
    case 'Text':
    case 'span':
    case 'b':
      return (
        <span data-surface="text" style={textStyle(node.type === 'b' ? { ...node.props, bold: true } : node.props)}>
          <Children nodes={node.children} inline />
        </span>
      );
    case 'Button':
      return <ButtonNode node={node} />;
    case 'Input':
      return <InputNode node={node} />;
    case 'Select':
      return <SelectNode node={node} />;
    case 'Link':
      return <LinkNode node={node} />;
    case 'Code':
      return <CodeNode node={node} />;
    case 'Markdown':
      return <MarkdownNode node={node} />;
    case 'Svg':
      return <SvgNode node={node} />;
    case 'Client':
    case 'engine':
      return <NativeNode node={node} />;
  }
}

// There is exactly one native placement: the first engine node, or, with no engine node, the first Client.
// A Client is a fallback, not a second native slot (one persistent row host cannot mount in two places).
function firstClientNode(tree: SurfaceNode): Extract<SurfaceNode, { type: 'Client' }> | null {
  if (typeof tree === 'string') return null;
  if (tree.type === 'Client') return tree;
  if ('children' in tree) {
    for (const child of tree.children) {
      const client = firstClientNode(child);
      if (client !== null) return client;
    }
  }
  return null;
}

function NativeNode({ node }: { node: Extract<SurfaceNode, { type: 'engine' | 'Client' }> }) {
  const { engine, nativeNode } = useSurface();
  return <>{node === nativeNode ? engine : null}</>;
}

function ButtonNode({ node }: { node: Extract<SurfaceNode, { type: 'Button' }> }) {
  const { site } = useSurface();
  const { key, label, variant, role, plain, dimColor, hotkey } = node.props;
  const onClick = () => sendPress(site, node.press, key);
  if (role === 'dismiss') {
    return (
      <button type="button" data-surface="button" data-plugin={node.press.plugin} data-key={key} data-role="dismiss" aria-label={SURFACE_COPY.dismiss(label)} title={SURFACE_COPY.dismiss(label)} onClick={onClick} className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
        ×
      </button>
    );
  }
  const className = plain ? PLAIN : variant === 'primary' ? PRIMARY : BUTTON;
  return (
    <button type="button" data-surface="button" data-plugin={node.press.plugin} data-key={key} data-hotkey={hotkey} onClick={onClick} className={`${className}${dimColor ? ' text-fg-muted hover:text-fg' : ''}`}>
      {plain && hotkey ? <span className="text-accent">{hotkey}:&nbsp;</span> : null}
      {label}
    </button>
  );
}

// What the person typed or picked, until a redraw draws another value, which replaces it as the engine's own field does
// (adjusted while rendering, so the field keeps its element and the keyboard).
function useField(drawn: string) {
  const initial = () => ({ drawn, current: drawn.length > SURFACE_VALUE_MAX ? '' : drawn, refused: drawn.length > SURFACE_VALUE_MAX });
  const [state, setState] = useState(initial);
  const errorId = useId();
  const current = state.drawn === drawn ? state : initial();
  if (current !== state) setState(current);
  const setValue = (value: string): boolean => {
    if (value.length > SURFACE_VALUE_MAX) {
      setState({ ...current, refused: true });
      return false;
    }
    setState({ drawn, current: value, refused: false });
    return true;
  };
  return { value: current.current, refused: current.refused, setValue, errorId };
}

function FieldError({ id }: { id: string }) {
  return <span id={id} role="alert" className="text-ui-sm text-fg-muted">Value refused: maximum 16,384 characters.</span>;
}

function InputNode({ node }: { node: Extract<SurfaceNode, { type: 'Input' }> }) {
  const { site } = useSurface();
  const { key, label, placeholder, value, submitLabel } = node.props;
  const field = useField(value ?? '');
  const text = field.value;
  const [focused, setFocused] = useState(false);
  return (
    <label data-surface="input" data-plugin={node.press.plugin} data-key={key} className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
      {label && <span className="shrink-0">{label}</span>}
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        aria-invalid={field.refused || undefined}
        aria-describedby={field.refused ? field.errorId : undefined}
        aria-label={label ?? key}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          if (!field.setValue(event.target.value)) return;
          sendInput(site, node.press, key, 'change', event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!field.refused) sendInput(site, node.press, key, 'submit', text);
        }}
        className={FIELD}
      />
      {field.refused && <FieldError id={field.errorId} />}
      {focused && <span className="shrink-0 text-fg-faint">↵ {submitLabel ?? 'submit'}</span>}
    </label>
  );
}

function SelectNode({ node }: { node: Extract<SurfaceNode, { type: 'Select' }> }) {
  const { site } = useSurface();
  const { key, label, options, value } = node.props;
  const field = useField(value ?? options[0]!.value);
  return (
    <label data-surface="select" data-plugin={node.press.plugin} data-key={key} className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
      {label && <span className="shrink-0">{label}</span>}
      <select
        value={field.value}
        aria-invalid={field.refused || undefined}
        aria-describedby={field.refused ? field.errorId : undefined}
        aria-label={label ?? key}
        onChange={(event) => {
          if (!field.setValue(event.target.value)) return;
          sendSelect(site, node.press, key, event.target.value);
        }}
        className={FIELD}
      >
        {field.value === '' && !options.some((option) => option.value === '') && <option value="" disabled>Choose a value</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label ?? option.value}
          </option>
        ))}
      </select>
      {field.refused && <FieldError id={field.errorId} />}
    </label>
  );
}

function LinkNode({ node }: { node: Extract<SurfaceNode, { type: 'Link' }> }) {
  const { site } = useSurface();
  const { href, label } = node.props;
  return (
    <a
      data-surface="link"
      href={href}
      title={href}
      className="text-accent underline-offset-2 hover:underline"
      onClick={(event) => {
        event.preventDefault();
        openExternal(site, href);
      }}
    >
      {node.children.length > 0 ? <Children nodes={node.children} inline /> : (label ?? href)}
    </a>
  );
}

// A fence the source cannot close early: one backtick longer than its longest run.
export function fenced(source: string, language: string): string {
  let longest = 2;
  for (const match of source.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${source}\n${fence}`;
}

function CodeNode({ node }: { node: Extract<SurfaceNode, { type: 'Code' }> }) {
  const { source, language, path, format } = node.props;
  const lang = format === 'diff' ? 'diff' : (language ?? path?.split('.').pop() ?? '');
  return (
    <div data-surface="code" className="min-w-0">
      <Markdown markdown={fenced(source, lang)} live={false} />
    </div>
  );
}

function MarkdownNode({ node }: { node: Extract<SurfaceNode, { type: 'Markdown' }> }) {
  const { site } = useSurface();
  const { text, dimColor, pressableLinks, key } = node.props;
  // links: the plugin's own when it answers them (a press carrying the href), else the app's link handling; the
  // transcript's link component is not mounted under a transcript here, so the click is taken before it
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a[href]');
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    const href = anchor.getAttribute('href')!;
    if (node.press && key !== undefined && (pressableLinks === undefined || pressableLinks.includes(href))) sendPress(site, node.press, key, href);
    else if (/^https?:/.test(href)) openExternal(site, href);
  };
  return (
    <div data-surface="markdown" className={`min-w-0${dimColor ? ' text-fg-muted' : ''}`} onClickCapture={onClickCapture}>
      <Markdown markdown={text} live={false} />
    </div>
  );
}

function SvgNode({ node }: { node: Extract<SurfaceNode, { type: 'Svg' }> }) {
  const { source, alt, width, height, isInteractive } = node.props;
  if (isInteractive) return <iframe data-surface="svg" sandbox="" srcDoc={source} title={alt} width={width} height={height} className="max-w-full border-0" />;
  return <img data-surface="svg" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(source)))}`} alt={alt} width={width} height={height} className="max-w-full" />;
}
