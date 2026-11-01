/** Pure registrable-domain helper (no DOM, no chrome.*). Handles a short list of common multi-part suffixes. */
const MULTI = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "or.jp", "ne.jp",
  "co.kr", "or.kr", "com.br", "net.br", "com.tr", "org.tr", "net.tr", "com.cn", "net.cn", "org.cn", "com.hk",
  "com.tw", "com.sg", "com.my", "com.mx", "com.ar", "com.co", "com.ua", "co.in", "net.in", "org.in", "co.id",
  "co.za", "com.ng", "com.vn", "com.ph", "com.pk", "com.eg", "com.sa", "co.il", "co.th",
]);

/**
 * Free hosting / site-builder suffixes: the label to the LEFT is the unit a tenant controls, so the registrable
 * domain is one label longer than the suffix (foo.github.io -> foo.github.io, not github.io). Keeping these precise
 * is what stops an allowlist, a local block or an auto-list on one tenant from covering the whole platform.
 */
export const FREE_HOST_SUFFIX = new Set([
  "github.io", "netlify.app", "vercel.app", "pages.dev", "web.app", "firebaseapp.com", "workers.dev", "herokuapp.com",
  "glitch.me", "replit.app", "repl.co", "framer.app", "framer.website", "webflow.io", "wixsite.com", "blogspot.com",
  "weebly.com", "godaddysites.com", "notion.site", "carrd.co", "surge.sh", "onrender.com", "fleek.co", "lovable.app",
  "000webhostapp.com", "typedream.app", "gitbook.io", "ipfs.io", "dweb.link", "w3spaces.com", "square.site",
]);

/** Registrable domain of a hostname, or null for IPs, single labels and empty input. */
export function registrableOf(hostname: string): string | null {
  const h = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!h || !h.includes(".")) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  const parts = h.split(".");
  if (parts.some((p) => !p)) return null;
  const last2 = parts.slice(-2).join(".");
  const take = (MULTI.has(last2) || FREE_HOST_SUFFIX.has(last2)) && parts.length >= 3 ? 3 : 2;
  return parts.slice(-take).join(".");
}

export interface DomAgeMsg { type: "sw:domage"; registrable: string }
export interface DomAgeReply { ok: boolean; ageDays?: number }

/** Young-domain thresholds and weights. */
export const NEW_DOMAIN_STRONG_DAYS = 7;
export const NEW_DOMAIN_MEDIUM_DAYS = 30;
export const NEW_DOMAIN_STRONG_WEIGHT = 40;
export const NEW_DOMAIN_MEDIUM_WEIGHT = 20;

export function newDomainWeight(days: number): number {
  if (!(days >= 0)) return 0;
  if (days < NEW_DOMAIN_STRONG_DAYS) return NEW_DOMAIN_STRONG_WEIGHT;
  if (days < NEW_DOMAIN_MEDIUM_DAYS) return NEW_DOMAIN_MEDIUM_WEIGHT;
  return 0;
}
