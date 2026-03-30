const DEFAULT_SETTINGS = {
  serverUrl: "https://app.scholarmark.ai",
  defaultProjectId: "",
  defaultCategory: "key_quote",
};

document.addEventListener("DOMContentLoaded", async () => {
  const apiUrlInput = document.getElementById("api-url");
  const saveBtn = document.getElementById("save-btn");
  const savedMsg = document.getElementById("saved-msg");

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  apiUrlInput.value = settings.serverUrl || DEFAULT_SETTINGS.serverUrl;

  saveBtn.addEventListener("click", async () => {
    const serverUrl = (apiUrlInput.value || DEFAULT_SETTINGS.serverUrl).trim().replace(/\/+$/, "");
    await chrome.storage.sync.set({
      serverUrl: serverUrl || DEFAULT_SETTINGS.serverUrl,
    });

    savedMsg.style.display = "block";
    setTimeout(() => {
      savedMsg.style.display = "none";
    }, 2000);
  });
});
