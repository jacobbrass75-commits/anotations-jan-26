const PROD_API_BASE = "https://scholarmark.ai";

function toTitleCase(value) {
  if (!value) return "Free";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function normalizeAccounts(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

async function getApiBase() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_API_BASE" });
    if (response?.success && response.apiBase) {
      return response.apiBase;
    }
  } catch (error) {
    console.error("Failed to resolve API base:", error);
  }
  return PROD_API_BASE;
}

async function openExtensionAuthTab() {
  const apiBase = await getApiBase();
  await chrome.tabs.create({ url: `${apiBase}/extension-auth` });
}

async function openAppTab() {
  const apiBase = await getApiBase();
  await chrome.tabs.create({ url: apiBase });
}

document.addEventListener("DOMContentLoaded", async () => {
  const disconnectedView = document.getElementById("disconnected-view");
  const connectedView = document.getElementById("connected-view");
  const connectBtn = document.getElementById("connect-btn");
  const addAccountBtn = document.getElementById("add-account");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const openAppBtn = document.getElementById("open-app");
  const accountStatus = document.getElementById("account-status");
  const accountSwitcherWrap = document.getElementById("account-switcher-wrap");
  const accountSelect = document.getElementById("account-select");
  const projectSelect = document.getElementById("project-select");
  const projectsError = document.getElementById("projects-error");

  let currentAccounts = {};
  let currentActiveAccountId = null;

  connectBtn.addEventListener("click", async () => {
    await openExtensionAuthTab();
    window.close();
  });

  addAccountBtn.addEventListener("click", async () => {
    await openExtensionAuthTab();
    window.close();
  });

  openAppBtn.addEventListener("click", async () => {
    await openAppTab();
  });

  disconnectBtn.addEventListener("click", async () => {
    if (!currentActiveAccountId) return;
    await chrome.runtime.sendMessage({
      type: "LOGOUT",
      userId: currentActiveAccountId,
    });
    await render();
  });

  accountSelect.addEventListener("change", async () => {
    const nextUserId = accountSelect.value;
    const result = await chrome.runtime.sendMessage({
      type: "SWITCH_ACCOUNT",
      userId: nextUserId,
    });
    if (result?.success) {
      await chrome.storage.local.set({ sm_active_account: nextUserId });
      await render();
    }
  });

  projectSelect.addEventListener("change", async () => {
    await chrome.storage.local.set({ sm_project: projectSelect.value || "" });
  });

  async function loadProjects() {
    projectsError.style.display = "none";
    projectsError.textContent = "";
    projectSelect.innerHTML = '<option value="">Select project...</option>';

    const response = await chrome.runtime.sendMessage({ type: "GET_PROJECTS" });
    if (!response?.success) {
      projectsError.textContent = response?.error || "Failed to load projects";
      projectsError.style.display = "block";
      return;
    }

    response.projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      projectSelect.appendChild(option);
    });

    const { sm_project } = await chrome.storage.local.get("sm_project");
    if (sm_project) {
      projectSelect.value = sm_project;
    }
  }

  function showDisconnected() {
    disconnectedView.style.display = "block";
    connectedView.style.display = "none";
    currentAccounts = {};
    currentActiveAccountId = null;
  }

  async function showConnected(accounts, activeAccountId) {
    disconnectedView.style.display = "none";
    connectedView.style.display = "block";

    currentAccounts = accounts;
    currentActiveAccountId = activeAccountId;

    const activeAccount = accounts[activeAccountId];
    const tierLabel = toTitleCase(activeAccount?.tier || "free");
    const email = activeAccount?.email || activeAccountId;
    accountStatus.textContent = `Connected as ${email} (${tierLabel})`;

    const userIds = Object.keys(accounts);
    if (userIds.length > 1) {
      accountSwitcherWrap.style.display = "block";
      accountSelect.innerHTML = "";
      userIds.forEach((userId) => {
        const account = accounts[userId];
        const option = document.createElement("option");
        option.value = userId;
        option.textContent = account.email || userId;
        accountSelect.appendChild(option);
      });
      accountSelect.value = activeAccountId;
    } else {
      accountSwitcherWrap.style.display = "none";
      accountSelect.innerHTML = "";
    }

    await loadProjects();
  }

  async function render() {
    const data = await chrome.storage.local.get(["sm_accounts", "sm_active_account"]);
    const accounts = normalizeAccounts(data.sm_accounts);
    const userIds = Object.keys(accounts);

    if (userIds.length === 0) {
      showDisconnected();
      return;
    }

    let activeAccountId = data.sm_active_account;
    if (!activeAccountId || !accounts[activeAccountId]) {
      activeAccountId = userIds[0];
      await chrome.storage.local.set({ sm_active_account: activeAccountId });
    }

    await showConnected(accounts, activeAccountId);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes.sm_accounts && !changes.sm_active_account) return;
    void render();
  });

  await render();
});
