export async function copyTextToClipboard(text: string): Promise<void> {
  const value = `${text ?? ""}`;

  if (!value.trim()) {
    throw new Error("No text available to copy");
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    const didCopy = document.execCommand("copy");
    document.body.removeChild(textarea);

    if (didCopy) {
      return;
    }
  }

  throw new Error("Clipboard is unavailable in this browser context");
}
