# TASK: Chrome Extension (feature/chrome-extension)

**Workstream:** Chrome Extension with Auth
**Branch:** `feature/chrome-extension`
**Worktree:** `sm-ext/`
**Dependencies:** Auth (mock JWT for development)

---

## Objective

Build a Chrome extension that lets users highlight text on any webpage and save it to their ScholarMark project with automatic citation data. The extension authenticates via JWT from the main app.

---

## Directory Structure

Create `chrome-extension/` at project root:

```
chrome-extension/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/
│   └── content.js
├── background/
│   └── background.js
├── options/
│   ├── options.html
│   └── options.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Files to Create

### 1. `chrome-extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "ScholarMark",
  "version": "1.0.0",
  "description": "Highlight and annotate any webpage. Save to your ScholarMark research projects.",
  "permissions": [
    "activeTab",
    "storage",
    "contextMenus"
  ],
  "host_permissions": [
    "http://localhost:5001/*",
    "https://scholarmark.ai/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background/background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "css": []
    }
  ],
  "options_page": "options/options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 2. `chrome-extension/background/background.js`

```javascript
// Service worker — handles:
// 1. Context menu: "Save to ScholarMark" on text selection
// 2. Token management: stores/retrieves JWT from chrome.storage.local
// 3. API calls to ScholarMark backend

const API_BASE = "http://localhost:5001"; // Changed to production URL later

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-to-scholarmark",
    title: "Save to ScholarMark",
    contexts: ["selection"]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "save-to-scholarmark" && info.selectionText) {
    const token = await getToken();
    if (!token) {
      // Open popup to prompt login
      chrome.action.openPopup();
      return;
    }

    // Get page metadata
    const pageUrl = tab.url;
    const pageTitle = tab.title;

    // Send to content script to get more context
    chrome.tabs.sendMessage(tab.id, {
      type: "GET_SELECTION_CONTEXT",
    }, async (response) => {
      const annotation = {
        highlightedText: info.selectionText,
        pageUrl,
        pageTitle,
        context: response?.surroundingText || "",
        timestamp: new Date().toISOString(),
      };

      await saveAnnotation(annotation, token);
    });
  }
});

async function getToken() {
  const result = await chrome.storage.local.get("sm_token");
  return result.sm_token || null;
}

async function saveAnnotation(annotation, token) {
  try {
    const response = await fetch(`${API_BASE}/api/extension/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(annotation),
    });

    if (response.ok) {
      // Notify user
      chrome.notifications?.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "ScholarMark",
        message: "Highlight saved to your project!",
      });
    } else if (response.status === 401) {
      // Token expired
      await chrome.storage.local.remove("sm_token");
      chrome.action.openPopup();
    }
  } catch (error) {
    console.error("Failed to save annotation:", error);
  }
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOGIN") {
    handleLogin(message.email, message.password).then(sendResponse);
    return true; // async response
  }
  if (message.type === "LOGOUT") {
    chrome.storage.local.remove("sm_token");
    sendResponse({ success: true });
  }
  if (message.type === "GET_PROJECTS") {
    getProjects().then(sendResponse);
    return true;
  }
});

async function handleLogin(email, password) {
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      const data = await response.json();
      await chrome.storage.local.set({ sm_token: data.token, sm_user: data.user });
      return { success: true, user: data.user };
    }
    return { success: false, error: "Invalid credentials" };
  } catch (error) {
    return { success: false, error: "Connection failed" };
  }
}

async function getProjects() {
  const token = await getToken();
  if (!token) return { success: false, error: "Not logged in" };

  const response = await fetch(`${API_BASE}/api/projects`, {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (response.ok) {
    const projects = await response.json();
    return { success: true, projects };
  }
  return { success: false, error: "Failed to fetch projects" };
}
```

### 3. `chrome-extension/content/content.js`

```javascript
// Content script — injected into every page
// Handles:
// 1. Getting selection context (surrounding text)
// 2. Visual highlight feedback
// 3. Keyboard shortcut (Ctrl+Shift+S to save selection)

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SELECTION_CONTEXT") {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const parentText = container.textContent || "";

      // Get ~200 chars of surrounding context
      const selectedText = selection.toString();
      const startIdx = parentText.indexOf(selectedText);
      const contextStart = Math.max(0, startIdx - 100);
      const contextEnd = Math.min(parentText.length, startIdx + selectedText.length + 100);

      sendResponse({
        surroundingText: parentText.substring(contextStart, contextEnd),
        selectedText,
      });
    } else {
      sendResponse({ surroundingText: "", selectedText: "" });
    }
  }
});

// Keyboard shortcut: Ctrl+Shift+S
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "S") {
    e.preventDefault();
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      chrome.runtime.sendMessage({
        type: "SAVE_SELECTION",
        text: selection.toString(),
        url: window.location.href,
        title: document.title,
      });

      // Visual feedback — brief highlight flash
      showSaveIndicator();
    }
  }
});

function showSaveIndicator() {
  const indicator = document.createElement("div");
  indicator.textContent = "Saved to ScholarMark";
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #D4556B;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: Inter, system-ui, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: opacity 0.3s ease;
  `;
  document.body.appendChild(indicator);

  setTimeout(() => {
    indicator.style.opacity = "0";
    setTimeout(() => indicator.remove(), 300);
  }, 2000);
}
```

### 4. `chrome-extension/popup/popup.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="app">
    <!-- Login View -->
    <div id="login-view" style="display: none;">
      <div class="header">
        <h1>ScholarMark</h1>
        <p class="subtitle">Sign in to save highlights</p>
      </div>
      <form id="login-form">
        <input type="email" id="email" placeholder="Email" required>
        <input type="password" id="password" placeholder="Password" required>
        <button type="submit" id="login-btn">Sign In</button>
        <p id="login-error" class="error"></p>
      </form>
    </div>

    <!-- Logged In View -->
    <div id="main-view" style="display: none;">
      <div class="header">
        <h1>ScholarMark</h1>
        <p class="user-info" id="user-info"></p>
      </div>

      <div class="section">
        <label>Save to Project:</label>
        <select id="project-select">
          <option value="">Select project...</option>
        </select>
      </div>

      <div class="section">
        <p class="hint">Select text on any page, then right-click → "Save to ScholarMark"</p>
        <p class="hint">Or use <kbd>Ctrl+Shift+S</kbd></p>
      </div>

      <div class="section">
        <button id="open-app" class="secondary">Open ScholarMark</button>
        <button id="logout-btn" class="danger">Sign Out</button>
      </div>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

### 5. `chrome-extension/popup/popup.css`

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 320px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-size: 14px;
  color: #2D2A26;
  background: #FAFAF8;
}

.header {
  padding: 16px;
  border-bottom: 1px solid #E8E4E0;
}

.header h1 {
  font-size: 18px;
  font-weight: 600;
  color: #D4556B;
}

.subtitle {
  font-size: 12px;
  color: #8A8580;
  margin-top: 4px;
}

.user-info {
  font-size: 12px;
  color: #5B7FA5;
  margin-top: 4px;
}

form {
  padding: 16px;
}

input {
  display: block;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid #E8E4E0;
  border-radius: 6px;
  font-size: 14px;
  background: #F5F3F0;
  color: #2D2A26;
  outline: none;
}

input:focus {
  border-color: #D4556B;
}

button {
  display: block;
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: 8px;
}

button[type="submit"], button.primary {
  background: #D4556B;
  color: white;
}

button.secondary {
  background: #5B7FA5;
  color: white;
}

button.danger {
  background: transparent;
  color: #C94454;
  border: 1px solid #C94454;
}

.section {
  padding: 12px 16px;
}

select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #E8E4E0;
  border-radius: 6px;
  font-size: 14px;
  background: #F5F3F0;
}

.hint {
  font-size: 12px;
  color: #8A8580;
  margin-bottom: 8px;
}

kbd {
  background: #E8E4E0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
}

.error {
  color: #C94454;
  font-size: 12px;
  margin-top: 8px;
}
```

### 6. `chrome-extension/popup/popup.js`

```javascript
// Popup logic — handles login state and project selection

document.addEventListener("DOMContentLoaded", async () => {
  const loginView = document.getElementById("login-view");
  const mainView = document.getElementById("main-view");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const userInfo = document.getElementById("user-info");
  const projectSelect = document.getElementById("project-select");
  const openAppBtn = document.getElementById("open-app");
  const logoutBtn = document.getElementById("logout-btn");

  // Check if logged in
  const { sm_token, sm_user } = await chrome.storage.local.get(["sm_token", "sm_user"]);

  if (sm_token && sm_user) {
    showMainView(sm_user);
  } else {
    showLoginView();
  }

  function showLoginView() {
    loginView.style.display = "block";
    mainView.style.display = "none";
  }

  function showMainView(user) {
    loginView.style.display = "none";
    mainView.style.display = "block";
    userInfo.textContent = `${user.username} (${user.tier})`;
    loadProjects();
  }

  async function loadProjects() {
    const response = await chrome.runtime.sendMessage({ type: "GET_PROJECTS" });
    if (response.success) {
      projectSelect.innerHTML = '<option value="">Select project...</option>';
      response.projects.forEach(p => {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = p.name;
        projectSelect.appendChild(option);
      });

      // Restore last selected project
      const { sm_project } = await chrome.storage.local.get("sm_project");
      if (sm_project) {
        projectSelect.value = sm_project;
      }
    }
  }

  projectSelect.addEventListener("change", () => {
    chrome.storage.local.set({ sm_project: projectSelect.value });
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    loginError.textContent = "";
    const response = await chrome.runtime.sendMessage({
      type: "LOGIN",
      email,
      password,
    });

    if (response.success) {
      showMainView(response.user);
    } else {
      loginError.textContent = response.error;
    }
  });

  openAppBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:5001" });
  });

  logoutBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "LOGOUT" });
    showLoginView();
  });
});
```

### 7. Backend: `server/extensionRoutes.ts` (NEW)

Add a new route file for extension-specific endpoints:

```typescript
// POST /api/extension/save — Save a highlight from the Chrome extension
// Requires auth (JWT in Authorization header)
// Body: { highlightedText, pageUrl, pageTitle, context, projectId? }
// Creates an annotation in the specified project (or default project)

export function registerExtensionRoutes(app: Express) {
  app.post("/api/extension/save", requireAuth, async (req, res) => {
    const { highlightedText, pageUrl, pageTitle, context, projectId } = req.body;

    // Validate
    if (!highlightedText) {
      return res.status(400).json({ message: "No text provided" });
    }

    // Find or create the target project
    // If projectId provided, use it. Otherwise use user's default project.

    // Create a "web highlight" annotation
    // Store pageUrl and pageTitle in the annotation note
    // Category: "key_quote" for web highlights

    // Auto-generate citation data from the webpage
    const citationData = {
      sourceType: "website",
      authors: [],
      title: pageTitle || "Untitled Page",
      url: pageUrl,
      accessDate: new Date().toISOString().split("T")[0],
    };

    // Save and return
    res.json({ success: true, annotation: { /* saved annotation */ } });
  });
}
```

Register in `server/routes.ts`:
```typescript
import { registerExtensionRoutes } from "./extensionRoutes";
registerExtensionRoutes(app);
```

### 8. Icons

Create simple placeholder icons. Use a rounded square with "SM" text in the Darling rose color (#D4556B) on white background.

For now, create simple colored squares:
- 16x16, 48x48, 128x128 PNG files
- Can be generated programmatically or use a simple online tool

---

## Install Dependencies

None needed for the extension (vanilla JS). Backend needs no new deps.

---

## After Implementation

```bash
npm run check   # For the backend extension routes
npm run dev
```

Test the extension:
1. Go to `chrome://extensions/` in Chrome
2. Enable Developer Mode
3. Click "Load unpacked" and select the `chrome-extension/` folder
4. Open the extension popup — should show login form
5. Log in (requires auth system or mock a JWT)
6. Select a project
7. Go to any webpage, select text
8. Right-click → "Save to ScholarMark"
9. Verify annotation saved via the API
10. Test Ctrl+Shift+S keyboard shortcut

---

## Important Notes

- The extension uses Manifest V3 (service worker, not background page).
- `API_BASE` defaults to `http://localhost:5001` for development. Will be changed to `https://scholarmark.ai` for production.
- For dev testing without the auth system: hardcode a test JWT token in `chrome.storage.local` via the console: `chrome.storage.local.set({ sm_token: "test-token" })`
- The popup uses the Darling theme colors for brand consistency.
- Content script is minimal — just handles selection context and keyboard shortcut.
- The background service worker handles all API communication.
- CORS: The backend needs to allow requests from the Chrome extension. Add the extension origin to CORS config, or since we're using `host_permissions`, it should work.
