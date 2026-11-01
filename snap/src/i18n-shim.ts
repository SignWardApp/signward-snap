// Replaces ../src/lib/i18n.ts inside the Snap bundle (see snap.config.ts).
// The extension reads strings through chrome.i18n; a Snap has no chrome.*, so we serve the same English
// strings from messages.gen.json (generated from public/_locales/en by scripts/gen-messages.mjs).
import messages from "./messages.gen.json";

export type Sub = string | number | ReadonlyArray<string | number>;

export function t(key: string, sub?: Sub): string {
  const raw = (messages as Record<string, string>)[key];
  if (!raw) return key;
  const subs = sub === undefined ? [] : (Array.isArray(sub) ? sub : [sub]).map(String);
  return raw.replace(/\$(\d)/g, (_m, n: string) => subs[Number(n) - 1] ?? "");
}
