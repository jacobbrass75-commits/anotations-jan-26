import { useUser, useAuth as useClerkAuth, useClerk } from "@clerk/clerk-react";
import { queryClient } from "./queryClient";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  tier: string;
  tokensUsed: number;
  tokenLimit: number;
  storageUsed: number;
  storageLimit: number;
  emailVerified: boolean | null;
  billingCycleStart: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isSignedIn: boolean;
  tier: string;
  logout: () => void;
}

const TIER_LIMITS: Record<string, { tokenLimit: number; storageLimit: number }> = {
  free: { tokenLimit: 50_000, storageLimit: 52_428_800 },
  pro: { tokenLimit: 500_000, storageLimit: 524_288_000 },
  max: { tokenLimit: 2_000_000, storageLimit: 5_368_709_120 },
};

/** Drop-in replacement for the old useAuth() hook, now backed by Clerk */
export function useAuth(): AuthContextType {
  const { user: clerkUser, isLoaded: isUserLoaded } = useUser();
  const { isLoaded: isAuthLoaded, isSignedIn } = useClerkAuth();
  const { signOut } = useClerk();

  const isLoading = !isUserLoaded || !isAuthLoaded;

  const tier = (clerkUser?.publicMetadata?.tier as string) || "free";
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.free;

  const user: AuthUser | null = clerkUser
    ? {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress ?? "",
        username: clerkUser.username ?? clerkUser.primaryEmailAddress?.emailAddress ?? "",
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        tier,
        tokensUsed: 0, // populated from /api/auth/usage
        tokenLimit: limits.tokenLimit,
        storageUsed: 0,
        storageLimit: limits.storageLimit,
        emailVerified: clerkUser.primaryEmailAddress?.verification?.status === "verified",
        billingCycleStart: null,
        createdAt: clerkUser.createdAt?.toISOString() ?? "",
        updatedAt: clerkUser.updatedAt?.toISOString() ?? "",
      }
    : null;

  const logout = () => {
    signOut();
    queryClient.invalidateQueries();
  };

  return {
    user,
    isLoading,
    isSignedIn: !!isSignedIn,
    tier,
    logout,
  };
}

// ── Tier feature gating ────────────────────────────────────────────

type Feature =
  | "chat"
  | "writing"
  | "deep_write"
  | "source_verified"
  | "export"
  | "bulk_export"
  | "chrome_extension"
  | "bibliography"
  | "endash_toggle"
  | "batch_analysis"
  | "multi_prompt"
  | "vision_ocr"
  | "advanced_vision_ocr"
  | "unlimited_docs"
  | "unlimited_projects"
  | "unlimited_citations";

const FEATURE_TIERS: Record<Feature, string> = {
  chat: "pro",
  writing: "pro",
  deep_write: "max",
  source_verified: "max",
  export: "pro",
  bulk_export: "max",
  chrome_extension: "pro",
  bibliography: "pro",
  endash_toggle: "pro",
  batch_analysis: "max",
  multi_prompt: "max",
  vision_ocr: "pro",
  advanced_vision_ocr: "max",
  unlimited_docs: "pro",
  unlimited_projects: "pro",
  unlimited_citations: "pro",
};

const TIER_LEVELS: Record<string, number> = { free: 0, pro: 1, max: 2 };

/**
 * Auth headers are no longer needed — Clerk uses session cookies.
 * Kept for backward compatibility with hooks that import it.
 */
export function getAuthHeaders(): Record<string, string> {
  return {};
}

export function useUserTier() {
  const { tier } = useAuth();
  const level = TIER_LEVELS[tier] ?? 0;

  function can(feature: Feature): boolean {
    const required = FEATURE_TIERS[feature];
    if (!required) return true;
    return level >= (TIER_LEVELS[required] ?? 0);
  }

  function requiredTier(feature: Feature): string {
    return FEATURE_TIERS[feature] ?? "free";
  }

  return { tier, level, can, requiredTier };
}
