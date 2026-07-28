// Keep the independently versioned SDK as a local path dependency, but import
// its source here so Mastra bundles it instead of resolving a private registry.
export * from "../../performance/sdk/typescript/src/index";
