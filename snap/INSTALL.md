# Publishing and installing the Signward Snap

## Owner: publish to npm (once per release)
1. Create or use the Signward npm account and the `@signward` scope (npmjs.com, enable 2FA).
2. In `snap/`: `npm install`, then `npm test` (builds, updates the manifest shasum, runs the simulator tests).
3. Check `git diff snap.manifest.json`: the shasum must match the new `dist/bundle.js`. Bump `version` in BOTH `package.json` and `snap.manifest.json` for every release. The manifest shasum also depends on the manifest content, which mirrors the `repository` field of `package.json`: after any change to `package.json` metadata, rerun `npm test` and commit the updated shasum before publishing.
4. `npm login`, then `npm publish --access public`. The package ships `dist/`, `images/` and `snap.manifest.json` only.
5. Verify: https://www.npmjs.com/package/@signwardapp/snap and `npm view @signwardapp/snap version`.
Allowlisting IS required for regular MetaMask. The insight permissions and `snap_manageState` are open, but `endowment:network-access` is a protected permission, so MetaMask only installs the Snap without the "unverified Snap" warning once it has been allowlisted. No audit is required, because the Snap uses no entropy or account-management methods. Each allowlisted version is exact: every later release needs a new request. See `store/snaps-directory-submission.md`.

## Users: install
In a page with MetaMask present:
```js
await window.ethereum.request({
  method: "wallet_requestSnaps",
  params: { "npm:@signwardapp/snap": {} },
});
```
Or the user can use any Snap installer that accepts `npm:@signwardapp/snap`. The user then sees the permission prompt (transaction and signature insights, network access, storage) and confirms.

## "Add to MetaMask" button for signward.app
```html
<button id="sw-add-metamask">Add to MetaMask</button>
<p id="sw-add-status" role="status"></p>
<script>
  document.getElementById("sw-add-metamask").addEventListener("click", async () => {
    const out = document.getElementById("sw-add-status");
    const eth = window.ethereum;
    if (!eth || !eth.isMetaMask) { out.textContent = "MetaMask was not found in this browser."; return; }
    try {
      await eth.request({ method: "wallet_requestSnaps", params: { "npm:@signwardapp/snap": {} } });
      out.textContent = "Signward is installed in MetaMask.";
    } catch (e) {
      out.textContent = "Install was cancelled or failed.";
    }
  });
</script>
```
Do not request any eth_accounts permission: the Snap needs none.
