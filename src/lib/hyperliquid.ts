/**
 * Hyperliquid typed-data signatures (pure: no DOM, no chrome.*).
 *
 * HyperCore balances move with EIP-712 signatures that never appear in EVM logs, so a drainer page only needs one signature.
 * Names checked against hyperliquid-dex/hyperliquid-python-sdk (hyperliquid/utils/signing.py) and the official exchange endpoint docs:
 *  - user-signed actions: domain {name: "HyperliquidSignTransaction", version: "1", chainId: <signatureChainId>, verifyingContract: 0x0},
 *    primaryType "HyperliquidTransaction:<Action>", message starts with hyperliquidChain ("Mainnet" | "Testnet").
 *    signatureChainId is wallet-chosen ("0xa4b1" in the docs, 0x66eee in the SDK), so the chain id is never matched.
 *  - L1 actions (orders, cancels, vault transfers ...): domain {name: "Exchange", version: "1", chainId: 1337, verifyingContract: 0x0},
 *    primaryType "Agent", message {source: "a" | "b", connectionId: bytes32}. The action itself is hashed into connectionId and cannot be read.
 */
import { t } from "./i18n";
import type { Finding } from "./decode";

/** Hostnames of the official Hyperliquid apps. Anything else asking for a Hyperliquid signature is held. */
export const HYPERLIQUID_OFFICIAL_HOSTS: readonly string[] = ["app.hyperliquid.xyz", "app.hyperliquid-testnet.xyz"];

export const HL_USER_DOMAIN = "HyperliquidSignTransaction";
export const HL_L1_DOMAIN = "Exchange";
export const HL_L1_CHAIN_ID = 1337;

export function isOfficialHyperliquidHost(hostname: string): boolean {
  return HYPERLIQUID_OFFICIAL_HOSTS.includes(String(hostname ?? "").trim().toLowerCase());
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;
/** Actions that move funds or hand out control: always high risk off the official app. */
const HIGH = new Set(["Withdraw", "UsdSend", "SpotSend", "SendAsset", "SendToEvmWithData", "ApproveAgent", "ConvertToMultiSigUser", "SendMultiSig"]);

export type HlKind = "user" | "l1";
export interface HlInfo { kind: HlKind; action: string; message: Record<string, unknown> }

function parse(raw: unknown): Record<string, unknown> | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** eth_signTypedData params are [address, data]; some older callers swap them. */
function typedParam(p: unknown[]): unknown {
  if (ADDR.test(String(p[0]))) return p[1];
  if (ADDR.test(String(p[1]))) return p[0];
  return p[1] ?? p[0];
}

/** Recognises a Hyperliquid typed-data payload, or null. */
export function detectHyperliquid(typed: unknown): HlInfo | null {
  const td = parse(typed);
  if (!td) return null;
  const dom = (td.domain && typeof td.domain === "object" ? td.domain : {}) as Record<string, unknown>;
  const primary = String(td.primaryType ?? "");
  const message = (td.message && typeof td.message === "object" ? td.message : {}) as Record<string, unknown>;
  if (dom.name === HL_USER_DOMAIN) {
    const m = primary.match(/^HyperliquidTransaction:([A-Za-z0-9]{1,40})$/);
    return { kind: "user", action: m ? m[1] : (primary.slice(0, 60) || "Unknown"), message };
  }
  if (dom.name === HL_L1_DOMAIN && primary === "Agent" && Number(dom.chainId) === HL_L1_CHAIN_ID && message.connectionId !== undefined) {
    return { kind: "l1", action: "Agent", message };
  }
  return null;
}

const str = (v: unknown, max = 80): string => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");
const shortAddr = (a: string): string => (a.length > 14 ? `${a.slice(0, 8)}...${a.slice(-6)}` : a);

/**
 * Finding for a Hyperliquid signature requested on `hostname`, or null when the payload is not Hyperliquid or the site is an
 * official Hyperliquid app. Trusted sites are skipped by the caller (bridge.ts) before analysis runs.
 */
export function analyzeHyperliquid(method: string, params: unknown, hostname: string): Finding | null {
  if (method !== "eth_signTypedData" && method !== "eth_signTypedData_v3" && method !== "eth_signTypedData_v4") return null;
  const p = Array.isArray(params) ? params : [];
  const info = detectHyperliquid(typedParam(p));
  if (!info || isOfficialHyperliquidHost(hostname)) return null;

  const title = t("sw_hl_title");
  if (info.kind === "l1") {
    return {
      kind: "typed", severity: "medium", openEnded: false, title,
      lines: [t("sw_hl_wrong_site"), t("sw_hl_l1")],
      details: [[t("sw_find_label_type"), "Agent (Exchange)"]],
    };
  }

  const m = info.message;
  const dest = str(m.destination, 64);
  const amount = str(m.amount, 40);
  const token = str(m.token, 80);
  const lines: string[] = [t("sw_hl_wrong_site")];
  const details: Array<[string, string]> = [[t("sw_find_label_type"), info.action]];
  const destRow = (): void => { if (dest) details.push([t("sw_find_label_recipient"), dest]); };

  switch (info.action) {
    case "Withdraw":
      lines.push(t("sw_hl_withdraw", [amount || "?", dest ? shortAddr(dest) : "?"]));
      destRow(); details.push([t("sw_find_label_amount"), amount || "?"], [t("sw_find_label_token"), "USDC"]);
      break;
    case "UsdSend":
      lines.push(t("sw_hl_usdsend", [amount || "?", dest ? shortAddr(dest) : "?"]));
      destRow(); details.push([t("sw_find_label_amount"), amount || "?"], [t("sw_find_label_token"), "USDC"]);
      break;
    case "SpotSend":
    case "SendAsset":
    case "SendToEvmWithData":
      lines.push(t("sw_hl_send", [amount || "?", token || "?", dest ? shortAddr(dest) : "?"]));
      destRow(); details.push([t("sw_find_label_amount"), amount || "?"], [t("sw_find_label_token"), token || "?"]);
      break;
    case "ApproveAgent": {
      const agent = str(m.agentAddress, 64);
      lines.push(t("sw_hl_agent", [agent ? shortAddr(agent) : "?"]));
      if (agent) details.push([t("sw_find_label_agent"), agent]);
      const name = str(m.agentName, 40);
      if (name) details.push([t("sw_find_label_name"), name]);
      break;
    }
    case "ConvertToMultiSigUser":
    case "SendMultiSig":
      lines.push(t("sw_hl_multisig"));
      break;
    case "ApproveBuilderFee": {
      const builder = str(m.builder, 64);
      lines.push(t("sw_hl_builder", [builder ? shortAddr(builder) : "?", str(m.maxFeeRate, 20) || "?"]));
      if (builder) details.push([t("sw_find_label_spender"), builder]);
      break;
    }
    default:
      lines.push(t("sw_hl_other", [info.action]));
      if (amount) details.push([t("sw_find_label_amount"), amount]);
      break;
  }
  return { kind: "typed", severity: HIGH.has(info.action) ? "high" : "medium", openEnded: false, title, lines, details };
}
