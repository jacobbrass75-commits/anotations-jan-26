// Service worker:
// 1) context menu saves
// 2) account storage for extension API keys
// 3) authenticated API calls using the active account

const PROD_API_BASE = "https://scholarmark.ai";
const DEV_API_BASE = "http://localhost:5001";
const API_BASE_CACHE_MS = 60_000;

let cachedDefaultBase = null;
let cachedDefaultBaseAt = 0;

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function getStoredApiBase() {
  const { sm_api_url } = await chrome.storage.local.get("sm_api_url");
  if (typeof sm_api_url !== "string") return null;
  const normalized = normalizeBaseUrl(sm_api_url);
  return normalized || null;
}

async function canReachApi(baseUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    await fetch(`${baseUrl}/api/system/status`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

async function resolveApiBase() {
  const configured = await getStoredApiBase();
  if (configured) return configured;

  const now = Date.now();
  if (cachedDefaultBase && now - cachedDefaultBaseAt < API_BASE_CACHE_MS) {
    return cachedDefaultBase;
  }

  const prodReachable = await canReachApi(PROD_API_BASE);
  cachedDefaultBase = prodReachable ? PROD_API_BASE : DEV_API_BASE;
  cachedDefaultBaseAt = now;
  return cachedDefaultBase;
}

async function apiFetch(path, token, init = {}) {
  const configuredBase = await getStoredApiBase();
  const primaryBase = configuredBase || (await resolveApiBase());
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  try {
    return await fetch(`${primaryBase}${path}`, { ...init, headers });
  } catch (error) {
    if (configuredBase || primaryBase !== PROD_API_BASE) {
      throw error;
    }
    // Dev fallback when no explicit API base is configured.
    return await fetch(`${DEV_API_BASE}${path}`, { ...init, headers });
  }
}

async function getAccountStore() {
  const { sm_accounts, sm_active_account } = await chrome.storage.local.get([
    "sm_accounts",
    "sm_active_account",
  ]);

  const accounts =
    sm_accounts && typeof sm_accounts === "object" && !Array.isArray(sm_accounts)
      ? sm_accounts
      : {};

  return {
    accounts,
    activeAccountId: typeof sm_active_account === "string" ? sm_active_account : null,
  };
}

async function saveAccountStore(accounts, activeAccountId) {
  await chrome.storage.local.set({
    sm_accounts: accounts,
    sm_active_account: activeAccountId || null,
  });
}

async function getActiveAccount() {
  const { accounts, activeAccountId } = await getAccountStore();
  if (activeAccountId && accounts[activeAccountId]) {
    return { userId: activeAccountId, account: accounts[activeAccountId] };
  }

  const firstUserId = Object.keys(accounts)[0];
  if (!firstUserId) return null;

  await chrome.storage.local.set({ sm_active_account: firstUserId });
  return { userId: firstUserId, account: accounts[firstUserId] };
}

async function getToken() {
  const active = await getActiveAccount();
  return active?.account?.apiKey || null;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-to-scholarmark",
    title: "Save to ScholarMark",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-to-scholarmark" || !info.selectionText) return;

  const token = await getToken();
  if (!token) {
    chrome.action.openPopup();
    return;
  }

  const pageUrl = tab?.url || "";
  const pageTitle = tab?.title || "";

  if (!tab?.id) {
    await saveAnnotation(
      {
        highlightedText: info.selectionText,
        pageUrl,
        pageTitle,
        context: "",
        timestamp: new Date().toISOString(),
      },
      token
    );
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION_CONTEXT" }, async (response) => {
    const context = chrome.runtime.lastError ? "" : response?.surroundingText || "";

    await saveAnnotation(
      {
        highlightedText: info.selectionText,
        pageUrl,
        pageTitle,
        context,
        timestamp: new Date().toISOString(),
      },
      token
    );
  });
});

async function saveAnnotation(annotation, token) {
  try {
    const { sm_project } = await chrome.storage.local.get("sm_project");
    const payload = {
      highlightedText: annotation.highlightedText,
      sourceUrl: annotation.pageUrl,
      pageTitle: annotation.pageTitle || "Untitled Page",
      surroundingContext: annotation.context || "",
      projectId: sm_project || undefined,
      category: "web_clip",
    };

    const response = await apiFetch("/api/web-clips", token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      chrome.notifications?.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "ScholarMark",
        message: sm_project ? "Highlight saved to your project!" : "Highlight saved to Web Clips!",
      });
      return;
    }

    if (response.status === 401) {
      chrome.action.openPopup();
      return;
    }

    const errorText = await response.text();
    console.error("Failed to save annotation:", errorText);
  } catch (error) {
    console.error("Failed to save annotation:", error);
  }
}

async function handleExtensionAuth(message) {
  if (!message?.apiKey || !message?.userId) {
    return { success: false, error: "Missing required account fields" };
  }

  const { accounts } = await getAccountStore();
  accounts[message.userId] = {
    apiKey: message.apiKey,
    email: message.email || "",
    tier: message.tier || "free",
  };

  await saveAccountStore(accounts, message.userId);
  return {
    success: true,
    activeAccount: message.userId,
    account: accounts[message.userId],
  };
}

async function handleLogout(userId) {
  const { accounts, activeAccountId } = await getAccountStore();
  const targetUserId = userId || activeAccountId;
  if (!targetUserId || !accounts[targetUserId]) {
    return { success: true };
  }

  delete accounts[targetUserId];
  const nextActive =
    activeAccountId === targetUserId ? Object.keys(accounts)[0] || null : activeAccountId;

  await saveAccountStore(accounts, nextActive);
  return { success: true, activeAccount: nextActive };
}

async function handleSwitchAccount(userId) {
  const { accounts } = await getAccountStore();
  if (!userId || !accounts[userId]) {
    return { success: false, error: "Account not found" };
  }

  await chrome.storage.local.set({ sm_active_account: userId });
  return { success: true, activeAccount: userId };
}

async function getProjects() {
  const active = await getActiveAccount();
  if (!active?.account?.apiKey) {
    return { success: false, error: "Not connected" };
  }

  try {
    const response = await apiFetch("/api/projects", active.account.apiKey, {
      method: "GET",
    });

    if (response.ok) {
      const projects = await response.json();
      return { success: true, projects };
    }

    if (response.status === 401) {
      return { success: false, error: "Authentication expired. Reconnect this account.", needsReconnect: true };
    }

    return { success: false, error: "Failed to fetch projects" };
  } catch {
    return { success: false, error: "Connection failed" };
  }
}

async function handleSaveSelection(message) {
  const active = await getActiveAccount();
  if (!active?.account?.apiKey) {
    return { success: false, error: "Not connected" };
  }

  const { sm_project } = await chrome.storage.local.get("sm_project");
  const payload = {
    highlightedText: message.text,
    sourceUrl: message.url,
    pageTitle: message.title,
    surroundingContext: "",
    projectId: sm_project || undefined,
    category: "web_clip",
  };

  try {
    const response = await apiFetch("/api/web-clips", active.account.apiKey, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { success: true };
    }

    if (response.status === 401) {
      return { success: false, error: "Authentication expired. Reconnect this account.", needsReconnect: true };
    }

    return { success: false, error: "Save failed" };
  } catch {
    return { success: false, error: "Connection failed" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTENSION_AUTH") {
    handleExtensionAuth(message).then(sendResponse);
    return true;
  }

  if (message.type === "LOGOUT") {
    handleLogout(message.userId).then(sendResponse);
    return true;
  }

  if (message.type === "SWITCH_ACCOUNT") {
    handleSwitchAccount(message.userId).then(sendResponse);
    return true;
  }

  if (message.type === "GET_PROJECTS") {
    getProjects().then(sendResponse);
    return true;
  }

  if (message.type === "SAVE_SELECTION") {
    handleSaveSelection(message).then(sendResponse);
    return true;
  }

  if (message.type === "GET_API_BASE") {
    resolveApiBase().then((apiBase) => sendResponse({ success: true, apiBase }));
    return true;
  }

  return false;
});
