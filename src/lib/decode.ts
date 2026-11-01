import { t } from "./i18n";

/**
 * Turns a raw wallet request into a plain-language description.
 * Pure functions, no DOM and no chrome.* access, so later chunks can reuse them in the service worker.
 */

export type Severity = "high" | "medium";

export interface Finding {
  kind: "approve" | "approval-all" | "allowance" | "permit" | "permit2" | "raw-sign" | "order" | "typed" | "delegation" | "generic" | "solana";
  severity: Severity;
  title: string;
  /** Plain-language lines shown in the modal. */
  lines: string[];
  /** Unlimited token approval or operator approval for all tokens. Triggers the hygiene note. */
  openEnded: boolean;
  /** Short key/value details (spender, amount, contract). */
  details: Array<[string, string]>;
  /** Structured facts for the approval ledger. Only set when the request grants an actual approval. */
  approval?: ApprovalFacts;
  /** Prominent warning lines (address screening hits). Filled in by the bridge, shown above the other lines. */
  alerts?: string[];
  /** Amber caution lines (site memory, timing notes). Shown after the alerts, never a block on their own. */
  cautions?: string[];
  /** Solana only: delegates named by Approve instructions, for the approval-burst check. */
  spenders?: string[];
  /** What to look up on-chain for a readable wording (token symbol/decimals or collection name). */
  impact?: ImpactHint;
  /** Plain headline ("Unlimited USDC approval"), filled in by applyImpact when metadata resolved. */
  headline?: string;
  /** EIP-7702 only: the delegate contract addresses named by the authorization, for drainer-feed screening by the bridge. */
  delegates?: string[];
}

export interface ImpactHint {
  asset: string;
  kind: "erc20" | "collection";
  amount?: bigint;
  unlimited: boolean;
  chainId?: number;
}

/** What the ledger needs from a decoded approval. Owner and chain are filled in by the caller. */
export interface ApprovalFacts {
  kind: "unlimited-approve" | "approve" | "setApprovalForAll" | "permit" | "permit2";
  /** Token or collection address (lowercase when known). */
  asset: string;
  spender: string;
  unlimited: boolean;
  /** Chain id from the typed-data domain, when the request carries one. */
  chainId?: number;
}

const SEL_APPROVE = "0x095ea7b3";
const SEL_SET_APPROVAL_FOR_ALL = "0xa22cb465";
const SEL_INCREASE_ALLOWANCE = "0x39509351";

const MAX_UINT256 = (1n << 256n) - 1n;
/** Anything above this is treated as unlimited in practice. */
const UNLIMITED_FLOOR = MAX_UINT256 >> 8n;

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 8)}...${a.slice(-6)}` : a);
const word = (data: string, i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
const wordToAddr = (w: string) => "0x" + w.slice(24);
const wordToBig = (w: string) => BigInt("0x" + w);

/** Delegate (contract) addresses named by an EIP-7702 authorization list. Entries use "address" (spec) or common aliases. */
function delegateAddrs(list: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const a = o.address ?? o.contractAddress ?? o.delegate;
    if (typeof a === "string" && ADDR.test(a) && !out.includes(a)) out.push(a);
  }
  return out;
}

function delegationFinding(delegates: string[], method: string): Finding {
  return {
    kind: "delegation", severity: "high", openEnded: true,
    delegates,
    title: t("sw_dec_7702_title"),
    lines: [t("sw_dec_7702")],
    details: [
      [t("sw_find_label_method"), method],
      ...delegates.slice(0, 3).map((a): [string, string] => [t("sw_find_label_contract"), a]),
    ],
  };
}

/** True for a type-4 (EIP-7702) transaction: an authorization list, or an explicit type of 4. */
function isSetCodeTx(tx: Record<string, unknown>): boolean {
  const list = tx.authorizationList ?? tx.authorization_list;
  if (Array.isArray(list) && list.length > 0) return true;
  const ty = String(tx.type ?? "").toLowerCase();
  return ty === "0x4" || ty === "0x04" || ty === "4";
}

function decodeTx(tx: Record<string, unknown>): Finding | null {
  if (isSetCodeTx(tx)) return delegationFinding(delegateAddrs(tx.authorizationList ?? tx.authorization_list), "eth_sendTransaction");
  const data = typeof tx.data === "string" ? tx.data : typeof tx.input === "string" ? tx.input : "";
  if (!/^0x[0-9a-fA-F]{8}/.test(data)) return null;
  const sel = data.slice(0, 10).toLowerCase();
  const to = typeof tx.to === "string" ? tx.to : t("sw_find_unknown_contract");
  const body = data.length - 10;
  if (body < 128 || !/^0x[0-9a-fA-F]*$/.test(data)) return null;

  if (sel === SEL_SET_APPROVAL_FOR_ALL) {
    const operator = wordToAddr(word(data, 0));
    if (wordToBig(word(data, 1)) === 0n) return null; // revoking is safe
    return {
      kind: "approval-all", severity: "high", openEnded: true,
      title: t("sw_find_all_title"),
      lines: [
        t("sw_find_all_l1", [short(operator), short(to)]),
        t("sw_find_all_l2"),
      ],
      details: [[t("sw_find_label_operator"), operator], [t("sw_find_label_collection"), to]],
      approval: { kind: "setApprovalForAll", asset: to.toLowerCase(), spender: operator.toLowerCase(), unlimited: true },
      impact: { asset: to.toLowerCase(), kind: "collection", unlimited: true },
    };
  }
  if (sel === SEL_APPROVE || sel === SEL_INCREASE_ALLOWANCE) {
    const spender = wordToAddr(word(data, 0));
    const amount = wordToBig(word(data, 1));
    if (amount === 0n) return null; // revoking is safe
    const unlimited = amount >= UNLIMITED_FLOOR;
    return {
      kind: sel === SEL_APPROVE ? "approve" : "allowance",
      severity: unlimited ? "high" : "medium",
      openEnded: unlimited,
      title: unlimited ? t("sw_find_unl_title") : t("sw_find_lim_title"),
      lines: [
        unlimited
          ? t("sw_find_unl_l1", [short(spender), short(to)])
          : t("sw_find_lim_l1", [short(spender), amount.toString(), short(to)]),
        unlimited ? t("sw_find_unl_l2") : t("sw_find_lim_l2"),
      ],
      details: [[t("sw_find_label_spender"), spender], [t("sw_find_label_token"), to], [t("sw_find_label_amount"), unlimited ? t("sw_find_unlimited") : amount.toString()]],
      approval: { kind: unlimited ? "unlimited-approve" : "approve", asset: to.toLowerCase(), spender: spender.toLowerCase(), unlimited },
      impact: { asset: to.toLowerCase(), kind: "erc20", amount, unlimited },
    };
  }
  return null;
}

function parseTyped(raw: unknown): Record<string, unknown> | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

function big(v: unknown): bigint | null {
  try { return v === undefined || v === null ? null : BigInt(String(v)); } catch { return null; }
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;

function domainChainId(dom: Record<string, unknown>): number | undefined {
  const c = big(dom.chainId);
  return c !== null && c > 0n && c < 1n << 53n ? Number(c) : undefined;
}

/** ERC-2612: the verifying contract is the token. Permit2: the token sits inside the message details. */
function permitAsset(msg: Record<string, unknown>, verifying: string): string {
  const d = msg.details;
  const first = Array.isArray(d) ? d[0] : d;
  const tok = (first as Record<string, unknown> | undefined)?.token ?? msg.token;
  const a = typeof tok === "string" && ADDR.test(tok) ? tok : verifying;
  return a.toLowerCase();
}

/**
 * NFT marketplace exchanges whose typed-data orders move assets once signed (lowercase):
 * Seaport 1.1, 1.4, 1.5, 1.6 and the OpenSea conduit, plus the Blur exchange.
 */
const ORDER_CONTRACTS = new Set([
  "0x00000000006c3852cbef3e08e8df289169ede581",
  "0x00000000000001ad428e4906ae43d8f9852d0dd6",
  "0x00000000000000adc04c56bf30ac9d3c0aaf14dc",
  "0x0000000000000068f116a894984e2db1123eb395",
  "0x1e0049783f008a0085193e00003d00cd54003c71",
  "0x000000000000ad05ccc4f10045630fb830b95127",
]);
const ORDER_PRIMARY = /^(OrderComponents|OrderParameters|BasicOrderParameters|BulkOrder|Order|ListingOrder|AskOrder|BidOrder|Ask|Bid)$/;

/** Seaport / Blur style order: by primary type, by the offer+consideration (or trader+collection) shape, or by a known exchange contract. */
function isOrderShaped(primary: string, msg: Record<string, unknown>, verifying: string): boolean {
  if (ORDER_CONTRACTS.has(verifying.toLowerCase())) return true;
  if (ORDER_PRIMARY.test(primary)) return true;
  if (Array.isArray(msg.offer) && Array.isArray(msg.consideration)) return true;
  if (msg.trader !== undefined && msg.collection !== undefined) return true; // Blur order
  if (primary === "BulkOrder" || (Array.isArray(msg.tree) && /order/i.test(primary))) return true;
  return false;
}

function decodeTyped(raw: unknown): Finding | null {
  const td = parseTyped(raw);
  // A malformed typed payload is not a known drain vector on its own; strict mode still holds it (see bridge.ts).
  if (!td) return null;
  const primary = String(td.primaryType ?? "");
  const msg = (td.message ?? {}) as Record<string, unknown>;
  const dom = (td.domain ?? {}) as Record<string, unknown>;
  const verifying = typeof dom.verifyingContract === "string" ? dom.verifyingContract : t("sw_find_unknown");
  const isPermit2 = /^Permit(Single|Batch|TransferFrom|BatchTransferFrom|WitnessTransferFrom)$/.test(primary);
  if (primary !== "Permit" && !isPermit2) {
    // NFT marketplace listing/bid orders (Seaport/Blur) authorize asset transfers once signed, so hold them. Other
    // typed data (logins, votes, off-chain messages) is not a drain vector by itself and is not held in the default
    // mode; strict mode and a flagged wallet still confirm it (see bridge.ts genericFinding).
    if (isOrderShaped(primary, msg, verifying)) {
      const typeRows: Array<[string, string]> = [[t("sw_find_label_contract"), verifying], [t("sw_find_label_type"), primary || t("sw_find_unknown")]];
      return { kind: "order", severity: "high", openEnded: true, title: t("sw_dec_order_title"), lines: [t("sw_dec_order")], details: typeRows };
    }
    return null;
  }

  let spender = msg.spender;
  let amounts: Array<bigint | null> = [big(msg.value ?? msg.amount)];
  const details = msg.details;
  if (Array.isArray(details)) {
    amounts = details.map((d) => big((d as Record<string, unknown>)?.amount));
    spender = spender ?? (details[0] as Record<string, unknown> | undefined)?.spender;
  } else if (details && typeof details === "object") {
    amounts = [big((details as Record<string, unknown>).amount)];
    spender = spender ?? (details as Record<string, unknown>).spender;
  }
  // Permit2 amounts are uint160, ERC-2612 values are uint256.
  const floor = isPermit2 ? (1n << 160n) - 1n >> 8n : UNLIMITED_FLOOR;
  const unlimited = amounts.some((a) => a !== null && a >= floor);
  const sp = typeof spender === "string" ? spender : t("sw_find_unknown");
  const asset = permitAsset(msg, verifying);
  const firstAmt = amounts.find((a) => a !== null);
  // Permit2 without a token in the message would point at the Permit2 contract itself: no lookup then
  const impact: ImpactHint | undefined = ADDR.test(asset) && !(isPermit2 && asset === verifying.toLowerCase())
    ? { asset, kind: "erc20", amount: firstAmt ?? undefined, unlimited, chainId: domainChainId(dom) }
    : undefined;
  return {
    kind: isPermit2 ? "permit2" : "permit", severity: "high", openEnded: unlimited,
    title: isPermit2 ? t("sw_find_permit2_title") : t("sw_find_permit_title"),
    lines: [
      t(unlimited ? "sw_find_permit_l1_unl" : "sw_find_permit_l1", short(sp)),
      t("sw_find_permit_l2"),
    ],
    details: [[t("sw_find_label_spender"), sp], [t("sw_find_label_contract"), verifying], [t("sw_find_label_type"), primary]],
    approval: {
      kind: isPermit2 ? "permit2" : "permit", asset: permitAsset(msg, verifying), spender: sp.toLowerCase(), unlimited,
      chainId: domainChainId(dom),
    },
    impact,
  };
}

function hexToText(h: string): string | null {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(h)) return null;
  try {
    const bytes = new Uint8Array((h.length - 2) / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(2 + i * 2, 4 + i * 2), 16);
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /^[\x09\x0a\x0d\x20-\x7e\xa0-\uffff]*$/.test(s) ? s : null;
  } catch { return null; }
}

function decodeRawSign(method: string, params: unknown[]): Finding {
  // personal_sign: [message, address]; eth_sign: [address, message]
  const msgParam = method === "eth_sign" ? params[1] : params[0];
  const text = typeof msgParam === "string" ? hexToText(msgParam) : null;
  const isEthSign = method === "eth_sign";
  const lines = text !== null
    ? [t("sw_find_raw_text")]
    : [t("sw_find_raw_blind")];
  if (isEthSign) lines.push(t("sw_find_ethsign_warn"));
  const shown = text !== null ? (text.length > 400 ? text.slice(0, 400) + "..." : text) : String(msgParam ?? "").slice(0, 120);
  return {
    kind: "raw-sign", severity: isEthSign || text === null ? "high" : "medium", openEnded: false,
    title: isEthSign ? t("sw_find_ethsign_title") : t("sw_find_msg_title"),
    lines,
    details: [[t("sw_find_label_method"), method], [t("sw_find_label_message"), shown]],
  };
}

const SEL_TRANSFER = "0xa9059cbb";
const SEL_TRANSFER_FROM = "0x23b872dd";

/**
 * The address on the other side of a held request: the spender for approvals and permits,
 * the recipient for a plain transfer (native send, ERC-20 transfer/transferFrom). Null when not decodable.
 */
export function counterpartyOf(method: string, params: unknown, f: Finding): { role: "Spender" | "Recipient"; address: string } | null {
  if (f.approval && ADDR.test(f.approval.spender)) return { role: "Spender", address: f.approval.spender.toLowerCase() };
  const p = Array.isArray(params) ? params : [];
  if (method !== "eth_sendTransaction" || !p[0] || typeof p[0] !== "object") return null;
  const tx = p[0] as Record<string, unknown>;
  const data = typeof tx.data === "string" ? tx.data : typeof tx.input === "string" ? tx.input : "";
  const to = typeof tx.to === "string" && ADDR.test(tx.to) ? tx.to.toLowerCase() : null;
  if (data === "" || data === "0x") return to ? { role: "Recipient", address: to } : null;
  const sel = data.slice(0, 10).toLowerCase();
  if (/^0x[0-9a-fA-F]*$/.test(data) && data.length >= 10 + 64) {
    if (sel === SEL_TRANSFER) return { role: "Recipient", address: wordToAddr(word(data, 0)).toLowerCase() };
    if (sel === SEL_TRANSFER_FROM && data.length >= 10 + 128) return { role: "Recipient", address: wordToAddr(word(data, 1)).toLowerCase() };
  }
  return null;
}

/** eth_signTypedData params are [address, data]; some older callers swap them. Returns the data element. */
function typedParam(p: unknown[]): unknown {
  if (ADDR.test(String(p[0]))) return p[1];
  if (ADDR.test(String(p[1]))) return p[0];
  return p[1] ?? p[0];
}

/**
 * Plain confirmation finding for a request that analyze() has nothing specific to say about
 * (used by strict mode and when a suspicious wallet was announced on the page).
 */
export function genericFinding(method: string, params: unknown): Finding {
  const p = Array.isArray(params) ? params : [];
  const details: Array<[string, string]> = [[t("sw_find_label_method"), method]];
  if (method === "eth_sendTransaction" && p[0] && typeof p[0] === "object") {
    const tx = p[0] as Record<string, unknown>;
    if (typeof tx.to === "string") details.push([t("sw_find_label_contract"), tx.to]);
    if (typeof tx.value === "string") details.push([t("sw_find_label_amount"), tx.value]);
  }
  return { kind: "generic", severity: "medium", openEnded: false, title: method, lines: [t("sw_find_raw_blind")], details };
}

/** Returns a finding if the request deserves a hold, otherwise null. */
export function analyze(method: string, params: unknown): Finding | null {
  const p = Array.isArray(params) ? params : [];
  switch (method) {
    case "eth_sendTransaction":
      return p[0] && typeof p[0] === "object" ? decodeTx(p[0] as Record<string, unknown>) : null;
    case "eth_signTypedData":
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4":
      return decodeTyped(typedParam(p));
    case "eth_signAuthorization":
    case "wallet_signAuthorization": {
      // EIP-7702 authorization signing: the first param names the delegate contract.
      const a = p[0] && typeof p[0] === "object" ? [p[0]] : [];
      return delegationFinding(delegateAddrs(a), method);
    }
    case "personal_sign":
    case "eth_sign":
      return decodeRawSign(method, p);
    default:
      return null;
  }
}
