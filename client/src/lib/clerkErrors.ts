export interface ClerkErrorDetail {
  code?: string;
  message?: string;
  longMessage?: string;
}

export function getClerkErrorDetails(error: unknown): ClerkErrorDetail[] {
  if (!error || typeof error !== "object") return [];
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];

  return errors.filter(
    (detail): detail is ClerkErrorDetail => Boolean(detail) && typeof detail === "object",
  );
}

export function getClerkErrorMessage(error: unknown, fallback: string): string {
  const [detail] = getClerkErrorDetails(error);
  if (detail?.longMessage) return detail.longMessage;
  if (detail?.message) return detail.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function getClerkErrorCode(error: unknown): string | null {
  return getClerkErrorDetails(error)[0]?.code ?? null;
}
