const EXTENSION_AUTH_MESSAGE = "SM_EXTENSION_AUTH";
const EXTENSION_AUTH_ACK = "SM_EXTENSION_AUTH_ACK";
const ALLOWED_EXTENSION_AUTH_ORIGINS = new Set([
  "https://app.scholarmark.ai",
  "https://scholarmark.ai",
  "http://localhost:5001",
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "getSelectionData" || message.type === "GET_SELECTION_CONTEXT") {
    sendResponse(getSelectionData());
    return;
  }

  if (message.action === "clipSaved") {
    showSaveIndicator();
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  if (event.data?.type !== EXTENSION_AUTH_MESSAGE) {
    return;
  }

  if (!ALLOWED_EXTENSION_AUTH_ORIGINS.has(event.origin)) {
    window.postMessage(
      {
        type: EXTENSION_AUTH_ACK,
        success: false,
      },
      event.origin,
    );
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "STORE_EXTENSION_AUTH",
      apiKey: event.data.apiKey,
      email: event.data.email,
      userId: event.data.userId,
      tier: event.data.tier,
      serverUrl: event.data.serverUrl,
    },
    (response) => {
      window.postMessage(
        {
          type: EXTENSION_AUTH_ACK,
          success: Boolean(response?.success),
        },
        event.origin,
      );
    },
  );
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.key === "S") {
    event.preventDefault();
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      chrome.runtime.sendMessage({
        type: "SAVE_SELECTION",
        text: selection.toString(),
        url: window.location.href,
        title: document.title,
      });
    }
  }
});

function getSelectionData() {
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

function readMetaValue(name) {
  const byProperty = document.querySelector(`meta[property="${name}"]`);
  const byName = document.querySelector(`meta[name="${name}"]`);
  return byProperty?.getAttribute("content") || byName?.getAttribute("content") || null;
}

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
