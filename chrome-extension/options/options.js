const DEFAULT_SETTINGS = {
  serverUrl: "http://localhost:5001",
  defaultProjectId: "",
  defaultCategory: "key_quote",
};

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  const serverUrlInput = document.getElementById("server-url");
  const defaultProjectSelect = document.getElementById("default-project");
  const defaultCategorySelect = document.getElementById("default-category");
  const saveButton = document.getElementById("save-btn");
  const saveStatus = document.getElementById("save-status");
  const testButton = document.getElementById("test-btn");
  const testResult = document.getElementById("test-result");

  serverUrlInput.value = settings.serverUrl || DEFAULT_SETTINGS.serverUrl;
  defaultCategorySelect.value = settings.defaultCategory || DEFAULT_SETTINGS.defaultCategory;

  await loadProjects(trimSlash(serverUrlInput.value), defaultProjectSelect, settings.defaultProjectId);

  saveButton.addEventListener("click", async () => {
    const normalizedServerUrl = trimSlash(serverUrlInput.value);

    await chrome.storage.sync.set({
      serverUrl: normalizedServerUrl,
      defaultProjectId: defaultProjectSelect.value,
      defaultCategory: defaultCategorySelect.value,
    });

    saveStatus.textContent = "Saved";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 1500);

    await loadProjects(normalizedServerUrl, defaultProjectSelect, defaultProjectSelect.value);
  });

  testButton.addEventListener("click", async () => {
    const normalizedServerUrl = trimSlash(serverUrlInput.value);
    testResult.textContent = "Testing...";
    testResult.style.color = "#dbe3f4";

    try {
      const response = await fetch(`${normalizedServerUrl}/api/projects`);
      if (!response.ok) {
        testResult.textContent = `Server returned ${response.status}`;
        testResult.style.color = "#ff5252";
        return;
      }

      const projects = await response.json();
      const count = Array.isArray(projects) ? projects.length : 0;
      testResult.textContent = `Connected. Found ${count} project${count === 1 ? "" : "s"}.`;
      testResult.style.color = "#00c853";
    } catch (error) {
      testResult.textContent = `Cannot reach server: ${error instanceof Error ? error.message : "Unknown error"}`;
      testResult.style.color = "#ff5252";
    }
  });
});

async function loadProjects(serverUrl, select, defaultProjectId) {
  while (select.options.length > 1) {
    select.remove(1);
  }

  try {
    const response = await fetch(`${serverUrl}/api/projects`);
    if (!response.ok) {
      return;
    }

    const projects = await response.json();
    if (!Array.isArray(projects)) return;

    projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      if (project.id === defaultProjectId) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  } catch {
    // No-op when server is unreachable.
  }
}

function trimSlash(url) {
  return String(url || "").replace(/\/$/, "");
}
