// `node:sqlite` for the happy-dom test projects (vitest.config.ts, `domAlias`). Vitest externalizes the node built-ins
// its client environment may import from Node's `builtinModules`, and Node 22 leaves the scheme-only `node:sqlite` out
// of that list (Node 24 has it), so under Node 22 a DOM suite whose graph imports the module (the engine host's
// storage, through `src/engine-host/documents/migrations.ts`) fails to collect: "Cannot bundle built-in module". The
// alias points such an import here, and this hands back the built-in itself.
const sqlite = process.getBuiltinModule('node:sqlite');

export const { DatabaseSync, StatementSync, constants } = sqlite;
export default sqlite;
