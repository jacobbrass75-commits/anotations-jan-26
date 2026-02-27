// Options page — manages extension settings

document.addEventListener("DOMContentLoaded", async () => {
  const apiUrlInput = document.getElementById("api-url");
  const saveBtn = document.getElementById("save-btn");
  const savedMsg = document.getElementById("saved-msg");

  // Load saved settings
  const { sm_api_url } = await chrome.storage.local.get("sm_api_url");
  if (sm_api_url) {
    apiUrlInput.value = sm_api_url;
  } else {
    apiUrlInput.value = "http://localhost:5001";
  }

  saveBtn.addEventListener("click", async () => {
    const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, ""); // Remove trailing slashes
    await chrome.storage.local.set({ sm_api_url: apiUrl || "http://localhost:5001" });

    savedMsg.style.display = "block";
    setTimeout(() => {
      savedMsg.style.display = "none";
    }, 2000);
  });
});
