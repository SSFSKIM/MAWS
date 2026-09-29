// C6's shiki entry points as the product already imports them (src/renderer/src/transcript/view/markdown/code-plugin.ts):
// the baseline the shiki plugin's increment is measured over.
import { bundledLanguages, bundledLanguagesInfo, createHighlighter } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

window.__c6 = { bundledLanguages, bundledLanguagesInfo, createHighlighter, createJavaScriptRegexEngine };
