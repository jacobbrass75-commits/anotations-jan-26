export const DEFAULT_AUTH_OPERATION_DELAY_MS = 20_000;

export async function withAuthOperationDelayNotice<T>(
  operation: Promise<T>,
  delayMessage: string,
  onDelayChange: (message: string | null) => void,
  delayMs = DEFAULT_AUTH_OPERATION_DELAY_MS,
): Promise<T> {
  let delayWasAnnounced = false;
  const delayNotice = setTimeout(() => {
    delayWasAnnounced = true;
    onDelayChange(delayMessage);
  }, delayMs);

  try {
    return await operation;
  } finally {
    clearTimeout(delayNotice);
    if (delayWasAnnounced) onDelayChange(null);
  }
}
