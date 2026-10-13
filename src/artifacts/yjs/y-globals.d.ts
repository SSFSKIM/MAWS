// The binding module: `@y/y` 14.0.0-rc.28 publishes declarations (dist/src/**/*.d.ts) that name its types as globals
// (`Transaction`, `Item`, `IdSet`, ...) declared only in the package's own global.d.ts, which no published declaration
// references; under tsconfig.web.json's `skipLibCheck: false` they do not compile without these. This is that file
// with each path pointed at the published declarations. A re-pin regenerates it from the new version's global.d.ts
// (`./src/` becomes `../../../node_modules/@y/y/dist/src/`), or deletes it once the package's declarations stand alone.
// A script, not a module: every line declares a global type.
/* eslint-disable @typescript-eslint/no-explicit-any -- the package's own declarations, verbatim */
declare type GC = import('../../../node_modules/@y/y/dist/src/structs/GC.js').GC;
declare type Item = import('../../../node_modules/@y/y/dist/src/structs/Item.js').Item;
declare type Skip = import('../../../node_modules/@y/y/dist/src/structs/Skip.js').Skip;
declare type IdRange = import('../../../node_modules/@y/y/dist/src/utils/ids.js').IdRange;
declare type IdSet = import('../../../node_modules/@y/y/dist/src/utils/ids.js').IdSet;
declare type IdMap<Attrs> = import('../../../node_modules/@y/y/dist/src/utils/ids.js').IdMap<Attrs>;
declare type AttrRanges<Attrs = any> = import('../../../node_modules/@y/y/dist/src/utils/ids.js').AttrRanges<Attrs>;
declare type AttrRange<Attrs = any> = import('../../../node_modules/@y/y/dist/src/utils/ids.js').AttrRange<Attrs>;
declare type ContentAttribute<V = any> = import('../../../node_modules/@y/y/dist/src/utils/ids.js').ContentAttribute<V>;
declare type ContentIds = import('../../../node_modules/@y/y/dist/src/utils/ids.js').ContentIds;
declare type ContentMap = import('../../../node_modules/@y/y/dist/src/utils/ids.js').ContentMap;
declare type BlockSet = import('../../../node_modules/@y/y/dist/src/utils/BlockSet.js').BlockSet;
declare type UpdateDecoderV1 = import('../../../node_modules/@y/y/dist/src/utils/UpdateDecoder.js').UpdateDecoderV1;
declare type UpdateDecoderV2 = import('../../../node_modules/@y/y/dist/src/utils/UpdateDecoder.js').UpdateDecoderV2;
declare type UpdateEncoderV1 = import('../../../node_modules/@y/y/dist/src/utils/UpdateEncoder.js').UpdateEncoderV1;
declare type UpdateEncoderV2 = import('../../../node_modules/@y/y/dist/src/utils/UpdateEncoder.js').UpdateEncoderV2;
declare type IdSetEncoderV1 = import('../../../node_modules/@y/y/dist/src/utils/UpdateEncoder.js').IdSetEncoderV1;
declare type IdSetEncoderV2 = import('../../../node_modules/@y/y/dist/src/utils/UpdateEncoder.js').IdSetEncoderV2;
declare type IdSetDecoderV1 = import('../../../node_modules/@y/y/dist/src/utils/UpdateDecoder.js').IdSetDecoderV1;
declare type IdSetDecoderV2 = import('../../../node_modules/@y/y/dist/src/utils/UpdateDecoder.js').IdSetDecoderV2;
declare type ID = import('../../../node_modules/@y/y/dist/src/utils/ID.js').ID;
declare type Transaction = import('../../../node_modules/@y/y/dist/src/utils/Transaction.js').Transaction;
declare type StructStore = import('../../../node_modules/@y/y/dist/src/utils/StructStore.js').StructStore;
declare type Doc = import('../../../node_modules/@y/y/dist/src/utils/Doc.js').Doc;
declare type YNode<DConf extends import('lib0/delta').DeltaConf = any> = import('../../../node_modules/@y/y/dist/src/ynode.js').YNode<DConf>;
declare type YEvent<DConf extends import('lib0/delta').DeltaConf> = import('../../../node_modules/@y/y/dist/src/utils/YEvent.js').YEvent<DConf>;
declare type EventHandler<ARG1 = any, ARG2 = any> = import('../../../node_modules/@y/y/dist/src/utils/EventHandler.js').EventHandler<ARG1, ARG2>;
declare type AbstractStruct = import('../../../node_modules/@y/y/dist/src/structs/AbstractStruct.js').AbstractStruct;
declare type AbstractContent = import('../../../node_modules/@y/y/dist/src/structs/Item.js').AbstractContent;
declare type ContentType = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentType;
declare type ContentAny = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentAny;
declare type ContentDoc = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentDoc;
declare type ContentJSON = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentJSON;
declare type ContentEmbed = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentEmbed;
declare type ContentFormat = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentFormat;
declare type ContentDeleted = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentDeleted;
declare type ContentString = import('../../../node_modules/@y/y/dist/src/structs/Item.js').ContentString;
declare type DeltaConf = import('lib0/delta').DeltaConf;
declare type Delta<DConf extends DeltaConf> = import('lib0/delta').Delta<DConf>;
declare type StackItem = import('../../../node_modules/@y/y/dist/src/utils/UndoManager.js').StackItem;
declare type UndoManager = import('../../../node_modules/@y/y/dist/src/utils/UndoManager.js').UndoManager;
declare type AbstractRenderer = import('../../../node_modules/@y/y/dist/src/utils/renderer-helpers.js').AbstractRenderer;
declare type Attribution = import('../../../node_modules/@y/y/dist/src/utils/renderer-helpers.js').Attribution;
declare type AttributedContent<T = any> = import('../../../node_modules/@y/y/dist/src/utils/renderer-helpers.js').AttributedContent<T>;
declare type Snapshot = import('../../../node_modules/@y/y/dist/src/utils/Snapshot.js').Snapshot;
