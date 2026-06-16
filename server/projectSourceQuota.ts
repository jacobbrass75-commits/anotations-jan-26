import type { ProjectDocument } from "@shared/schema";
import { getProjectSourceLimit } from "./planLimits";
import { projectStorage } from "./projectStorage";

const NON_SOURCE_PROJECT_ROLES = new Set(["AI-generated draft"]);

function countsTowardSourceLimit(projectDocument: Pick<ProjectDocument, "roleInProject">): boolean {
  return !projectDocument.roleInProject || !NON_SOURCE_PROJECT_ROLES.has(projectDocument.roleInProject);
}

export class ProjectSourceQuotaError extends Error {
  readonly status = 403;
  readonly current: number;
  readonly limit: number;
  readonly requested: number;
  readonly requiredTier: "pro" | "max";

  constructor(input: {
    current: number;
    limit: number;
    requested: number;
    requiredTier: "pro" | "max";
  }) {
    super(`This plan supports up to ${input.limit} sources per project. Upgrade to add more.`);
    this.name = "ProjectSourceQuotaError";
    this.current = input.current;
    this.limit = input.limit;
    this.requested = input.requested;
    this.requiredTier = input.requiredTier;
  }
}

export async function assertProjectSourceCapacityAvailable(
  projectId: string,
  tier: string | null | undefined,
  requestedNewSources = 1,
): Promise<void> {
  const limit = getProjectSourceLimit(tier);
  if (limit === null || requestedNewSources <= 0) {
    return;
  }

  const projectDocuments = await projectStorage.getProjectDocumentsByProject(projectId);
  const current = projectDocuments.filter(countsTowardSourceLimit).length;
  if (current + requestedNewSources <= limit) {
    return;
  }

  throw new ProjectSourceQuotaError({
    current,
    limit,
    requested: requestedNewSources,
    requiredTier: tier === "free" ? "pro" : "max",
  });
}

export function projectSourceQuotaErrorBody(error: ProjectSourceQuotaError) {
  return {
    error: error.message,
    code: "project_source_limit",
    current: error.current,
    limit: error.limit,
    requested: error.requested,
    requiredTier: error.requiredTier,
  };
}
