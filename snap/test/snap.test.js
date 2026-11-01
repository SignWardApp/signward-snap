import { installSnap } from "@metamask/snaps-jest";

const FAR = Math.floor(Date.now() / 1000) + 86400 * 30;
const DRAINER = "0xdeadbeef00000000000000000000000000000bad";
const OK_FROM = "0x1111111111111111111111111111111111111111";
const TOKEN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const UR = "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad";
const UNKNOWN = "0x2222222222222222222222222222222222222222";
const word = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const MAX = "f".repeat(64);

const state = {
  community: { updatedAt: 1, domains: ["evil-drain.xyz"], auto: ["auto-bad.top"], allow: ["safe-site.com"], badIps: [] },
  addrs: {
    updatedAt: 1,
    addrs: [
      { addr: DRAINER, chain: "eip155:1", kind: "spender", exp: FAR },
      { addr: "0x3333333333333333333333333333333333333333", kind: "receiver", exp: 1 },
    ],
  },
  communityAt: Date.now(),
  addrsAt: Date.now(),
};

const approve = (spender, amt = MAX) => ({ from: OK_FROM, to: TOKEN, value: "0x0", data: "0x095ea7b3" + word(spender) + amt });
const permit2 = (spender) => ({
  types: {},
  primaryType: "PermitSingle",
  domain: { name: "Permit2", chainId: 1, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
  message: {
    details: { token: TOKEN, amount: "1461501637330902918203684832716283019655932542975", expiration: "1900000000", nonce: "0" },
    spender,
    sigDeadline: "1900000000",
  },
});

const run = async (st, fn) => {
  const snap = await installSnap({ options: { unencryptedState: st } });
  return fn(snap);
};
const res = (r) => (r.response && (r.response.result || r.response)) || null;
const text = (r) => JSON.stringify(res(r));
const tx = (snap, o, t) => snap.onTransaction({ chainId: "eip155:1", origin: "https://app.uniswap.org", ...t, ...(o || {}) });
const sig = (snap, method, data, origin = "https://app.uniswap.org") =>
  snap.onSignature({ from: OK_FROM, origin, signatureMethod: method, data });

describe("Signward snap", () => {
  it("blocklisted origin is critical", async () => {
    const r = await run(state, (s) => tx(s, { origin: "https://www.evil-drain.xyz" }, { from: OK_FROM, to: UNKNOWN, value: "0x1", data: "0x" }));
    expect(res(r).severity).toBe("critical");
    expect(text(r)).toContain("community list");
  });

  it("auto-listed origin is critical, allowlisted is not", async () => {
    const a = await run(state, (s) => tx(s, { origin: "https://auto-bad.top" }, { from: OK_FROM, to: UNKNOWN, value: "0x1", data: "0x" }));
    expect(res(a).severity).toBe("critical");
    const st2 = { ...state, community: { ...state.community, domains: ["safe-site.com"] } };
    const b = await run(st2, (s) => tx(s, { origin: "https://safe-site.com" }, { from: OK_FROM, to: UNKNOWN, value: "0x1", data: "0x" }));
    expect(res(b).severity).toBeUndefined();
  });

  it("drainer spender in addrs is critical", async () => {
    const r = await run(state, (s) => tx(s, {}, approve(DRAINER, "0".repeat(62) + "64")));
    expect(res(r).severity).toBe("critical");
    expect(text(r)).toContain("drainer address feed");
  });

  it("unlimited approval to unknown spender is critical", async () => {
    const r = await run(state, (s) => tx(s, {}, approve(UNKNOWN)));
    expect(res(r).severity).toBe("critical");
  });

  it("unlimited approval to Uniswap Universal Router is not critical", async () => {
    const r = await run(state, (s) => tx(s, {}, approve(UR)));
    expect(res(r).severity).toBeUndefined();
  });

  it("Permit2 PermitSingle to Universal Router is not critical", async () => {
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", permit2(UR)));
    expect(res(r).severity).toBeUndefined();
    expect(text(r)).toContain("permission");
  });

  it("Permit2 PermitSingle to unknown spender is critical", async () => {
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", permit2(UNKNOWN)));
    expect(res(r).severity).toBe("critical");
  });

  it("personal_sign gets a calm panel", async () => {
    const r = await run(state, (s) => sig(s, "personal_sign", "0x48656c6c6f"));
    expect(res(r).severity).toBeUndefined();
  });

  it("plain ETH transfer is a calm panel", async () => {
    const r = await run(state, (s) => tx(s, {}, { from: OK_FROM, to: UNKNOWN, value: "0xde0b6b3a7640000", data: "0x" }));
    expect(res(r).severity).toBeUndefined();
    expect(text(r)).toContain("Sends 1 of the chain");
  });

  it("empty cache does not crash", async () => {
    const r = await run(null, (s) => tx(s, {}, { from: OK_FROM, to: UNKNOWN, value: "0x1", data: "0x" }));
    expect(res(r)).toBeTruthy();
    expect(res(r).severity).toBeUndefined();
  });
});

const HL_DEST = "0x4444444444444444444444444444444444444444";
const hl = (primary, message, extra = {}) => ({
  types: {},
  primaryType: primary,
  domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 42161, verifyingContract: "0x0000000000000000000000000000000000000000" },
  message: { hyperliquidChain: "Mainnet", ...message },
  ...extra,
});

describe("Hyperliquid signatures", () => {
  it("Withdraw from a non-official origin is critical with action, recipient, amount and token", async () => {
    const data = hl("HyperliquidTransaction:Withdraw", { destination: HL_DEST, amount: "1500.5", time: 1 });
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", data, "https://hyperliquid-claim.xyz"));
    expect(res(r).severity).toBe("critical");
    const t = text(r);
    expect(t).toContain("Withdraw");
    expect(t).toContain("1500.5");
    expect(t).toContain("USDC");
    expect(t).toContain(HL_DEST);
    expect(t).toContain("not an official Hyperliquid app");
  });

  it("SpotSend shows the token", async () => {
    const data = hl("HyperliquidTransaction:SpotSend", { destination: HL_DEST, token: "PURR:0xc1fb593aeffbeb02f85e0308e9956a90", amount: "42" });
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", data, "https://evil.example"));
    expect(res(r).severity).toBe("critical");
    expect(text(r)).toContain("PURR");
    expect(text(r)).toContain("42");
  });

  it("ApproveAgent has its own line", async () => {
    const data = hl("HyperliquidTransaction:ApproveAgent", { agentAddress: HL_DEST, agentName: "bot" });
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", data, "https://evil.example"));
    expect(res(r).severity).toBe("critical");
    expect(text(r)).toContain("permission to trade your Hyperliquid account");
  });

  it("the L1 Agent action is critical off the official app", async () => {
    const data = {
      types: {},
      primaryType: "Agent",
      domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
      message: { source: "a", connectionId: "0x" + "ab".repeat(32) },
    };
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", data, "https://evil.example"));
    expect(res(r).severity).toBe("critical");
    expect(text(r)).toContain("cannot read");
  });

  it("the official Hyperliquid app is not flagged", async () => {
    const data = hl("HyperliquidTransaction:Withdraw", { destination: HL_DEST, amount: "10" });
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", data, "https://app.hyperliquid.xyz"));
    expect(res(r).severity).toBeUndefined();
  });

  it("malformed typed data does not crash", async () => {
    const r = await run(state, (s) => sig(s, "eth_signTypedData_v4", { primaryType: 5, domain: "x", message: null }));
    expect(r.response).toBeTruthy();
    const out = res(r);
    expect(out === null || out.severity === undefined).toBe(true);
  });
});
