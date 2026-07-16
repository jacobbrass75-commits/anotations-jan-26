export const DEFAULT_AUTH_OPERATION_TIMEOUT_MS = 20_000;

export class AuthOperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthOperationTimeoutError";
  }
}

export async function withAuthOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMessage: string,
  timeoutMs = DEFAULT_AUTH_OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new AuthOperationTimeoutError(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
