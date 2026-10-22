// P4-A2 (X35): the editors' provisional layer over an open document (layer.ts). React-free, as tsconfig.node.json
// typechecks this directory; each editor's hook stands in its own directory (the document editor's in
// src/artifacts/document/editor/provisional.ts).
export { openFile, ProvisionalLayers, type ProvisionalSource } from './layer';
