// Recognize output tags before Markdown decodes entities/escapes. A dedicated phrasing token retains its exact
// source range through Markdown and sanitization; quoted examples remain ordinary text. No HTML is enabled.
import type { Literal } from 'mdast';
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type { Code, Extension, State, Tokenizer } from 'micromark-util-types';
import type { Plugin } from 'unified';

const names = ['message', 'to-human', 'essential', 'need-input', 'insight', 'choice'];
const tags = names.flatMap((name) => [`<${name}>`, `</${name}>`]).concat('<choice recommended>');
export const outputTagPattern = () => /<(\/?)(message|to-human|essential|need-input|insight|choice)>|<choice recommended>/g;
export const isOutputTag = (text: string) => tags.includes(text);

interface OutputTag extends Literal { type: 'mawsOutputTag'; value: string }
declare module 'mdast' {
  interface PhrasingContentMap { mawsOutputTag: OutputTag }
  interface RootContentMap { mawsOutputTag: OutputTag }
}
declare module 'micromark-util-types' { interface TokenTypeMap { mawsOutputTag: 'mawsOutputTag' } }

const tokenize: Tokenizer = (effects, ok, nok) => {
  let value = '';
  return start;
  function start(code: Code): State | undefined {
    effects.enter('mawsOutputTag');
    return inside(code);
  }
  function inside(code: Code): State | undefined {
    if (code === null) return nok(code);
    const next = value + String.fromCharCode(code);
    if (!tags.some((tag) => tag.startsWith(next))) return nok(code);
    effects.consume(code);
    value = next;
    if (!isOutputTag(value)) return inside;
    effects.exit('mawsOutputTag');
    return ok;
  }
};

export const sourceTags: Plugin = function () {
  const data = this.data() as { micromarkExtensions?: Extension[]; fromMarkdownExtensions?: FromMarkdownExtension[] };
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), { text: { 60: { tokenize } } }];
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), {
    enter: {
      mawsOutputTag(token) {
        const value = this.sliceSerialize(token);
        this.enter({ type: 'mawsOutputTag', value, data: { hName: 'span', hChildren: [{ type: 'text', value }] } }, token);
      },
    },
    exit: { mawsOutputTag(token) { this.exit(token); } },
  }];
};
