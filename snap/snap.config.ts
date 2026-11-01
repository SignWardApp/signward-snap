import type { SnapConfig } from "@metamask/snaps-cli";
import { resolve } from "node:path";

const config: SnapConfig = {
  input: resolve(import.meta.dirname, "src/index.tsx"),
  server: { port: 8080 },
  polyfills: false,
  stats: { buffer: false },
  customizeWebpackConfig: (webpackConfig) => {
    // The shared decoder (../src/lib/decode.ts) imports "./i18n", which needs chrome.i18n.
    // Swap it for the Snap's own English lookup. Only that one module is replaced.
    webpackConfig.resolve = webpackConfig.resolve ?? {};
    webpackConfig.resolve.alias = {
      ...(webpackConfig.resolve.alias as Record<string, string> | undefined),
      "./i18n$": resolve(import.meta.dirname, "src/i18n-shim.ts"),
    };
    return webpackConfig;
  },
};

export default config;
