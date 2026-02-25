const DEFAULT_SETTINGS = {
  serverUrl: "http://localhost:5001",
  defaultProjectId: "",
  defaultCategory: "key_quote",
};

let activeTab = null;
let latestSelection = null;

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const serverUrl = trimSlash(settings.serverUrl || DEFAULT_SETTINGS.serverUrl);

  const projectSelect = document.getElementById("project-select");
  const categorySelect = document.getElementById("category-select");
  const noteInput = document.getElementById("note-input");
  const clipButton = document.getElementById("clip-btn");
  const openOptionsLink = document.getElementById("open-options");
  const openScholarMarkLink = document.getElementById("open-scholarmark");
  const openSettingsFromBannerLink = document.getElementById("open-settings");

  categorySelect.value = settings.defaultCategory || "key_quote";

  const { connected, projects } = await checkConnectionAndLoadProjects(serverUrl);
  renderConnectionState(connected);
  if (connected) {
    projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      if (project.id === settings.defaultProjectId) option.selected = true;
      projectSelect.appendChild(option);
    });
  }

  projectSelect.addEventListener("change", async () => {
    await chrome.storage.sync.set({ defaultProjectId: projectSelect.value });
  });

  categorySelect.addEventListener("change", async () => {
    await chrome.storage.sync.set({ defaultCategory: categorySelect.value });
  });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;
    latestSelection = await chrome.tabs.sendMessage(tab.id, { action: "getSelectionData" });
    renderSelectionPreview(latestSelection?.selectedText || "");
  } catch {
    latestSelection = null;
    renderSelectionPreview("");
  }

  clipButton.disabled = !(latestSelection && latestSelection.selectedText);

  clipButton.addEventListener("click", async () => {
    if (!activeTab || !activeTab.id) return;

    clipButton.disabled = true;
    clipButton.textContent = "Saving...";

    try {
      const selection = await chrome.tabs.sendMessage(activeTab.id, { action: "getSelectionData" });
      if (!selection?.selectedText) {
        throw new Error("No selected text found on the active page");
      }

      const payload = {
        highlightedText: selection.selectedText,
        sourceUrl: selection.sourceUrl || activeTab.url || "",
        pageTitle: selection.pageTitle || activeTab.title || "Untitled",
        siteName: selection.siteName || null,
        authorName: selection.authorName || null,
        publishDate: selection.publishDate || null,
        surroundingContext: selection.surroundingContext || null,
        projectId: projectSelect.value || null,
        category: categorySelect.value,
        note: noteInput.value.trim() || null,
      };

      const response = await fetch(`${serverUrl}/api/web-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Server returned ${response.status}${body ? `: ${body}` : ""}`);
      }

      clipButton.textContent = "Saved";
      clipButton.style.background = "#00c853";
      noteInput.value = "";
      await loadRecentClips(serverUrl);

      setTimeout(() => {
        clipButton.textContent = "Clip";
        clipButton.style.background = "";
        clipButton.disabled = false;
      }, 1200);
    } catch (error) {
      clipButton.textContent = "Error";
      clipButton.style.background = "#ff5252";
      setTimeout(() => {
        clipButton.textContent = "Clip";
        clipButton.style.background = "";
        clipButton.disabled = false;
      }, 1800);
      console.error("Failed to save clip", error);
    }
  });

  openOptionsLink.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  if (openSettingsFromBannerLink) {
    openSettingsFromBannerLink.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  openScholarMarkLink.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: serverUrl });
  });

  await loadRecentClips(serverUrl);
});

async function checkConnectionAndLoadProjects(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/api/projects`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const projects = await response.json();
    return { connected: true, projects: Array.isArray(projects) ? projects : [] };
  } catch {
    return { connected: false, projects: [] };
  }
}

function renderConnectionState(connected) {
  const dot = document.getElementById("status-dot");
  const errorBanner = document.getElementById("connection-error");

  dot.classList.remove("connected", "disconnected");
  dot.classList.add(connected ? "connected" : "disconnected");
  errorBanner.style.display = connected ? "none" : "block";
}

function renderSelectionPreview(selectedText) {
  const preview = document.getElementById("selected-text-preview");
  if (selectedText) {
    preview.textContent = `"${selectedText.slice(0, 220)}${selectedText.length > 220 ? "..." : ""}"`;
  } else {
    preview.textContent =
      'Select text on the page, then click "Clip" or right-click and choose "Send to ScholarMark".';
  }
}

async function loadRecentClips(serverUrl) {
  const container = document.getElementById("recent-clips");

  try {
    const response = await fetch(`${serverUrl}/api/web-clips?limit=5&sort=newest`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const clips = await response.json();
    if (!Array.isArray(clips) || clips.length === 0) {
      container.innerHTML = '<div class="empty-state">No clips yet</div>';
      return;
    }

    container.innerHTML = clips
      .map((clip) => {
        const quote = clip.highlightedText || "";
        const quotePreview = `${quote.slice(0, 100)}${quote.length > 100 ? "..." : ""}`;
        const created = clip.createdAt ? new Date(clip.createdAt).toLocaleDateString() : "";
        const meta = `${clip.pageTitle || "Untitled"}${created ? ` · ${created}` : ""}`;

        return `
          <div class="clip-item">
            <div class="clip-text">"${escapeHtml(quotePreview)}"</div>
            <div class="clip-meta">${escapeHtml(meta)}</div>
          </div>
        `;
      })
      .join("");
  } catch {
    container.innerHTML = '<div class="empty-state">Unable to load clips</div>';
  }
}

function trimSlash(url) {
  return String(url || "").replace(/\/$/, "");
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
