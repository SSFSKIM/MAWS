// The mention chip (C7 execution document, M3 decisions): a React node view, not editable, labelled with the path's last
// two segments and titled with the whole path; an agent chip names the agent.
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import type { MentionAttrs } from '../doc';

export function MentionView({ node, selected }: ReactNodeViewProps) {
  const { id, label, kind } = node.attrs as MentionAttrs;
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-mention={kind}
      title={kind === 'file' ? id : `Agent ${id}`}
      className={`mx-px inline-flex items-center gap-1 rounded-sm px-1 align-baseline text-ui-sm ${kind === 'agent' ? 'bg-accent-soft text-fg' : 'bg-bg-active text-fg'} ${selected ? 'outline outline-1 outline-accent' : ''}`}
    >
      <span aria-hidden className="text-fg-faint">
        {kind === 'agent' ? '@agent' : '@'}
      </span>
      {label || id}
    </NodeViewWrapper>
  );
}
