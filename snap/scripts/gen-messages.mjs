// Extracts the English strings the shared decoder needs from the extension's locale file.
// Source: ../public/_locales/en/messages.json (read only). Output is sorted so builds stay deterministic.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(here, "../../public/_locales/en/messages.json"), "utf8"));
const out = {};
for (const k of Object.keys(src).sort()) {
  if (/^sw_(dec|find|hl)_/.test(k)) out[k] = src[k].message;
}
writeFileSync(join(here, "../src/messages.gen.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`messages.gen.json: ${Object.keys(out).length} strings`);
