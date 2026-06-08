const DEFAULT_SETTINGS = {
  serverUrl: "https://app.scholarmark.ai",
  defaultProjectId: "",
  defaultCategory: "key_quote",
};

const AUTH_STORAGE_KEYS = ["sm_api_key", "sm_api_key_id", "sm_user", "sm_token", "sm_project"];
const CONTEXT_MENU_ID = "save-to-scholarmark";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Save to ScholarMark",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText || !tab?.id) {
    return;
  }

  try {
    await saveSelectionForTab(tab.id, {
      fallbackSelection: info.selectionText,
      fallbackUrl: info.pageUrl || tab.url || "",
      fallbackTitle: tab.title || "Untitled",
    });
  } catch (error) {
    console.error("ScholarMark context-menu save failed:", error);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "save-selection" || !tab?.id) {
    return;
  }

  try {
    await saveSelectionForTab(tab.id, {
      fallbackSelection: "",
      fallbackUrl: tab.url || "",
      fallbackTitle: tab.title || "Untitled",
    });
  } catch (error) {
    console.error("ScholarMark shortcut save failed:", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AUTH_STATE") {
    getAuthState().then(sendResponse);
    return true;
  }

  if (message.type === "START_AUTH") {
    startAuthFlow().then(sendResponse);
    return true;
  }

  if (message.type === "OPEN_APP") {
    openScholarMark().then(sendResponse);
    return true;
  }

  if (message.type === "STORE_EXTENSION_AUTH") {
    storeExtensionAuth(message).then(sendResponse);
    return true;
  }

  if (message.type === "GET_PROJECTS") {
    getProjects().then(sendResponse);
    return true;
  }

  if (message.type === "SET_DEFAULT_PROJECT") {
    chrome.storage.sync.set({ defaultProjectId: message.projectId || "" }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "LOGOUT") {
    revokeStoredApiKey().finally(() => chrome.storage.local.remove(AUTH_STORAGE_KEYS)).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "SAVE_SELECTION") {
    handleInlineSave(message, sender).then(sendResponse);
    return true;
  }
});

async function getAuthState() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const localState = await chrome.storage.local.get(["sm_api_key", "sm_user"]);

  return {
    connected: Boolean(localState.sm_api_key),
    user: localState.sm_user || null,
    settings,
  };
}

async function startAuthFlow() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const serverUrl = trimSlash(settings.serverUrl || DEFAULT_SETTINGS.serverUrl);
  await chrome.tabs.create({ url: `${serverUrl}/extension-auth` });
  return { success: true };
}

async function openScholarMark() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const serverUrl = trimSlash(settings.serverUrl || DEFAULT_SETTINGS.serverUrl);
  await chrome.tabs.create({ url: serverUrl });
  return { success: true };
}

async function storeExtensionAuth(message) {
  if (!message.apiKey) {
    return { success: false, error: "Missing API key" };
  }

  const serverUrl = trimSlash(message.serverUrl || DEFAULT_SETTINGS.serverUrl);

  await chrome.storage.local.set({
    sm_api_key: message.apiKey,
    sm_api_key_id: message.apiKeyId || "",
    sm_user: {
      userId: message.userId || "",
      email: message.email || "",
      tier: message.tier || "free",
    },
  });
  await chrome.storage.local.remove(["sm_token"]);
  await chrome.storage.sync.set({ serverUrl });

  return { success: true };
}

async function getProjects() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { success: false, error: "Connect ScholarMark first." };
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const serverUrl = trimSlash(settings.serverUrl || DEFAULT_SETTINGS.serverUrl);

  try {
    const response = await fetch(`${serverUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.status === 401) {
      await clearAuthState();
      return { success: false, error: "Connection expired. Reconnect the extension." };
    }

    if (!response.ok) {
      return { success: false, error: `Failed to load projects (${response.status})` };
    }

    return {
      success: true,
      projects: await response.json(),
    };
  } catch {
    return { success: false, error: "Could not reach ScholarMark." };
  }
}

async function handleInlineSave(message, sender) {
  if (!sender.tab?.id) {
    return { success: false, error: "No browser tab was available." };
  }

  try {
    await saveSelectionForTab(sender.tab.id, {
      fallbackSelection: message.text,
      fallbackUrl: message.url,
      fallbackTitle: message.title,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not save selection.",
    };
  }
}

async function saveSelectionForTab(tabId, fallback) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    await startAuthFlow();
    throw new Error("Connect ScholarMark before saving clips.");
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const serverUrl = trimSlash(settings.serverUrl || DEFAULT_SETTINGS.serverUrl);

  const selectionData = await getSelectionDataForTab(tabId);

  const highlightedText = (
    selectionData?.selectedText || fallback.fallbackSelection || ""
  ).trim();

  if (!highlightedText) {
    throw new Error("No selected text found.");
  }

  const clipData = {
    highlightedText,
    sourceUrl: selectionData?.sourceUrl || fallback.fallbackUrl,
    pageTitle: selectionData?.pageTitle || fallback.fallbackTitle,
    siteName: selectionData?.siteName || null,
    authorName: selectionData?.authorName || null,
    publishDate: selectionData?.publishDate || null,
    surroundingContext: selectionData?.surroundingContext || null,
    projectId: settings.defaultProjectId || null,
    category: settings.defaultCategory || "key_quote",
  };

  const response = await fetch(`${serverUrl}/api/web-clips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(clipData),
  });

  if (response.status === 401) {
    await clearAuthState();
    await startAuthFlow();
    throw new Error("Your ScholarMark connection expired. Reconnect and try again.");
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Server returned ${response.status}${body ? `: ${body}` : ""}`);
  }

  const clip = await response.json();

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showSaveIndicatorOnPage,
    });
  } catch {
    // No-op for pages where script injection is unavailable.
  }

  return clip;
}

async function getSelectionDataForTab(tabId) {
  try {
    const [injectionResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectSelectionDataFromPage,
    });
    return injectionResult?.result || null;
  } catch {
    return null;
  }
}

async function getApiKey() {
  const stored = await chrome.storage.local.get(["sm_api_key", "sm_token"]);
  return stored.sm_api_key || stored.sm_token || null;
}

async function revokeStoredApiKey() {
  const stored = await chrome.storage.local.get(["sm_api_key", "sm_api_key_id"]);
  if (!stored.sm_api_key || !stored.sm_api_key_id) {
    return;
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const serverUrl = trimSlash(settings.serverUrl || DEFAULT_SETTINGS.serverUrl);

  try {
    await fetch(`${serverUrl}/api/auth/api-keys/${encodeURIComponent(stored.sm_api_key_id)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${stored.sm_api_key}`,
      },
    });
  } catch {
    // Local logout should still clear extension state if the backend cannot be reached.
  }
}

async function clearAuthState() {
  await chrome.storage.local.remove(AUTH_STORAGE_KEYS);
}

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function collectSelectionDataFromPage() {
  function readMetaValue(name) {
    const byProperty = document.querySelector(`meta[property="${name}"]`);
    const byName = document.querySelector(`meta[name="${name}"]`);
    return byProperty?.getAttribute("content") || byName?.getAttribute("content") || null;
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() || "";

  let surroundingContext = "";
  if (selection && selection.rangeCount > 0 && selectedText) {
    const range = selection.getRangeAt(0);
    const parentText = range.commonAncestorContainer.textContent || "";
    const startIdx = parentText.indexOf(selectedText);
    const contextStart = Math.max(0, startIdx - 100);
    const contextEnd = Math.min(parentText.length, startIdx + selectedText.length + 100);
    surroundingContext = parentText.substring(contextStart, contextEnd);
  }

  return {
    selectedText,
    sourceUrl: window.location.href,
    pageTitle: document.title || "Untitled",
    siteName: readMetaValue("og:site_name"),
    authorName: readMetaValue("author"),
    publishDate:
      readMetaValue("article:published_time") ||
      readMetaValue("publication_date") ||
      readMetaValue("date"),
    surroundingContext,
  };
}

function showSaveIndicatorOnPage() {
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
    font-family: "Libre Franklin", system-ui, -apple-system, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: opacity 0.3s ease;
  `;
  document.body.appendChild(indicator);

  setTimeout(() => {
    indicator.style.opacity = "0";
    setTimeout(() => indicator.remove(), 300);
  }, 2000);
}
