const DEFAULT_SETTINGS = {
  serverUrl: "http://localhost:5001",
  defaultProjectId: "",
  defaultCategory: "key_quote",
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "send-to-scholarmark",
      title: "Send to ScholarMark",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "send-to-scholarmark" || !info.selectionText || !tab?.id) {
    return;
  }

  try {
    await saveSelectionFromTab(tab.id, {
      fallbackSelection: info.selectionText,
      fallbackUrl: info.pageUrl || tab.url || "",
      fallbackTitle: tab.title || "Untitled",
    });
  } catch (error) {
    notify(
      "ScholarMark Error",
      `Failed to save clip: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
});

async function saveSelectionFromTab(tabId, fallback) {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const serverUrl = trimSlash(settings.serverUrl || DEFAULT_SETTINGS.serverUrl);

  let selectionData = null;
  try {
    selectionData = await chrome.tabs.sendMessage(tabId, { action: "getSelectionData" });
  } catch {
    selectionData = null;
  }

  const highlightedText =
    (selectionData && selectionData.selectedText ? selectionData.selectedText : fallback.fallbackSelection || "").trim();

  if (!highlightedText) {
    throw new Error("No selected text found");
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

  const res = await fetch(`${serverUrl}/api/web-clips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clipData),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Server returned ${res.status}${body ? `: ${body}` : ""}`);
  }

  const clip = await res.json();
  notify("Saved to ScholarMark", `"${highlightedText.slice(0, 80)}${highlightedText.length > 80 ? "..." : ""}" saved.`);

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: "clipSaved",
      clip,
    });
  } catch {
    // No-op for pages where content scripts cannot be injected.
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title,
    message,
  });
}

function trimSlash(url) {
  return url.replace(/\/$/, "");
}
