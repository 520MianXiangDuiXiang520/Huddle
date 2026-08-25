// Node-side shim so the shared runtime's ArkTS `ESObject` type-checks under tsc.
// ArkTS provides ESObject natively; for the node smoke test we alias it to any.
declare type ESObject = any;
