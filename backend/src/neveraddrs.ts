// Well-known contracts and sentinel addresses that must never enter the drainer-address feed, whatever a caller sends.
// Lowercase 0x hex -> label. These are canonical, widely audited, deterministic deployments (same address on every EVM chain
// they exist on), so the guard is address-only. Sources are each vendor's own deployment docs or the Etherscan label.
// A feed entry that matched one of these would make Signward call a real swap router or marketplace a drainer, so the list is
// applied twice: when an entry is added (/admin/radar-addrs, /admin/addrs) and again when the feed is served.

export const NEVER_ADDRS: ReadonlyMap<string, string> = new Map([
  // Sentinels
  ["0x0000000000000000000000000000000000000000", "Zero address"],
  ["0x000000000000000000000000000000000000dead", "Burn address (0x...dEaD)"],
  // Uniswap: docs.uniswap.org/contracts/v3/reference/deployments, /contracts/universal-router/overview, /contracts/permit2/overview
  ["0x000000000022d473030f116ddee9f6b43ac78ba3", "Uniswap Permit2"],
  ["0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", "Uniswap Universal Router (v1.2)"],
  ["0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b", "Uniswap Universal Router (v1.0)"],
  ["0x66a9893cc07d91d95644aedd05d03f95e1dba8af", "Uniswap Universal Router (v4)"],
  ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", "Uniswap SwapRouter02"],
  ["0xe592427a0aece92de3edee1f18e0157c05861564", "Uniswap V3 SwapRouter"],
  ["0x7a250d5630b4cf539739df2c5dacb4c659f2488d", "Uniswap V2 Router02"],
  ["0xc36442b4a4522e871399cd717abdd847ab11fe88", "Uniswap V3 NonfungiblePositionManager"],
  ["0x000000000004444c5dc75cb358380d2e3de08a90", "Uniswap V4 PoolManager"],
  // 1inch: Etherscan labels "1inch v4/v5/v6: Aggregation Router"; docs.1inch.io
  ["0x1111111254fb6c44bac0bed2854e76f90643097d", "1inch Aggregation Router v4"],
  ["0x1111111254eeb25477b68fb85ed929f73a960582", "1inch Aggregation Router v5"],
  ["0x111111125421ca6dc452d289314280a0f8842a65", "1inch Aggregation Router v6"],
  // 0x: docs.0x.org (Exchange Proxy; AllowanceHolder of the v2 API)
  ["0xdef1c0ded9bec7f1a1670819833240f027b25eff", "0x Exchange Proxy"],
  ["0x0000000000001ff3684f28c67538d4d072c22734", "0x AllowanceHolder"],
  // OpenSea: docs.opensea.io/docs/seaport (Seaport and its conduit)
  ["0x00000000006c3852cbef3e08e8df289169ede581", "OpenSea Seaport 1.1"],
  ["0x00000000000001ad428e4906ae43d8f9852d0dd6", "OpenSea Seaport 1.4"],
  ["0x00000000000000adc04c56bf30ac9d3c0aaf14dc", "OpenSea Seaport 1.5"],
  ["0x0000000000000068f116a894984e2db1123eb395", "OpenSea Seaport 1.6"],
  ["0x1e0049783f008a0085193e00003d00cd54003c71", "OpenSea Conduit"],
  ["0x00000000f9490004c11cef243f5400493c00ad63", "OpenSea Conduit Controller"],
  // Blur: Etherscan labels "Blur.io: Exchange", "Blur.io: Pool", "Blur.io: Blend"
  ["0x000000000000ad05ccc4f10045630fb830b95127", "Blur Exchange"],
  ["0x0000000000a39bb272e79075ade125fd351887ac", "Blur Pool"],
  ["0x29469395eaf6f95920e59f858042f0e28d98a20b", "Blur Blend"],
  // Core tokens: they are contracts a signer legitimately approves or transfers, never a drainer's address
  ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "WETH9"],
  ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC"],
  ["0xdac17f958d2ee523a2206206994597c13d831ec7", "USDT"],
  ["0x6b175474e89094c44da98b954eedeac495271d0f", "DAI"],
  // CoW Protocol GPv2VaultRelayer: cowprotocol/contracts networks.json, and GPv2Settlement.vaultRelayer() on chain
  ["0xc92e8bdf79f0507f65a392b0ab4667716bfe0110", "CoW Protocol GPv2VaultRelayer"],
  // Velora (ParaSwap) Augustus v6.2: developers.velora.xyz/augustus-swapper/augustus-v6.2-smart-contracts
  ["0x6a000f20005980200259b80c5102003040001068", "Velora (ParaSwap) Augustus v6.2"],
  // Aave v3 Pool (Ethereum): aave-dao/aave-address-book AaveV3Ethereum.POOL
  ["0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", "Aave v3 Pool"],
]);

export function isNeverAddr(addr: string): boolean {
  return NEVER_ADDRS.has(addr.toLowerCase());
}
