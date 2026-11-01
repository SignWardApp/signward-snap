# Signward for MetaMask

Source code of the Signward MetaMask Snap, published on npm as [`@signwardapp/snap`](https://www.npmjs.com/package/@signwardapp/snap).

Signward adds a plain-English check to every MetaMask transaction and signature request: unlimited token approvals, setApprovalForAll, Permit and Permit2 signatures, NFT marketplace orders, EIP-7702 delegations, Hyperliquid withdraw and transfer signatures, and raw signatures you cannot read. It also compares the site and the addresses involved with Signward's public community feed of phishing sites and drainer addresses.

It holds no keys, asks for no accounts and never changes what you sign. If the feed cannot be reached, it still explains the request and never blocks anything.

## Layout

- `snap/`: the Snap itself (manifest, handlers, tests).
- `src/lib/`, `backend/src/neveraddrs.ts`, `public/_locales/en/`: decoder modules and English strings shared with the Signward browser extension. The Snap imports them by relative path.

## Build and test

```
cd snap
npm ci
npm test
```

`npm test` builds the bundle, checks that `snap.manifest.json` carries its shasum and runs the tests.

## Links

- Website: https://signward.app
- FAQ: https://signward.app/faq
- Support: hello@signward.app
- Security issues: security@signward.app

## License

MIT
