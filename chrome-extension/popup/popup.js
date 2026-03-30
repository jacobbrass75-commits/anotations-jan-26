document.addEventListener("DOMContentLoaded", async () => {
  const loginView = document.getElementById("login-view");
  const mainView = document.getElementById("main-view");
  const connectBtn = document.getElementById("connect-btn");
  const loginHint = document.getElementById("login-hint");
  const statusText = document.getElementById("status-text");
  const userInfo = document.getElementById("user-info");
  const projectSelect = document.getElementById("project-select");
  const openAppBtn = document.getElementById("open-app");
  const reconnectBtn = document.getElementById("reconnect-btn");
  const logoutBtn = document.getElementById("logout-btn");

  function showLoginView(serverUrl) {
    loginView.style.display = "block";
    mainView.style.display = "none";
    loginHint.textContent = `Open ${serverUrl} to sign in with Clerk and connect this extension.`;
  }

  function showMainView(user) {
    loginView.style.display = "none";
    mainView.style.display = "block";
    userInfo.textContent = `${user.email || user.userId}${user.tier ? ` (${user.tier})` : ""}`;
  }

  async function loadProjects(defaultProjectId) {
    const response = await chrome.runtime.sendMessage({ type: "GET_PROJECTS" });
    if (!response?.success) {
      statusText.textContent = response?.error || "Could not load projects.";
      return;
    }

    projectSelect.innerHTML = '<option value="">No default project</option>';
    response.projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      projectSelect.appendChild(option);
    });

    projectSelect.value = defaultProjectId || "";
    statusText.textContent = "Select text on any page, then right-click or press Ctrl+Shift+S.";
  }

  async function refreshState() {
    const state = await chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" });
    if (!state?.connected) {
      showLoginView(state?.settings?.serverUrl || "https://app.scholarmark.ai");
      return;
    }

    showMainView(state.user);
    await loadProjects(state.settings?.defaultProjectId || "");
  }

  connectBtn.addEventListener("click", async () => {
    statusText.textContent = "";
    await chrome.runtime.sendMessage({ type: "START_AUTH" });
    window.close();
  });

  openAppBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "OPEN_APP" });
  });

  reconnectBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "START_AUTH" });
    window.close();
  });

  logoutBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "LOGOUT" });
    await refreshState();
  });

  projectSelect.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "SET_DEFAULT_PROJECT",
      projectId: projectSelect.value,
    });
  });

  await refreshState();
});
