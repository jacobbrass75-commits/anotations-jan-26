chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "getSelectionData") {
    sendResponse(getSelectionData());
    return true;
  }

  if (message.action === "clipSaved") {
    showToast("Saved to ScholarMark", message.clip?.footnote || null);
    return true;
  }

  return false;
});

function getSelectionData() {
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : "";

  let surroundingContext = null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    let node = range.startContainer;
    if (node.nodeType !== Node.ELEMENT_NODE && node.parentElement) {
      node = node.parentElement;
    }

    const blockTags = new Set([
      "P",
      "DIV",
      "ARTICLE",
      "SECTION",
      "BLOCKQUOTE",
      "LI",
      "TD",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);

    let blockParent = node instanceof Element ? node : null;
    while (blockParent && !blockTags.has(blockParent.tagName)) {
      blockParent = blockParent.parentElement;
    }

    if (blockParent) {
      const text = blockParent.innerText?.trim();
      if (text) {
        surroundingContext = text.slice(0, 2000);
      }
    }
  }

  return {
    selectedText,
    sourceUrl: window.location.href,
    pageTitle: document.title,
    siteName:
      getMetaContent("og:site_name") ||
      getMetaContent("application-name") ||
      window.location.hostname,
    authorName:
      getMetaContent("author") ||
      getMetaContent("article:author") ||
      getMetaContent("dc.creator") ||
      getMetaContent("citation_author") ||
      extractByline(),
    publishDate:
      getMetaContent("article:published_time") ||
      getMetaContent("date") ||
      getMetaContent("dc.date") ||
      getMetaContent("citation_publication_date") ||
      getMetaContent("datePublished"),
    surroundingContext,
  };
}

function getMetaContent(nameOrProperty) {
  const el =
    document.querySelector(`meta[property="${nameOrProperty}"]`) ||
    document.querySelector(`meta[name="${nameOrProperty}"]`) ||
    document.querySelector(`meta[itemprop="${nameOrProperty}"]`);
  return el ? el.getAttribute("content") : null;
}

function extractByline() {
  const selectors = [
    '[class*="byline"]',
    '[class*="author"]',
    '[rel="author"]',
    '[itemprop="author"]',
    ".post-author",
    ".entry-author",
    'a[href*="/author/"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) {
      return text.replace(/^by\s+/i, "");
    }
  }

  return null;
}

function showToast(title, subtitle) {
  const existing = document.getElementById("scholarmark-web-clip-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "scholarmark-web-clip-toast";
  toast.style.position = "fixed";
  toast.style.bottom = "24px";
  toast.style.right = "24px";
  toast.style.background = "#131722";
  toast.style.color = "#f4f7ff";
  toast.style.padding = "14px 16px";
  toast.style.borderRadius = "10px";
  toast.style.borderLeft = "4px solid #2d7ff9";
  toast.style.boxShadow = "0 8px 28px rgba(0,0,0,0.35)";
  toast.style.zIndex = "2147483647";
  toast.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";
  toast.style.fontSize = "13px";
  toast.style.maxWidth = "420px";
  toast.style.opacity = "0";
  toast.style.transform = "translateY(10px)";
  toast.style.transition = "opacity 0.2s ease, transform 0.2s ease";

  const titleNode = document.createElement("div");
  titleNode.style.fontWeight = "600";
  titleNode.style.marginBottom = subtitle ? "4px" : "0";
  titleNode.textContent = title;
  toast.appendChild(titleNode);

  if (subtitle) {
    const subtitleNode = document.createElement("div");
    subtitleNode.style.color = "#b8c2d8";
    subtitleNode.style.fontSize = "12px";
    subtitleNode.style.whiteSpace = "nowrap";
    subtitleNode.style.overflow = "hidden";
    subtitleNode.style.textOverflow = "ellipsis";
    subtitleNode.textContent = subtitle;
    toast.appendChild(subtitleNode);
  }

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}
