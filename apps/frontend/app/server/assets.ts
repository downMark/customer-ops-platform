import { clientEntryId, staticBasePath } from "../../config/constants";

export interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
  isEntry?: boolean;
}

export type ViteManifest = Record<string, ManifestChunk>;

export interface AssetTags {
  links: string;
  scripts: string;
}

const toStaticPath = (file: string) => `${staticBasePath}${file}`;

const renderStyles = (files: Iterable<string>) =>
  Array.from(files)
    .map((file) => `<link rel="stylesheet" href="${toStaticPath(file)}">`)
    .join("");

const renderModulePreloads = (files: Iterable<string>) =>
  Array.from(files)
    .map((file) => `<link rel="modulepreload" crossorigin href="${toStaticPath(file)}">`)
    .join("");

const collectImportedChunks = (
  manifest: ViteManifest,
  chunk: ManifestChunk,
  seen = new Set<string>()
): ManifestChunk[] => {
  const importedChunks: ManifestChunk[] = [];

  for (const importKey of chunk.imports ?? []) {
    if (seen.has(importKey)) continue;
    seen.add(importKey);

    const importedChunk = manifest[importKey];
    if (!importedChunk) continue;

    importedChunks.push(importedChunk);
    importedChunks.push(...collectImportedChunks(manifest, importedChunk, seen));
  }

  return importedChunks;
};

const getEntryChunk = (manifest: ViteManifest) =>
  manifest[clientEntryId] ??
  Object.values(manifest).find((chunk) => chunk.isEntry);

export const getDevAssetTags = (): AssetTags => ({
  links: "",
  scripts: [
    '<script type="module" src="/@vite/client"></script>',
    '<script type="module" src="/app/client/index.tsx"></script>',
  ].join(""),
});

export const getProdAssetTags = (manifest: ViteManifest): AssetTags => {
  const entryChunk = getEntryChunk(manifest);
  if (!entryChunk) {
    throw new Error("Unable to find client entry in Vite manifest.");
  }

  const importedChunks = collectImportedChunks(manifest, entryChunk);
  const cssFiles = new Set<string>();
  const preloadFiles = new Set<string>();

  for (const chunk of [entryChunk, ...importedChunks]) {
    for (const cssFile of chunk.css ?? []) cssFiles.add(cssFile);
    if (chunk !== entryChunk) preloadFiles.add(chunk.file);
  }

  return {
    links: [renderModulePreloads(preloadFiles), renderStyles(cssFiles)].join(""),
    scripts: `<script type="module" crossorigin src="${toStaticPath(entryChunk.file)}"></script>`,
  };
};
