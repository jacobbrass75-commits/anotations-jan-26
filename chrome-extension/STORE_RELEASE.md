# ScholarMark Chrome Web Store Release

## References

- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Privacy policy and secure handling requirements](https://developer.chrome.com/docs/webstore/user_data)
- [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare/)
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/)
- [Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update/)
- [Configure extension icons](https://developer.chrome.com/docs/extensions/develop/ui/configure-icons)
- [Remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)

## Package

```bash
npm run extension:package
```

Upload the generated zip from `dist/chrome-extension/`. The package script rewrites the packaged production manifest to remove `http://localhost:5001/*`, validates referenced icon dimensions, and keeps `manifest.json` at the zip root.

For local QA with localhost host permissions, run:

```bash
EXTENSION_PACKAGE_MODE=development npm run extension:package
```

Do not upload a development-mode package to Chrome Web Store.

## Manifest and release version

- `chrome-extension/manifest.json` must use `manifest_version: 3`.
- Bump `version` before every submitted package. Chrome Web Store requires each uploaded update to have a larger manifest version than the previously published item.
- Production package must not include localhost host permissions.
- Production package must not include remotely hosted executable code. All JavaScript executed by the extension must be packaged under `chrome-extension/`.
- Verify `icons` and `action.default_icon` point to real square PNG assets at 16x16, 48x48, and 128x128.

## Required store fields

- Single purpose: save selected webpage text, source metadata, and notes into a user's ScholarMark account.
- Permission justification for `activeTab`: grant temporary access to the current tab only after the user chooses the context menu item or keyboard shortcut.
- Permission justification for `scripting`: read selected text and source metadata from the active page only after a user-initiated save action, then show a short saved confirmation.
- Permission justification for `storage`: store the ScholarMark API key, default server URL, and default project.
- Permission justification for `contextMenus`: add the "Save to ScholarMark" selection menu item.
- Host permission justification: communicate with `https://app.scholarmark.ai` for authentication, project listing, extension API-key revocation, and clip creation.
- Privacy practices: disclose collection of selected text, surrounding context, page URL, page title, site name, author/date metadata when available, selected category, default project ID, account identifier, and generated citations.
- Data use statement: data is sent to ScholarMark only after a user action and is used to save clips to the user's account.
- Data sharing statement: disclose any service providers used by ScholarMark. If none apply to extension-collected data beyond ScholarMark infrastructure, say so plainly in the privacy policy.
- Security statement: extension API traffic uses HTTPS in production, and the extension stores the API key in `chrome.storage.local`.
- Support/contact URL: use the public ScholarMark support/contact page or a monitored support email URL.
- Privacy policy URL: use the production privacy policy and keep it consistent with the Chrome Web Store Privacy practices tab.
- Screenshots/promotional assets: include popup connected state, popup disconnected state, a selected-text save flow, the Web Clips page showing a saved clip, 128x128 icon, and required promotional images.
- Short description: match `manifest.json` and stay within Chrome Web Store limits.
- Long description: explain the single purpose, auth requirement, data sent on save, and Pro plan requirement.

## Pre-submit checklist

- `npm run extension:package` passes.
- Packaged manifest does not include localhost host permissions.
- Packaged manifest does not include `<all_urls>` content script access.
- Version in `chrome-extension/manifest.json` is bumped.
- Zip contains `manifest.json` at the root and no generated `dist/`, `node_modules/`, source maps, local screenshots, or private keys.
- No remote `<script>` tags, dynamic script injection from web URLs, `eval`, or fetched JavaScript execution.
- Production app URL opens and `/extension-auth` works with Clerk sign-in.
- New install can connect, list projects, save a clip, and logout.
- Logout revokes the stored API key when the backend is reachable.
- Privacy policy and listing text match the actual data collected.
- Permission warning text in Chrome matches the store justifications above.
- Screenshots and promotional images match the current UI and do not show test accounts, localhost URLs, or private data.
- Support/contact and privacy URLs are live before submission.
- Upload the zip in the Package tab, update Store listing and Privacy practices metadata, then submit for review.
