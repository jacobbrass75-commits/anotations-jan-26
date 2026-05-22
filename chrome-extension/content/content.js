const EXTENSION_AUTH_MESSAGE = "SM_EXTENSION_AUTH";
const EXTENSION_AUTH_ACK = "SM_EXTENSION_AUTH_ACK";
const ALLOWED_EXTENSION_AUTH_ORIGINS = new Set([
  "https://app.scholarmark.ai",
  "http://localhost:5001",
]);

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
      apiKeyId: event.data.apiKeyId,
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
