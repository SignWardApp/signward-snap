/**
 * Pure verdict logic: no Snap APIs, no network. Maps MetaMask insight payloads onto the extension's decoders
 * (../../src/lib/decode.ts, hyperliquid.ts, registrable.ts) and applies the community feeds.
 */
import { analyze, counterpartyOf, genericFinding, type Finding } from "../../src/lib/decode";
import { analyzeHyperliquid } from "../../src/lib/hyperliquid";
import { registrableOf } from "../../src/lib/registrable";
import { KNOWN_SPENDERS } from "./known";

export interface Community { updatedAt?: number; domains?: string[]; auto?: string[]; allow?: string[]; badIps?: string[] }
export interface AddrEntry { addr: string; chain?: string | number; kind?: string; exp?: number }
export interface AddrFeed { updatedAt?: number; addrs?: AddrEntry[] }
export interface Feed { community: Community | null; addrs: AddrFeed | null }

export interface Verdict {
  critical: boolean;
  /** Plain-English reasons for the critical flag (empty when calm). */
  reasons: string[];
  finding: Finding | null;
  /** Hostname the request came from, when MetaMask provided it. */
  origin: string | null;
  /** Spender/recipient shown in the panel. */
  counterparty: { role: "Spender" | "Recipient"; address: string } | null;
  /** Extra plain lines (native amount, expiry). */
  notes: string[];
}

/** Upper bound on signature data we are willing to parse (characters). */
const MAX_SIGNATURE_DATA = 262144;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}...${a.slice(-6)}` : a);

export function normAddr(a: unknown): string | null {
  return typeof a === "string" && ADDR.test(a) ? a.toLowerCase() : null;
}

/** "eip155:1" -> 1, "0x1" -> 1, 1 -> 1. */
export function parseChainId(c: unknown): number | undefined {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c !== "string") return undefined;
  const m = /^eip155:(\d+)$/.exec(c) ?? /^(\d+)$/.exec(c);
  if (m) return Number(m[1]);
  if (/^0x[0-9a-fA-F]+$/.test(c)) return parseInt(c, 16);
  return undefined;
}

/** Hostname of an origin like "https://app.example.com:8443/path". No URL class needed. */
export function hostOf(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(origin.trim());
  if (!m) return null;
  const h = m[1].replace(/^[^@]*@/, "").replace(/:\d+$/, "").toLowerCase().replace(/\.$/, "");
  return h || null;
}

function toSet(list: unknown): Set<string> {
  return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : []);
}

/** The matched list entry when the origin is blocked by the community lists and not allowlisted, else null. */
export function originBlocked(origin: unknown, c: Community | null): string | null {
  if (!c) return null;
  const host = hostOf(origin);
  if (!host) return null;
  const reg = registrableOf(host);
  const keys = [host, reg].filter((x): x is string => !!x);
  const allow = toSet(c.allow);
  if (keys.some((k) => allow.has(k))) return null;
  const bad = new Set([...toSet(c.domains), ...toSet(c.auto), ...toSet(c.badIps)]);
  return keys.find((k) => bad.has(k)) ?? null;
}

/** exp may be unix seconds or milliseconds; missing/0 means no expiry. */
function expired(exp: unknown, now: number): boolean {
  if (typeof exp !== "number" || !exp) return false;
  const ms = exp < 1e12 ? exp * 1000 : exp;
  return ms <= now;
}

export function addrHit(address: unknown, chainId: number | undefined, f: AddrFeed | null, now: number): AddrEntry | null {
  const a = normAddr(address);
  if (!a || !f || !Array.isArray(f.addrs)) return null;
  for (const e of f.addrs) {
    if (!e || normAddr(e.addr) !== a) continue;
    if (expired(e.exp, now)) continue;
    const ec = parseChainId(e.chain);
    if (ec !== undefined && chainId !== undefined && ec !== chainId) continue;
    return e;
  }
  return null;
}

export function isKnownSpender(a: unknown): boolean {
  const n = normAddr(a);
  return !!n && KNOWN_SPENDERS.has(n);
}

function weiToEth(hex: unknown): string | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  const v = BigInt(hex);
  if (v === 0n) return null;
  const unit = 10n ** 18n;
  const frac = (v % unit).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${v / unit}.${frac}` : `${v / unit}`;
}

function expiryNote(typed: unknown): string | null {
  try {
    const td = (typeof typed === "string" ? JSON.parse(typed) : typed) as Record<string, any> | null;
    const msg = td?.message ?? {};
    const d = Array.isArray(msg.details) ? msg.details[0] : msg.details;
    const raw = d?.expiration ?? msg.deadline ?? msg.sigDeadline ?? msg.expiration;
    if (raw === undefined || raw === null) return null;
    const n = BigInt(String(raw));
    if (n >= 1n << 47n) return "The permission never expires.";
    return `The permission expires on ${new Date(Number(n) * 1000).toISOString().slice(0, 10)}.`;
  } catch { return null; }
}

function judge(
  method: string, params: unknown[], origin: unknown, chainId: number | undefined, feed: Feed, now: number, typed: unknown,
): Verdict {
  const reasons: string[] = [];
  const notes: string[] = [];
  const host = hostOf(origin);

  if (originBlocked(origin, feed.community)) {
    reasons.push(`The site you are on (${host}) is on Signward's community list of phishing and drainer sites.`);
  }

  // A Hyperliquid signature on any site that is not an official Hyperliquid app is critical by itself.
  const hl = analyzeHyperliquid(method, params, host ?? "");
  const finding = hl ?? analyze(method, params);
  const f0 = finding ?? genericFinding(method, params);
  const cp = counterpartyOf(method, params, f0);

  if (cp) {
    const e = addrHit(cp.address, chainId, feed.addrs, now);
    if (e) reasons.push(`${cp.role} ${short(cp.address)} is on Signward's drainer address feed${e.kind ? ` (${e.kind})` : ""}.`);
  }
  for (const d of finding?.delegates ?? []) {
    if (addrHit(d, chainId, feed.addrs, now)) reasons.push(`The delegate contract ${short(d)} is on Signward's drainer address feed.`);
  }
  const tx = method === "eth_sendTransaction" ? (params[0] as Record<string, unknown> | undefined) : undefined;
  const to = normAddr(tx?.to);
  if (to && to !== cp?.address && addrHit(to, chainId, feed.addrs, now)) {
    reasons.push(`The contract you are calling (${short(to)}) is on Signward's drainer address feed.`);
  }

  if (hl) {
    reasons.push(`This is a Hyperliquid signature requested by ${host ?? "an unknown site"}, which is not an official Hyperliquid app. Funds on Hyperliquid move with signatures like this one.`);
    // The shared finding opens with the same warning; the reason above already says it.
    hl.lines = hl.lines.slice(1);
  }

  if (finding && !hl) {
    const spender = finding.approval?.spender;
    const k = finding.kind;
    const grant = k === "approval-all" || ((k === "approve" || k === "allowance") && finding.openEnded) || k === "permit" || k === "permit2";
    if (grant && !isKnownSpender(spender)) {
      const who = spender && ADDR.test(spender) ? short(spender) : "an unknown address";
      const what = k === "approval-all" ? "every token in a collection" : finding.openEnded ? "an unlimited amount of a token" : "your tokens";
      reasons.push(`This gives ${who} permission to spend ${what}, and ${who} is not a well-known protocol contract. This is how wallet drainers work.`);
    }
    if (k === "delegation") reasons.push("This hands control of your account to a contract (EIP-7702). Only do this for a wallet you chose to upgrade.");
  }

  if (tx && !finding) {
    const eth = weiToEth(tx.value);
    if (eth && cp?.role === "Recipient") notes.push(`Sends ${eth} of the chain's native coin (ETH on Ethereum) to ${cp.address}.`);
    else if (eth) notes.push(`Sends ${eth} of the chain's native coin along with a contract call.`);
    if (!cp && typeof tx.data === "string" && tx.data.length >= 10) {
      notes.push(`Calls a contract method (${tx.data.slice(0, 10)}) that Signward does not recognize.`);
    }
  }
  if (finding && (finding.kind === "permit" || finding.kind === "permit2")) {
    const n = expiryNote(typed);
    if (n) notes.push(n);
  }

  return { critical: reasons.length > 0, reasons, finding, origin: host, counterparty: cp, notes };
}

export interface TxInput {
  transaction: { from?: string; to?: string | null; data?: string; value?: string; [k: string]: unknown };
  chainId?: string;
  transactionOrigin?: string | null;
}

export function evaluateTransaction(input: TxInput, feed: Feed, now = Date.now()): Verdict {
  const t = input.transaction ?? {};
  const tx: Record<string, unknown> = { from: t.from, to: t.to ?? undefined, data: t.data ?? "0x", value: t.value };
  for (const k of ["type", "authorizationList"]) if (t[k] !== undefined) tx[k] = t[k];
  return judge("eth_sendTransaction", [tx], input.transactionOrigin, parseChainId(input.chainId), feed, now, undefined);
}

export interface SigInput {
  signature: { from?: string; data?: unknown; signatureMethod?: string };
  signatureOrigin?: string | null;
}

export function evaluateSignature(input: SigInput, feed: Feed, now = Date.now()): Verdict {
  const s = input.signature ?? {};
  const method = String(s.signatureMethod ?? "");
  // Bounded parsing: MetaMask sends typed data as a string; refuse absurd sizes (the handler then fails open).
  if (typeof s.data === "string" && s.data.length > MAX_SIGNATURE_DATA) throw new Error("signature data too large");
  const from = s.from ?? "";
  const params: unknown[] = method === "personal_sign" ? [s.data, from] : [from, s.data];
  let chainId: number | undefined;
  if (method.startsWith("eth_signTypedData")) {
    try {
      const td = (typeof s.data === "string" ? JSON.parse(s.data) : s.data) as any;
      chainId = parseChainId(td?.domain?.chainId);
    } catch { /* ignore */ }
  }
  return judge(method, params, input.signatureOrigin, chainId, feed, now, s.data);
}
