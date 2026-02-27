# ScholarMark Web Clipper

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `chrome-extension/` folder.

## Configure

1. Open extension **Options**.
2. Set `Server URL` to your ScholarMark backend (example: `http://89.167.10.34:5001`).
3. Optional: choose default project and category.

## Use

- Highlight text on any webpage, right-click, and choose **Send to ScholarMark**.
- Or open the popup and click **Clip**.

Clips are saved to `/api/web-clips` with generated Chicago-style citation fields.
