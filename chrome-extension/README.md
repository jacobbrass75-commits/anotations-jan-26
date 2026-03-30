# ScholarMark Web Clipper

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `chrome-extension/` folder.

## Configure

1. Open extension **Options**.
2. Leave `Server URL` as `https://app.scholarmark.ai` for production.
3. Only switch to `http://localhost:5001` when testing a local app build.

## Use

- Open the popup and click **Connect with ScholarMark**.
- Sign in through the web app, which mints a ScholarMark API key for the extension.
- Pick a default project in the popup if you want clips routed automatically.
- Highlight text on any webpage, right-click, and choose **Save to ScholarMark**.
- Or use `Ctrl+Shift+S`.

Clips are saved to `/api/web-clips` with generated Chicago-style citation fields.
