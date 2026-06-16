import { decrementStorageUsage, getUserById, reserveStorageUsage } from "./authStorage";
import { getDocumentLimit } from "./planLimits";
import { storage } from "./storage";

export class DocumentQuotaError extends Error {
  readonly status: number;
  readonly code: "document_limit" | "storage_limit" | "user_not_found";

  constructor(
    code: "document_limit" | "storage_limit" | "user_not_found",
    message: string,
    status = 403,
  ) {
    super(message);
    this.name = "DocumentQuotaError";
    this.code = code;
    this.status = status;
  }
}

export async function assertDocumentCreationAllowed(userId: string): Promise<void> {
  const user = await getUserById(userId);
  if (!user) {
    throw new DocumentQuotaError("user_not_found", "Authenticated user was not found", 404);
  }

  const limit = getDocumentLimit(user.tier);
  if (limit === null) {
    return;
  }

  const currentDocuments = await storage.countDocumentsForUser(userId);
  if (currentDocuments >= limit) {
    throw new DocumentQuotaError(
      "document_limit",
      `Document limit reached for the ${user.tier} plan`,
    );
  }
}

export async function reserveDocumentCapacity(
  userId: string,
  bytes: number,
): Promise<{ release: () => Promise<void>; bytesReserved: number }> {
  await assertDocumentCreationAllowed(userId);
  const reservation = await reserveStorageUsage(userId, bytes);
  if (!reservation.ok) {
    throw new DocumentQuotaError(
      reservation.reason === "not_found" ? "user_not_found" : "storage_limit",
      reservation.reason === "not_found" ? "Authenticated user was not found" : "Storage limit reached",
      reservation.reason === "not_found" ? 404 : 403,
    );
  }

  return {
    bytesReserved: reservation.requestedBytes,
    release: () => decrementStorageUsage(userId, reservation.requestedBytes),
  };
}
